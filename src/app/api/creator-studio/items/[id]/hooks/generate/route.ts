import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";
import { requireOwnedItem } from "@/lib/creator-studio/access";
import { buildBrandContext, getAnthropicKey } from "@/lib/creator-studio/ai";

const HOOK_STYLES = [
  "curiosity",
  "authority",
  "fear",
  "statistics",
  "question",
  "contrarian",
  "story",
  "problem_solution",
] as const;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const item = await requireOwnedItem(id, user.id);
  if (!item) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = (await req.json()) as { styles?: string[] };
  const styles = (body.styles?.length ? body.styles : [...HOOK_STYLES]).filter((s) =>
    (HOOK_STYLES as readonly string[]).includes(s)
  );

  const apiKey = await getAnthropicKey(req);
  if (!apiKey) {
    return NextResponse.json({ error: "No Anthropic API key" }, { status: 400 });
  }

  const brandContext = await buildBrandContext(item.brandId);
  const systemPrompt =
    `You are a viral hook writer for a ${item.type} titled "${item.title}".` +
    brandContext +
    `\n\nWrite one opening hook (first 1-2 sentences) per requested style: ${styles.join(", ")}.` +
    `\n\nRespond with ONLY a raw JSON array, no markdown fences, no commentary, in this exact shape: ` +
    `[{"style":"curiosity","text":"..."}]`;

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
        max_tokens: 1024,
        system: systemPrompt,
        messages: [{ role: "user", content: `Content summary: ${item.description || item.content?.slice(0, 500) || item.title}` }],
      }),
    });

    if (!response.ok) {
      return NextResponse.json({ error: `API error ${response.status}` }, { status: 502 });
    }

    const data = (await response.json()) as { content?: Array<{ type: string; text?: string }> };
    const text = data.content?.find((c) => c.type === "text")?.text ?? "[]";
    const cleaned = text.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "");

    let variants: Array<{ style: string; text: string }> = [];
    try {
      const parsed = JSON.parse(cleaned) as Array<{ style: string; text: string }>;
      if (Array.isArray(parsed)) variants = parsed;
    } catch {
      variants = [{ style: styles[0] ?? "curiosity", text: cleaned }];
    }

    return NextResponse.json({ variants });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Generation failed" }, { status: 500 });
  }
}
