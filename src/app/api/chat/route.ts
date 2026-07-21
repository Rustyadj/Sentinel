import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { AGENT_TEMPLATES } from "@/lib/constants";
import { db } from "@/lib/db";
import { emitEvent } from "@/lib/knowledge/events";
import { retrieveContext } from "@/lib/knowledge/retrieval";
import { requireUser } from "@/lib/current-user";
import type { NextRequest } from "next/server";

async function buildContextBlock(
  roomId: string | undefined,
  memoryScope: string,
  userId: string
): Promise<string> {
  if (!roomId) return "";
  try {
    const room = await db.chatRoom.findFirst({
      where: { id: roomId, userId },
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

    if (totalItems === 0) return "";

    const lines: string[] = ["\n\n## Relevant context"];
    for (const m of memories) lines.push(`- (memory, ${m.scope}) ${m.content}`);
    for (const n of notes) lines.push(`- (note) ${n.title}: ${n.content.slice(0, 200)}`);
    for (const d of decisions) lines.push(`- (decision, ${d.status}) ${d.title}: ${d.summary}`);
    return lines.join("\n");
  } catch (err) {
    console.error("[chat] context retrieval failed:", err);
    return "";
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
  const agentTemplate = AGENT_TEMPLATES.find((a) => a.id === agentId);
  const model = dbAgent?.model ?? agentTemplate?.model ?? "claude-sonnet-4-6";
  const basePrompt =
    dbAgent?.systemPrompt ||
    agentTemplate?.systemPrompt ||
    `You are an AI assistant in the Sentinel OS platform. Be concise and professional.`;
  const memoryScope = dbAgent?.memoryScope ?? agentTemplate?.memoryScope ?? "session";
  const contextBlock = await buildContextBlock(roomId, memoryScope, user.id);
  const systemPrompt = basePrompt + contextBlock;

  const provider = pickProvider(model);

  // Keys passed from the browser (user's own credentials)
  const anthropicKey = request.headers.get("x-anthropic-key") ?? "";
  const openaiKey = request.headers.get("x-openai-key") ?? "";
  const openrouterKey = request.headers.get("x-openrouter-key") ?? process.env.OPENROUTER_API_KEY ?? "";

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
