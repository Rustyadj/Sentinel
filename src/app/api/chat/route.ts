import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { AGENT_TEMPLATES } from "@/lib/constants";
import { db } from "@/lib/db";
import type { NextRequest } from "next/server";

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

  const agentTemplate = AGENT_TEMPLATES.find((a) => a.id === agentId);
  const model = agentTemplate?.model ?? "claude-sonnet-4-6";
  const systemPrompt =
    agentTemplate?.systemPrompt ??
    `You are an AI assistant in the Sentinel OS platform. Be concise and professional.`;

  const provider = pickProvider(model);

  // Keys passed from the browser (user's own credentials)
  const anthropicKey = request.headers.get("x-anthropic-key") ?? "";
  const openaiKey = request.headers.get("x-openai-key") ?? "";
  const openrouterKey = request.headers.get("x-openrouter-key") ?? "";

  // ── Anthropic ─────────────────────────────────────────────────────────────
  if (provider === "anthropic") {
    if (!anthropicKey) return sseError("Anthropic API key not configured — add it in Settings → API Keys");

    return sseStream(async (ctrl) => {
      let fullContent = "";
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
        ctrl.enqueue(encoder.encode("data: [DONE]\n\n"));
        ctrl.close();
        if (roomId && userContent && fullContent) {
          await persistMessages(roomId, userContent, agentId, fullContent);
        }
      }
    });
  }

  // ── OpenAI ────────────────────────────────────────────────────────────────
  if (provider === "openai") {
    if (!openaiKey) return sseError("OpenAI API key not configured — add it in Settings → API Keys");

    return sseStream(async (ctrl) => {
      let fullContent = "";
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
        ctrl.enqueue(encoder.encode("data: [DONE]\n\n"));
        ctrl.close();
        if (roomId && userContent && fullContent) {
          await persistMessages(roomId, userContent, agentId, fullContent);
        }
      }
    });
  }

  // ── OpenRouter (OpenAI-compatible) ────────────────────────────────────────
  if (!openrouterKey) return sseError("OpenRouter API key not configured — add it in Settings → API Keys");

  return sseStream(async (ctrl) => {
    let fullContent = "";
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
      ctrl.enqueue(encoder.encode("data: [DONE]\n\n"));
      ctrl.close();
      if (roomId && userContent && fullContent) {
        await persistMessages(roomId, userContent, agentId, fullContent);
      }
    }
  });
}
