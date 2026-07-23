import { NextRequest } from "next/server";
import { requireUser } from "@/lib/current-user";

const SYSTEM_PROMPT = `You are an expert UI/UX engineer and React developer specializing in Tailwind CSS.
When the user asks you to build something, respond ONLY with complete, working React component code.
- Use Tailwind CSS classes exclusively for styling
- No external imports except React
- Export a default function component
- Make it visually polished, production-ready, and beautiful
- Use realistic placeholder data
- Include hover states, transitions, and micro-interactions
- Dark mode friendly (use neutral colors that work on both)
- Return ONLY the code, no explanation, no markdown fences`;

export async function POST(req: NextRequest) {
  const user = await requireUser().catch(() => null);
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const body = (await req.json()) as { prompt: string; context?: string };
  const allowBrowserKeys = process.env.NODE_ENV !== "production" || process.env.ALLOW_BROWSER_PROVIDER_KEYS === "true";
  const apiKey = process.env.ANTHROPIC_API_KEY ?? (allowBrowserKeys ? req.headers.get("x-anthropic-key") : null);

  if (!apiKey) {
    return Response.json({ error: "No Anthropic API key" }, { status: 400 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      function send(data: object) {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(data)}\n\n`)
        );
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
            system:
              SYSTEM_PROMPT +
              (body.context ? `\n\nContext: ${body.context}` : ""),
            messages: [{ role: "user", content: body.prompt }],
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
              const evt = JSON.parse(raw) as {
                type: string;
                delta?: { type: string; text?: string };
              };
              if (
                evt.type === "content_block_delta" &&
                evt.delta?.type === "text_delta" &&
                evt.delta.text
              ) {
                send({ type: "text", text: evt.delta.text });
              }
            } catch {
              /* ignore */
            }
          }
        }
        send({ type: "done" });
      } catch (err) {
        send({
          type: "error",
          error: err instanceof Error ? err.message : "Stream error",
        });
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
