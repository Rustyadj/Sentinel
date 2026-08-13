import { NextRequest } from "next/server";
import { requireUser } from "@/lib/current-user";
import { requireOwnedItem } from "@/lib/creator-studio/access";
import { buildBrandContext, getAnthropicKey } from "@/lib/creator-studio/ai";

const MODES = [
  "storytelling",
  "educational",
  "sales",
  "podcast",
  "interview",
  "conversation",
  "technical",
] as const;

const TARGET_INSTRUCTIONS: Record<string, string> = {
  outline:
    "Generate or revise a script outline as a numbered list of concise beats/sections, one per line. Return ONLY the outline lines — no preamble, no markdown fences, no explanation.",
  script:
    "Write or revise the full script prose. Return ONLY the script text — no preamble, no markdown fences, no explanation.",
};

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const item = await requireOwnedItem(id, user.id);
  if (!item) return Response.json({ error: "Not found" }, { status: 404 });

  const body = (await req.json()) as {
    target?: "outline" | "script";
    instruction?: string;
    mode?: (typeof MODES)[number];
    currentContent?: string;
    currentOutline?: string;
  };
  const target = body.target === "outline" ? "outline" : "script";
  const instruction = body.instruction?.trim() || "Write a strong first draft.";

  const apiKey = await getAnthropicKey(req);
  if (!apiKey) {
    return Response.json({ error: "No Anthropic API key" }, { status: 400 });
  }

  const brandContext = await buildBrandContext(item.brandId);
  const modeLine = body.mode && MODES.includes(body.mode) ? `\n\nWrite in ${body.mode} mode.` : "";
  const systemPrompt =
    `You are an expert scriptwriter and content strategist helping a creator produce a ${item.type} titled "${item.title}".` +
    brandContext +
    modeLine +
    `\n\n${TARGET_INSTRUCTIONS[target]}`;

  const contextParts: string[] = [];
  if (body.currentOutline) contextParts.push(`Current outline:\n${body.currentOutline}`);
  if (body.currentContent) contextParts.push(`Current script:\n${body.currentContent}`);
  const userMessage = [instruction, ...contextParts].join("\n\n");

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      function send(data: object) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      }
      try {
        const response = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify({
            model: "claude-sonnet-4-6",
            max_tokens: 4096,
            stream: true,
            system: systemPrompt,
            messages: [{ role: "user", content: userMessage }],
          }),
        });

        if (!response.ok) {
          send({ type: "error", error: `API error ${response.status}` });
          controller.close();
          return;
        }

        const reader = response.body!.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const raw = line.slice(6).trim();
            if (raw === "[DONE]" || raw === "") continue;
            try {
              const evt = JSON.parse(raw) as { type: string; delta?: { type: string; text?: string } };
              if (evt.type === "content_block_delta" && evt.delta?.type === "text_delta" && evt.delta.text) {
                send({ type: "text", text: evt.delta.text });
              }
            } catch {
              /* ignore */
            }
          }
        }
        send({ type: "done" });
      } catch (err) {
        send({ type: "error", error: err instanceof Error ? err.message : "Stream error" });
      } finally {
        controller.close();
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
