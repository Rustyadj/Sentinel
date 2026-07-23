import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { AGENT_TEMPLATES } from "@/lib/constants";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/current-user";
import { persistChatExchange } from "@/lib/chat/persistence";
import { getControlPlaneUser, requireAgentRecordUser } from "@/lib/agents/permissions";
import { getVpsAgent } from "@/lib/agents/registry";
import { retrieveContextWithProvenance } from "@/lib/neural-engine/knowledge-bridge";
import { captureAgentTurn } from "@/lib/neural-engine/chat-capture";
import { retrieve } from "@/lib/neural-engine/retrieval-planner";
import type { NextRequest } from "next/server";

interface ContextBlockResult {
  block: string;
  /** KnowledgeObject ids the retrieved context resolved to — feeds Experience.knowledgeUsed (Phase C). */
  knowledgeObjectIds: string[];
}

/**
 * Phase E: the prompt text now reflects the Phase C retrieval planner's
 * ranking (real query relevance, prior success/failure for this agent,
 * agent competency, recency, ...) instead of plain pin/recency order.
 *
 * retrieveContextWithProvenance still does the actual DB fetch + bridges
 * results into KnowledgeObject ids (real content stays authoritative there);
 * retrieve() independently re-derives a ranked candidate set from those same
 * now-bridged KnowledgeObject rows and reorders by its 12 factors. Ranked ids
 * with no matching line in the bridged content (e.g. objects outside this
 * narrower per-type fetch) are skipped rather than triggering a second fetch
 * — a deliberate simplification, not a silent gap: retrieveContextWithProvenance's
 * own order is the fallback if ranking finds nothing to reorder.
 */
async function buildContextBlock(
  roomId: string | undefined,
  memoryScope: string,
  userId: string,
  agentId: string,
  userContent: string,
): Promise<ContextBlockResult> {
  const empty: ContextBlockResult = { block: "", knowledgeObjectIds: [] };
  if (!roomId) return empty;
  try {
    const room = await db.chatRoom.findFirst({
      where: { id: roomId, userId },
      select: { projectId: true, userId: true },
    });

    // Agents scoped to "session" only ever see session/user/global memory —
    // never let them pull in project-wide context even if the room has a project.
    const projectId = memoryScope === "session" ? undefined : room?.projectId ?? undefined;

    const { memories, notes, decisions, totalItems, knowledgeObjectIds } =
      await retrieveContextWithProvenance({
        roomId,
        projectId,
        userId,
        maxItems: 10,
      });

    if (totalItems === 0) return empty;

    const lineByObjectId = new Map<string, string>();
    // knowledgeObjectIds is bridgeBatch's output, in the same
    // [...memories, ...notes, ...decisions] concatenation order it was built from.
    let cursor = 0;
    for (const m of memories) lineByObjectId.set(knowledgeObjectIds[cursor++], `- (memory, ${m.scope}) ${m.content}`);
    for (const n of notes) lineByObjectId.set(knowledgeObjectIds[cursor++], `- (note) ${n.title}: ${n.content.slice(0, 200)}`);
    for (const d of decisions) lineByObjectId.set(knowledgeObjectIds[cursor++], `- (decision, ${d.status}) ${d.title}: ${d.summary}`);

    let orderedIds = knowledgeObjectIds;
    try {
      const ranked = await retrieve({
        query: userContent,
        userId,
        agentId,
        projectId,
        maxItems: knowledgeObjectIds.length || 10,
      });
      const rankedKnownIds = ranked.items.map((i) => i.objectId).filter((id) => lineByObjectId.has(id));
      if (rankedKnownIds.length > 0) orderedIds = rankedKnownIds;
    } catch (err) {
      // Ranking is a reordering, not a correctness requirement — fall back
      // to retrieveContextWithProvenance's own order rather than dropping context.
      console.error("[chat] retrieval ranking failed, using unranked order:", err);
    }

    const lines = ["\n\n## Relevant context", ...orderedIds.map((id) => lineByObjectId.get(id)).filter((l): l is string => !!l)];
    return { block: lines.join("\n"), knowledgeObjectIds };
  } catch (err) {
    console.error("[chat] context retrieval failed:", err);
    return empty;
  }
}

const encoder = new TextEncoder();

function sse(data: object): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify(data)}\n\n`);
}

function sseStream(
  fn: (ctrl: ReadableStreamDefaultController) => Promise<void>
): Response {
  return new Response(
    new ReadableStream({ start: fn }),
    {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    }
  );
}

function sseError(message: string, status = 400): Response {
  const response = sseStream(async (ctrl) => {
    ctrl.enqueue(sse({ type: "error", error: message }));
    ctrl.enqueue(encoder.encode("data: [DONE]\n\n"));
    ctrl.close();
  });
  return new Response(response.body, { status, headers: response.headers });
}

function pickProvider(model: string) {
  if (model.startsWith("claude")) return "anthropic";
  if (model.startsWith("gpt") || model === "o1" || model === "o3") return "openai";
  return "openrouter";
}

async function persistMessages(
  roomId: string,
  userContent: string,
  agentId: string,
  assistantContent: string,
  userId: string
) {
  try {
    await persistChatExchange({ roomId, userId, userContent, agentId, assistantContent });
  } catch (err) {
    // Non-fatal: log but don't break the streaming response
    console.error("[chat] persist failed:", err);
  }
}

export async function POST(request: NextRequest) {
  const requestStartedAtMs = Date.now();
  let body: {
    messages: Array<{ role: "user" | "assistant"; content: string }>;
    agentId: string;
    roomId?: string;
    userContent?: string;
  };

  try {
    body = await request.json();
  } catch {
    return sseError("Invalid request body");
  }

  const { messages, agentId, roomId, userContent } = body;
  if (!messages?.length || !agentId) {
    return sseError("Missing required fields: messages, agentId");
  }

  const user = await requireUser().catch(() => null);
  if (!user) return sseError("Unauthorized", 401);

  if (roomId) {
    const room = await db.chatRoom.findFirst({
      where: { id: roomId, userId: user.id },
      select: { id: true },
    });
    if (!room) return sseError("Room not found", 404);
  }

  const dbAgent = await db.agent.findUnique({ where: { id: agentId } }).catch(() => null);
  if (dbAgent) {
    if (!(await requireAgentRecordUser(agentId))) return sseError("Agent not found", 404);
  } else if (getVpsAgent(agentId)) {
    if (!(await getControlPlaneUser(agentId))) return sseError("Agent not found", 404);
  } else if (!(process.env.NODE_ENV !== "production" && process.env.ENABLE_DEV_ADAPTERS === "true")) {
    return sseError("Agent not found", 404);
  }
  const agentTemplate = AGENT_TEMPLATES.find((a) => a.id === agentId);
  const model = dbAgent?.model ?? agentTemplate?.model ?? "claude-sonnet-4-6";
  const basePrompt =
    dbAgent?.systemPrompt ||
    agentTemplate?.systemPrompt ||
    `You are an AI assistant in the Sentinel OS platform. Be concise and professional.`;
  const memoryScope = dbAgent?.memoryScope ?? agentTemplate?.memoryScope ?? "session";
  const { block: contextBlock, knowledgeObjectIds } = await buildContextBlock(
    roomId,
    memoryScope,
    user.id,
    agentId,
    userContent ?? messages[messages.length - 1]?.content ?? "",
  );
  const systemPrompt = basePrompt + contextBlock;

  const provider = pickProvider(model);

  // Keys passed from the browser (user's own credentials)
  const allowBrowserKeys = process.env.NODE_ENV !== "production" || process.env.ALLOW_BROWSER_PROVIDER_KEYS === "true";
  const anthropicKey = process.env.ANTHROPIC_API_KEY ?? (allowBrowserKeys ? request.headers.get("x-anthropic-key") ?? "" : "");
  const openaiKey = process.env.OPENAI_API_KEY ?? (allowBrowserKeys ? request.headers.get("x-openai-key") ?? "" : "");
  const openrouterKey = process.env.OPENROUTER_API_KEY ?? (allowBrowserKeys ? request.headers.get("x-openrouter-key") ?? "" : "");

  // ── Anthropic ─────────────────────────────────────────────────────────────
  if (provider === "anthropic") {
    if (!anthropicKey) return sseError("Anthropic API key not configured — add it in Settings → API Keys");

    return sseStream(async (ctrl) => {
      let fullContent = "";
      ctrl.enqueue(sse({ type: "presence", agentId, status: "thinking" }));
      try {
        const anthropic = new Anthropic({ apiKey: anthropicKey });
        const response = await anthropic.messages.create({
          model,
          max_tokens: 2048,
          system: systemPrompt,
          messages,
          stream: true,
        });

        for await (const event of response) {
          if (
            event.type === "content_block_delta" &&
            event.delta.type === "text_delta"
          ) {
            fullContent += event.delta.text;
            ctrl.enqueue(sse({ type: "text", text: event.delta.text }));
          }
          if (event.type === "message_stop") break;
        }
      } catch (err) {
        ctrl.enqueue(
          sse({ type: "error", error: err instanceof Error ? err.message : "Anthropic API error" })
        );
      } finally {
        if (roomId && userContent && fullContent) {
          await persistMessages(roomId, userContent, agentId, fullContent, user.id);
          // Emit knowledge_update event into the SSE stream so the graph panel refreshes immediately
          ctrl.enqueue(sse({ type: "knowledge_update", roomId }));
        }
        if (userContent) {
          // Phase B: record this agent turn as an Experience and run the
          // evaluator. Fire-and-forget and fully self-guarded — must never
          // block the stream or throw into the chat path.
          void captureAgentTurn({
            agentId,
            roomId,
            userContent,
            model,
            startedAtMs: requestStartedAtMs,
            fullContent,
            knowledgeUsedIds: knowledgeObjectIds,
          });
        }
        ctrl.enqueue(sse({ type: "presence", agentId, status: "idle" }));
        ctrl.enqueue(encoder.encode("data: [DONE]\n\n"));
        ctrl.close();
      }
    });
  }

  // ── OpenAI ────────────────────────────────────────────────────────────────
  if (provider === "openai") {
    if (!openaiKey) return sseError("OpenAI API key not configured — add it in Settings → API Keys");

    return sseStream(async (ctrl) => {
      let fullContent = "";
      ctrl.enqueue(sse({ type: "presence", agentId, status: "thinking" }));
      try {
        const openai = new OpenAI({ apiKey: openaiKey });
        const stream = await openai.chat.completions.create({
          model,
          max_tokens: 2048,
          messages: [
            { role: "system", content: systemPrompt },
            ...messages,
          ],
          stream: true,
        });

        for await (const chunk of stream) {
          const text = chunk.choices[0]?.delta?.content;
          if (text) {
            fullContent += text;
            ctrl.enqueue(sse({ type: "text", text }));
          }
          if (chunk.choices[0]?.finish_reason) break;
        }
      } catch (err) {
        ctrl.enqueue(
          sse({ type: "error", error: err instanceof Error ? err.message : "OpenAI API error" })
        );
      } finally {
        if (roomId && userContent && fullContent) {
          await persistMessages(roomId, userContent, agentId, fullContent, user.id);
          // Emit knowledge_update event into the SSE stream so the graph panel refreshes immediately
          ctrl.enqueue(sse({ type: "knowledge_update", roomId }));
        }
        if (userContent) {
          // Phase B: record this agent turn as an Experience and run the
          // evaluator. Fire-and-forget and fully self-guarded — must never
          // block the stream or throw into the chat path.
          void captureAgentTurn({
            agentId,
            roomId,
            userContent,
            model,
            startedAtMs: requestStartedAtMs,
            fullContent,
            knowledgeUsedIds: knowledgeObjectIds,
          });
        }
        ctrl.enqueue(sse({ type: "presence", agentId, status: "idle" }));
        ctrl.enqueue(encoder.encode("data: [DONE]\n\n"));
        ctrl.close();
      }
    });
  }

  // ── OpenRouter (OpenAI-compatible) ────────────────────────────────────────
  if (!openrouterKey) return sseError("OpenRouter API key not configured — add it in Settings → API Keys");

  return sseStream(async (ctrl) => {
    let fullContent = "";
    ctrl.enqueue(sse({ type: "presence", agentId, status: "thinking" }));
    try {
      const openai = new OpenAI({
        apiKey: openrouterKey,
        baseURL: "https://openrouter.ai/api/v1",
        defaultHeaders: {
          "HTTP-Referer": "https://hermesos.ai",
          "X-Title": "Sentinel OS",
        },
      });

      const stream = await openai.chat.completions.create({
        model,
        max_tokens: 2048,
        messages: [
          { role: "system", content: systemPrompt },
          ...messages,
        ],
        stream: true,
      });

      for await (const chunk of stream) {
        const text = chunk.choices[0]?.delta?.content;
        if (text) {
          fullContent += text;
          ctrl.enqueue(sse({ type: "text", text }));
        }
        if (chunk.choices[0]?.finish_reason) break;
      }
    } catch (err) {
      ctrl.enqueue(
        sse({ type: "error", error: err instanceof Error ? err.message : "OpenRouter API error" })
      );
    } finally {
      if (roomId && userContent && fullContent) {
        await persistMessages(roomId, userContent, agentId, fullContent, user.id);
        // Emit knowledge_update event into the SSE stream so the graph panel refreshes immediately
        ctrl.enqueue(sse({ type: "knowledge_update", roomId }));
      }
      if (userContent) {
        // Phase B: record this agent turn as an Experience and run the
        // evaluator. Fire-and-forget and fully self-guarded — must never
        // block the stream or throw into the chat path.
        void captureAgentTurn({
          agentId,
          roomId,
          userContent,
          model,
          startedAtMs: requestStartedAtMs,
          fullContent,
          knowledgeUsedIds: knowledgeObjectIds,
        });
      }
      ctrl.enqueue(sse({ type: "presence", agentId, status: "idle" }));
      ctrl.enqueue(encoder.encode("data: [DONE]\n\n"));
      ctrl.close();
    }
  });
}
