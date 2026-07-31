import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { AGENT_TEMPLATES } from "@/lib/constants";
import { db } from "@/lib/db";
import { ensureAgentsSeeded } from "@/lib/agents/seed";
import { emitEvent } from "@/lib/knowledge/events";
import { retrieveContext, appendSessionMemory } from "@/lib/knowledge/retrieval";
import type { NextRequest } from "next/server";

/**
 * Returns the context block for the system prompt AND the real graph node
 * ids of whatever was actually retrieved (memory:<id> for DB-backed memories,
 * note:<id> for notes — both real, persisted KnowledgeObjects). Session-memory
 * turns (Redis-only, ephemeral) and decisions (not synced to the graph yet —
 * see docs/GRAPH_OS_ARCHITECTURE_PLAN.md) have no graph node id and are
 * excluded from retrievalNodeIds, not faked.
 */
async function buildContextBlock(
  roomId: string | undefined,
  memoryScope: string
): Promise<{ block: string; retrievalNodeIds: string[] }> {
  if (!roomId) return { block: "", retrievalNodeIds: [] };
  try {
    const room = await db.chatRoom.findUnique({
      where: { id: roomId },
      select: { projectId: true, userId: true },
    });

    // Agents scoped to "session" only ever see session/user/global memory —
    // never let them pull in project-wide context even if the room has a project.
    const projectId = memoryScope === "session" ? undefined : room?.projectId ?? undefined;

    const { memories, notes, decisions, totalItems } = await retrieveContext({
      roomId,
      projectId,
      userId: room?.userId ?? undefined,
      maxItems: 10,
    });

    if (totalItems === 0) return { block: "", retrievalNodeIds: [] };

    const lines: string[] = ["\n\n## Relevant context"];
    const retrievalNodeIds: string[] = [];
    for (const m of memories) {
      lines.push(`- (memory, ${m.scope}) ${m.content}`);
      if (m.id) retrievalNodeIds.push(`memory:${m.id}`);
    }
    for (const n of notes) {
      lines.push(`- (note) ${n.title}: ${n.content.slice(0, 200)}`);
      retrievalNodeIds.push(`note:${n.id}`);
    }
    for (const d of decisions) lines.push(`- (decision, ${d.status}) ${d.title}: ${d.summary}`);
    return { block: lines.join("\n"), retrievalNodeIds };
  } catch (err) {
    console.error("[chat] context retrieval failed:", err);
    return { block: "", retrievalNodeIds: [] };
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

function sseError(message: string): Response {
  return sseStream(async (ctrl) => {
    ctrl.enqueue(sse({ type: "error", error: message }));
    ctrl.enqueue(encoder.encode("data: [DONE]\n\n"));
    ctrl.close();
  });
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
  assistantContent: string
) {
  try {
    await db.message.createMany({
      data: [
        { chatRoomId: roomId, role: "user", content: userContent },
        { chatRoomId: roomId, role: "agent", agentId, content: assistantContent },
      ],
    });
    // Non-fatal: emit knowledge event for graph live updates
    await emitEvent({
      type: "object_created",
      payload: { roomId, agentId, messageCount: 2, trigger: "chat_response" },
      roomId,
    }).catch(() => {}); // ignore failures — DB may not be running

    // Non-fatal: roll this turn into ephemeral Redis-backed session memory
    await appendSessionMemory(roomId, [
      { role: "user", content: userContent },
      { role: "agent", content: assistantContent },
    ]).catch(() => {});
  } catch (err) {
    // Non-fatal: log but don't break the streaming response
    console.error("[chat] persist failed:", err);
  }
}

export async function POST(request: NextRequest) {
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

  await ensureAgentsSeeded().catch(() => {});
  const dbAgent = await db.agent
    .findUnique({ where: { id: agentId }, include: { configuration: true } })
    .catch(() => null);
  const agentTemplate = AGENT_TEMPLATES.find((a) => a.id === agentId);
  const model = dbAgent?.configuration?.model ?? agentTemplate?.model ?? "claude-sonnet-4-6";
  const basePrompt =
    dbAgent?.configuration?.systemPrompt ||
    agentTemplate?.systemPrompt ||
    `You are an AI assistant in the Sentinel OS platform. Be concise and professional.`;
  const memoryScope = dbAgent?.configuration?.memoryScope ?? agentTemplate?.memoryScope ?? "session";
  const { block: contextBlock, retrievalNodeIds } = await buildContextBlock(roomId, memoryScope);
  const systemPrompt = basePrompt + contextBlock;

  const provider = pickProvider(model);

  // Keys passed from the browser (user's own credentials)
  const anthropicKey = request.headers.get("x-anthropic-key") ?? process.env.ANTHROPIC_API_KEY ?? "";
  const openaiKey = request.headers.get("x-openai-key") ?? process.env.OPENAI_API_KEY ?? "";
  const openrouterKey = request.headers.get("x-openrouter-key") ?? process.env.OPENROUTER_API_KEY ?? "";

  // ── Anthropic ─────────────────────────────────────────────────────────────
  if (provider === "anthropic") {
    if (!anthropicKey) return sseError("Anthropic API key not configured — add it in Settings → API Keys");

    return sseStream(async (ctrl) => {
      let fullContent = "";
      ctrl.enqueue(sse({ type: "presence", agentId, status: "thinking" }));
      if (retrievalNodeIds.length > 0) {
        ctrl.enqueue(sse({ type: "knowledge_update", roomId, event: "retrieval", nodes: retrievalNodeIds }));
      }
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
          await persistMessages(roomId, userContent, agentId, fullContent);
          // Real node references for this turn — chat_room and agent are both
          // real, persisted KnowledgeObjects (see src/lib/agents/graph.ts,
          // src/app/api/rooms/route.ts). There's no distinct "memory write"
          // node to reference yet: this turn's messages aren't synced as
          // graph objects, and session memory is Redis-only/ephemeral — see
          // docs/GRAPH_OS_ARCHITECTURE_PLAN.md for why that's not faked here.
          ctrl.enqueue(
            sse({
              type: "knowledge_update",
              roomId,
              event: "conversation_turn",
              nodes: [`chat_room:${roomId}`, `agent:${agentId}`],
            })
          );
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
      if (retrievalNodeIds.length > 0) {
        ctrl.enqueue(sse({ type: "knowledge_update", roomId, event: "retrieval", nodes: retrievalNodeIds }));
      }
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
          await persistMessages(roomId, userContent, agentId, fullContent);
          // Real node references for this turn — chat_room and agent are both
          // real, persisted KnowledgeObjects (see src/lib/agents/graph.ts,
          // src/app/api/rooms/route.ts). There's no distinct "memory write"
          // node to reference yet: this turn's messages aren't synced as
          // graph objects, and session memory is Redis-only/ephemeral — see
          // docs/GRAPH_OS_ARCHITECTURE_PLAN.md for why that's not faked here.
          ctrl.enqueue(
            sse({
              type: "knowledge_update",
              roomId,
              event: "conversation_turn",
              nodes: [`chat_room:${roomId}`, `agent:${agentId}`],
            })
          );
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
        await persistMessages(roomId, userContent, agentId, fullContent);
        // Emit knowledge_update event into the SSE stream so the graph panel refreshes immediately
        ctrl.enqueue(sse({ type: "knowledge_update", roomId }));
      }
      ctrl.enqueue(sse({ type: "presence", agentId, status: "idle" }));
      ctrl.enqueue(encoder.encode("data: [DONE]\n\n"));
      ctrl.close();
    }
  });
}
