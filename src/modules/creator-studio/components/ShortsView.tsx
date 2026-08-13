"use client";

import { useEffect, useState } from "react";
import { Sparkles, Loader2, Scissors, Plus } from "lucide-react";
import {
  SHORT_PLATFORMS,
  SHORT_PLATFORM_LABELS,
  type Brand,
  type ContentItem,
  type ShortClipCandidate,
} from "../types";

export function ShortsView({ activeBrand }: { activeBrand: Brand | null }) {
  const [items, setItems] = useState<ContentItem[]>([]);
  const [sourceId, setSourceId] = useState<string>("");
  const [candidates, setCandidates] = useState<ShortClipCandidate[]>([]);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState<string | null>(null);

  useEffect(() => {
    if (!activeBrand) return;
    fetch(`/api/creator-studio/items?brandId=${activeBrand.id}`)
      .then((r) => r.json())
      .then((data: ContentItem[]) => setItems(data))
      .catch(() => {});
  }, [activeBrand]);

  const sourceCandidates = items.filter((i) => i.type !== "short" && (i.content?.trim().length ?? 0) > 0);
  const shorts = items.filter((i) => i.type === "short");
  const source = items.find((i) => i.id === sourceId) ?? null;

  async function generate() {
    if (!source || generating) return;
    setGenerating(true);
    setError(null);
    setCandidates([]);
    try {
      const res = await fetch(`/api/creator-studio/items/${source.id}/shorts/generate`, { method: "POST" });
      const data = (await res.json()) as { clips?: ShortClipCandidate[]; error?: string };
      if (!res.ok) {
        setError(data.error ?? "Generation failed");
        return;
      }
      setCandidates(data.clips ?? []);
    } finally {
      setGenerating(false);
    }
  }

  async function createShort(candidate: ShortClipCandidate, platform: string) {
    if (!activeBrand || !source) return;
    const key = `${candidate.excerpt.slice(0, 20)}-${platform}`;
    setCreating(key);
    try {
      const res = await fetch("/api/creator-studio/items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          brandId: activeBrand.id,
          sourceItemId: source.id,
          title: `${source.title} — ${SHORT_PLATFORM_LABELS[platform as keyof typeof SHORT_PLATFORM_LABELS] ?? platform} clip`,
          type: "short",
          platform,
          content: candidate.excerpt,
        }),
      });
      if (res.ok) {
        const item = (await res.json()) as ContentItem;
        setItems((prev) => [item, ...prev]);
      }
    } finally {
      setCreating(null);
    }
  }

  if (!activeBrand) {
    return (
      <div className="p-8 max-w-2xl">
        <h1 className="text-lg font-semibold text-[--foreground] mb-2">Shorts</h1>
        <p className="text-sm text-[--muted-foreground]">Select a brand to generate shorts.</p>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-4xl">
      <h1 className="text-lg font-semibold text-[--foreground] mb-1 flex items-center gap-2">
        <Scissors className="w-5 h-5 text-[--primary]" /> Shorts Generator
      </h1>
      <p className="text-sm text-[--muted-foreground] mb-1">
        Finds the strongest excerpts from a script to repurpose into short-form clips.
      </p>
      <p className="text-xs text-[--muted-foreground] mb-6">
        This analyzes script text, not actual video or audio — there is no video-processing pipeline
        in this app. Write or generate a script first in the Script Builder.
      </p>

      <div className="rounded-xl border border-[--border] bg-[--card] p-4 mb-6">
        <div className="flex items-center gap-2">
          <select
            value={sourceId}
            onChange={(e) => setSourceId(e.target.value)}
            className="flex-1 h-9 rounded-lg border border-[--border] bg-[--muted] px-3 text-sm text-[--foreground]"
          >
            <option value="">Select source content…</option>
            {sourceCandidates.map((i) => (
              <option key={i.id} value={i.id}>{i.title} ({i.type})</option>
            ))}
          </select>
          <button
            onClick={generate}
            disabled={!source || generating}
            className="flex items-center gap-1.5 text-xs bg-[--primary] text-[--primary-foreground] rounded-lg px-3 py-2 disabled:opacity-40 shrink-0"
          >
            {generating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
            {generating ? "Finding moments…" : "Find strongest moments"}
          </button>
        </div>
        {sourceCandidates.length === 0 && (
          <p className="text-xs text-[--muted-foreground] mt-2">
            No content with a script yet — add one in YouTube, Blog, or Podcast first.
          </p>
        )}
        {error && <p className="text-xs text-[--destructive] mt-2">{error}</p>}
      </div>

      {candidates.length > 0 && (
        <div className="space-y-2 mb-8">
          {candidates.map((c, i) => (
            <div key={i} className="rounded-lg border border-[--border] bg-[--card] p-3">
              <p className="text-sm text-[--foreground] mb-1.5">&ldquo;{c.excerpt}&rdquo;</p>
              <p className="text-xs text-[--muted-foreground] mb-2">{c.reason}</p>
              <div className="flex flex-wrap gap-1.5">
                {(c.suggestedPlatforms.length ? c.suggestedPlatforms : [...SHORT_PLATFORMS]).map((p) => {
                  const key = `${c.excerpt.slice(0, 20)}-${p}`;
                  return (
                    <button
                      key={p}
                      onClick={() => createShort(c, p)}
                      disabled={creating === key}
                      className="flex items-center gap-1 text-[10px] border border-[--border] rounded-full px-2 py-1 text-[--foreground] hover:bg-[--muted] disabled:opacity-40"
                    >
                      {creating === key ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
                      {SHORT_PLATFORM_LABELS[p as keyof typeof SHORT_PLATFORM_LABELS] ?? p}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      <h2 className="text-xs font-medium text-[--foreground] mb-3">Created shorts</h2>
      {shorts.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[--border] py-8 text-center text-sm text-[--muted-foreground]">
          No shorts created yet.
        </div>
      ) : (
        <div className="space-y-1.5">
          {shorts.map((s) => (
            <div key={s.id} className="flex items-center justify-between gap-2 rounded-lg border border-[--border] bg-[--card] px-3 py-2.5">
              <div className="min-w-0">
                <div className="text-sm text-[--foreground] truncate">{s.title}</div>
                <div className="text-[10px] text-[--muted-foreground] uppercase">
                  {s.platform ? SHORT_PLATFORM_LABELS[s.platform as keyof typeof SHORT_PLATFORM_LABELS] ?? s.platform : "—"} · {s.status}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
