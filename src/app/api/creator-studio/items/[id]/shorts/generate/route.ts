import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";
import { requireOwnedItem } from "@/lib/creator-studio/access";
import { buildBrandContext, getAnthropicKey } from "@/lib/creator-studio/ai";

/**
 * Identifies short-form-worthy moments from the SOURCE ITEM'S SCRIPT TEXT.
 * This is text analysis, not real video/audio processing — there is no
 * transcription, scene-detection, or video pipeline in this codebase. If the
 * source item has no script content, there is nothing to analyze.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const item = await requireOwnedItem(id, user.id);
  if (!item) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const sourceText = item.content?.trim();
  if (!sourceText) {
    return NextResponse.json(
      { error: "This item has no script content yet — write or generate one first in the Script Builder." },
      { status: 400 }
    );
  }

  const apiKey = await getAnthropicKey(req);
  if (!apiKey) {
    return NextResponse.json({ error: "No Anthropic API key" }, { status: 400 });
  }

  const brandContext = await buildBrandContext(item.brandId);
  const systemPrompt =
    `You analyze long-form scripts and identify the strongest self-contained excerpts for short-form ` +
    `video repurposing (YouTube Shorts, TikTok, Instagram Reels, Facebook Reels, LinkedIn clips, X videos).` +
    brandContext +
    `\n\nFind up to 5 excerpts from the provided script that work as standalone short-form clips — a strong ` +
    `hook, a surprising fact, a quotable moment, or a complete mini-story. Quote the excerpt verbatim from ` +
    `the script (do not paraphrase). Respond with ONLY a raw JSON array, no markdown fences, no commentary, ` +
    `in this exact shape: [{"excerpt":"...","reason":"why this works as a short","suggestedPlatforms":["tiktok","youtube_shorts"]}]`;

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
        max_tokens: 2048,
        system: systemPrompt,
        messages: [{ role: "user", content: `Script for "${item.title}":\n\n${sourceText}` }],
      }),
    });

    if (!response.ok) {
      return NextResponse.json({ error: `API error ${response.status}` }, { status: 502 });
    }

    const data = (await response.json()) as { content?: Array<{ type: string; text?: string }> };
    const text = data.content?.find((c) => c.type === "text")?.text ?? "[]";
    const cleaned = text.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "");

    let clips: Array<{ excerpt: string; reason: string; suggestedPlatforms: string[] }> = [];
    try {
      const parsed = JSON.parse(cleaned) as typeof clips;
      if (Array.isArray(parsed)) clips = parsed;
    } catch {
      clips = [];
    }

    return NextResponse.json({ clips });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Generation failed" }, { status: 500 });
  }
}
