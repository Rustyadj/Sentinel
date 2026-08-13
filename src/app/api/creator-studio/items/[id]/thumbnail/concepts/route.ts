import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";
import { requireOwnedItem } from "@/lib/creator-studio/access";
import { buildBrandContext, getAnthropicKey } from "@/lib/creator-studio/ai";

/**
 * Generates thumbnail CONCEPT TEXT — headline overlay, visual description,
 * color direction. This is not real image generation: there is no image-gen
 * or vision-model integration in this codebase, so it cannot render an actual
 * thumbnail, remove backgrounds, or predict CTR/heatmaps. Those need real
 * image infrastructure and are deferred, not faked.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const item = await requireOwnedItem(id, user.id);
  if (!item) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const apiKey = await getAnthropicKey(req);
  if (!apiKey) {
    return NextResponse.json({ error: "No Anthropic API key" }, { status: 400 });
  }

  const brandContext = await buildBrandContext(item.brandId);
  const systemPrompt =
    `You are a thumbnail concept strategist for a ${item.type} titled "${item.title}".` +
    brandContext +
    `\n\nPropose 4 distinct thumbnail concepts optimized for click-through. Each concept needs short, punchy ` +
    `overlay text (3-6 words max), a description of the visual composition, and a color direction.` +
    `\n\nRespond with ONLY a raw JSON array, no markdown fences, no commentary, in this exact shape: ` +
    `[{"headlineText":"...","visualDescription":"...","colorDirection":"..."}]`;

  const summary = item.description || item.content?.slice(0, 500) || item.title;

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
        messages: [{ role: "user", content: `Content summary: ${summary}` }],
      }),
    });

    if (!response.ok) {
      return NextResponse.json({ error: `API error ${response.status}` }, { status: 502 });
    }

    const data = (await response.json()) as { content?: Array<{ type: string; text?: string }> };
    const text = data.content?.find((c) => c.type === "text")?.text ?? "[]";
    const cleaned = text.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "");

    let concepts: Array<{ headlineText: string; visualDescription: string; colorDirection: string }> = [];
    try {
      const parsed = JSON.parse(cleaned) as typeof concepts;
      if (Array.isArray(parsed)) concepts = parsed;
    } catch {
      concepts = [];
    }

    return NextResponse.json({ concepts });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Generation failed" }, { status: 500 });
  }
}
