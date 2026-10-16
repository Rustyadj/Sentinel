import { ModelUnavailableError } from "@/lib/agents/model-policy";
import { db } from "@/lib/db";
import { persistChatExchange } from "@/lib/chat/persistence";
import { appendSessionMemory } from "@/lib/knowledge/retrieval";
import { captureAgentTurn } from "@/lib/neural-engine/chat-capture";
import { writeAuditLog } from "@/lib/workspaces/audit";
import { RUNTIME_PERMISSIONS, requireRuntimeAccess, validateSessionScope } from "./authorization";
import { asRuntimeInstance } from "./config";
import { getRuntimeAdapter } from "./service";
import { RuntimeError } from "./errors";
import { runtimeSessionStore } from "./store";
import type { RuntimeEvent } from "./types";
import { isReportedTokenUsage } from "@/lib/agents/pricing";

export type ChatExecutionMode = "model_chat" | "persistent_agent_runtime" | "coding_runtime" | "workflow_runtime";

export const RUNTIME_AGENT_MAP: Record<string, { runtimeId: string; mode: ChatExecutionMode; label: string }> = {
  "hermes-nathan2": { runtimeId: "runtime-hermes-nathan2", mode: "persistent_agent_runtime", label: "Hermes runtime" },
  "hermes-lisa": { runtimeId: "runtime-hermes-lisa", mode: "persistent_agent_runtime", label: "Hermes runtime" },
  "claude-code": { runtimeId: "runtime-claude-code", mode: "coding_runtime", label: "Claude Code runtime" },
  codex: { runtimeId: "runtime-codex", mode: "coding_runtime", label: "Codex runtime" },
};

const RUNTIME_PROVIDERS: Record<string, string> = {
  hermes: "hermes",
  "claude-code": "anthropic",
  codex: "openai",
};

/**
 * A runtime that answered ready is trusted for a few seconds, so a turn does
 * not pay a health round trip it just paid, and a voice session can warm it
 * before the first utterance. Only successes are cached: a failing runtime is
 * re-checked every time. A runtime that dies inside the window fails on send,
 * which is surfaced exactly as before.
 */
const READINESS_TTL_MS = 15_000;
const readyAt = new Map<string, number>();

async function checkReadiness(runtime: Parameters<typeof asRuntimeInstance>[0]) {
  const checkedAt = readyAt.get(runtime.id);
  if (checkedAt !== undefined && Date.now() - checkedAt < READINESS_TTL_MS) return { ready: true as const };
  const readiness = await getRuntimeAdapter(runtime.kind).readiness(asRuntimeInstance(runtime));
  if (readiness.ready) readyAt.set(runtime.id, Date.now());
  else readyAt.delete(runtime.id);
  return readiness;
}

/** Session warm-up: authorize and health-check the agent's runtime ahead of the first turn. */
export async function warmRuntimeChat(agentId: string): Promise<boolean> {
  const route = RUNTIME_AGENT_MAP[agentId];
  if (!route) return false;
  const { runtime } = await requireRuntimeAccess(route.runtimeId, RUNTIME_PERMISSIONS.execute);
  return (await checkReadiness(runtime)).ready;
}

export function isRuntimeChatMode(mode: ChatExecutionMode | undefined) {
  return mode === "persistent_agent_runtime" || mode === "coding_runtime";
}

export async function routeRuntimeChat(input: {
  agentId: string;
  userId: string;
  roomId?: string;
  userContent: string;
  mode: ChatExecutionMode;
}) {
  const route = RUNTIME_AGENT_MAP[input.agentId];
  if (!route || route.mode !== input.mode) throw new RuntimeError("Selected agent does not support this execution mode", "execution_mode_mismatch", 422);
  const { runtime } = await requireRuntimeAccess(route.runtimeId, RUNTIME_PERMISSIONS.execute);
  const adapter = getRuntimeAdapter(runtime.kind);
  const readiness = await checkReadiness(runtime);
  if (!readiness.ready) throw new RuntimeError(`Runtime unavailable: ${readiness.reason ?? "not ready"}`, "runtime_not_ready", 503);

  const room = input.roomId
    ? await db.chatRoom.findFirst({ where: { id: input.roomId, userId: input.userId }, select: { id: true, projectId: true } })
    : null;
  if (input.roomId && !room) throw new RuntimeError("Room not found", "room_not_found", 404);
  await validateSessionScope(runtime, input.userId, {
    workspaceId: runtime.workspaceId,
    projectId: room?.projectId ?? undefined,
  });

  let session = input.roomId ? await db.agentSession.findFirst({
    where: {
      runtimeInstanceId: runtime.id,
      userId: input.userId,
      chatRoomId: input.roomId,
      status: { notIn: ["running", "cancelled", "timed_out"] },
    },
    orderBy: { lastActivityAt: "desc" },
  }) : null;

  if (!session) {
    const created = await adapter.startSession({
      runtimeId: runtime.id,
      userId: input.userId,
      workspaceId: runtime.workspaceId,
      projectId: room?.projectId ?? undefined,
    });
    session = await db.agentSession.update({
      where: { id: created.id },
      data: { chatRoomId: input.roomId },
    });
    await writeAuditLog({
      workspaceId: runtime.workspaceId,
      projectId: room?.projectId ?? undefined,
      userId: input.userId,
      action: "agent_runtime.session_started",
      entityType: "AgentSession",
      entityId: created.id,
      details: { runtimeId: runtime.id, kind: runtime.kind, source: "chat" },
    });
  }

  await writeAuditLog({
    workspaceId: runtime.workspaceId,
    projectId: room?.projectId ?? undefined,
    userId: input.userId,
    action: "agent_runtime.task_sent",
    entityType: "AgentSession",
    entityId: session.id,
    details: { runtimeId: runtime.id, promptLength: input.userContent.length, source: "chat" },
  });
  // Merge, never replace: the session's metadata carries the model it was pinned to when it started, and the
  // Hermes adapter refuses to send on a session without it ("Session model provenance missing"). Overwriting
  // it here made every typed chat turn after the first session fail.
  const priorMetadata = session.metadata && typeof session.metadata === "object" && !Array.isArray(session.metadata) ? (session.metadata as Record<string, unknown>) : {};
  await runtimeSessionStore.update(session.id, {
    metadata: { ...priorMetadata, lastTask: input.userContent.slice(0, 160), source: "chat" },
  });
  await runtimeSessionStore.append(session.id, "status", {
    phase: "task_submitted",
    prompt: input.userContent,
    source: "chat",
  });

  const requestStartedAtMs = Date.now();
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let fullContent = "";
      const enqueue = (data: object) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      enqueue({ type: "source", executionMode: input.mode, runtime: runtime.kind, label: route.label, sessionId: session.id });
      enqueue({ type: "presence", agentId: input.agentId, status: "thinking" });
      try {
        for await (const event of adapter.send({ sessionId: session.id, prompt: input.userContent, userId: input.userId })) {
          const text = runtimeEventText(event);
          if (text) {
            fullContent += text;
            enqueue({ type: "text", text });
          }
          enqueue({ type: "runtime_event", event });
        }
        if (room && fullContent) {
          const completedSession = await runtimeSessionStore.get(session.id);
          const provenance = completedSession?.metadata ?? {};
          const executedModel = typeof provenance.actualModel === "string" ? provenance.actualModel : typeof provenance.requestedModel === "string" ? provenance.requestedModel : undefined;
          await persistChatExchange({
            roomId: room.id,
            userId: input.userId,
            userContent: input.userContent,
            agentId: input.agentId,
            assistantContent: fullContent,
            provenance: {
              runtimeKind: runtime.kind,
              provider: RUNTIME_PROVIDERS[runtime.kind],
              model: executedModel,
              agentRuntimeSessionId: session.id,
            },
          });
          await appendSessionMemory(room.id, [
            { role: "user", content: input.userContent },
            { role: "agent", content: fullContent },
          ]).catch(() => {});
          void captureAgentTurn({
            agentId: input.agentId,
            roomId: room.id,
            userContent: input.userContent,
            model: executedModel ?? runtime.kind,
            startedAtMs: requestStartedAtMs,
            fullContent,
            knowledgeUsedIds: [],
            ...(isReportedTokenUsage(provenance.tokenUsage) ? { tokenUsage: provenance.tokenUsage } : {}),
          });
          enqueue({ type: "knowledge_update", roomId: room.id });
        }
      } catch (error) {
        enqueue({ type: "error", ...(error instanceof ModelUnavailableError ? error.toJSON() : {}), error: error instanceof Error ? error.message : "Runtime execution failed" });
      } finally {
        enqueue({ type: "presence", agentId: input.agentId, status: "idle" });
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" } });
}

export function runtimeEventText(event: RuntimeEvent) {
  // Only assistant_delta carries streamable content. Other event types
  // (status, completed, ...) can legitimately carry a `text`/`message` field
  // too — e.g. Hermes emits the full final response again in both a
  // status.update and message.complete event, on top of every individual
  // delta chunk already streamed — but that's a summary/housekeeping value,
  // not additional content. Extracting it here duplicated every response
  // (once per delta, plus once more per summary event carrying the same text).
  if (event.type !== "assistant_delta") return "";
  if (typeof event.data.text === "string") return event.data.text;
  const payload = event.data.event;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return "";
  const value = payload as Record<string, unknown>;
  if (typeof value.text === "string") return value.text;
  if (typeof value.message === "string") return value.message;
  const message = value.message;
  if (message && typeof message === "object" && !Array.isArray(message)) {
    const content = (message as Record<string, unknown>).content;
    if (Array.isArray(content)) return content.map((part) => part && typeof part === "object" && typeof (part as Record<string, unknown>).text === "string" ? (part as Record<string, unknown>).text : "").join("");
  }
  return "";
}
