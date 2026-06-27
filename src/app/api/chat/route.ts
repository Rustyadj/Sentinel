import Anthropic from "@anthropic-ai/sdk";
import { AGENT_TEMPLATES } from "@/lib/constants";
import type { NextRequest } from "next/server";

const encoder = new TextEncoder();

function sse(data: object): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify(data)}\n\n`);
}

function sseError(message: string): Response {
  const stream = new ReadableStream({
    start(ctrl) {
      ctrl.enqueue(sse({ type: "error", error: message }));
      ctrl.enqueue(encoder.encode("data: [DONE]\n\n"));
      ctrl.close();
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

export async function POST(request: NextRequest) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return sseError("ANTHROPIC_API_KEY is not configured");
  }

  let body: {
    messages: Array<{ role: "user" | "assistant"; content: string }>;
    agentId: string;
  };

  try {
    body = await request.json();
  } catch {
    return sseError("Invalid request body");
  }

  const { messages, agentId } = body;

  if (!messages?.length || !agentId) {
    return sseError("Missing required fields: messages, agentId");
  }

  const agentTemplate = AGENT_TEMPLATES.find((a) => a.id === agentId);
  const systemPrompt =
    agentTemplate?.systemPrompt ??
    `You are ${agentTemplate?.name ?? "an AI assistant"} in the HermesOS platform. Be concise, helpful, and professional.`;

  const anthropic = new Anthropic({ apiKey });

  const stream = new ReadableStream({
    async start(ctrl) {
      try {
        const response = await anthropic.messages.create({
          model: agentTemplate?.model?.startsWith("claude")
            ? agentTemplate.model
            : "claude-sonnet-4-6",
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
            ctrl.enqueue(sse({ type: "text", text: event.delta.text }));
          }
          if (event.type === "message_stop") {
            ctrl.enqueue(encoder.encode("data: [DONE]\n\n"));
            ctrl.close();
            return;
          }
        }

        ctrl.enqueue(encoder.encode("data: [DONE]\n\n"));
        ctrl.close();
      } catch (err) {
        const msg =
          err instanceof Error ? err.message : "Upstream API error";
        ctrl.enqueue(sse({ type: "error", error: msg }));
        ctrl.enqueue(encoder.encode("data: [DONE]\n\n"));
        ctrl.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
