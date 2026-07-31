"use client";

import { useEffect, useState } from "react";
import { Sparkles, Loader2, Image as ImageIcon, Save, Check } from "lucide-react";
import type { Brand, ContentItem, ThumbnailConcept } from "../types";

export function ThumbnailStudioView({ activeBrand }: { activeBrand: Brand | null }) {
  const [items, setItems] = useState<ContentItem[]>([]);
  const [itemId, setItemId] = useState<string>("");
  const [concepts, setConcepts] = useState<ThumbnailConcept[]>([]);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [thumbnailUrl, setThumbnailUrl] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!activeBrand) return;
    fetch(`/api/creator-studio/items?brandId=${activeBrand.id}`)
      .then((r) => r.json())
      .then((data: ContentItem[]) => setItems(data.filter((i) => ["video", "short"].includes(i.type))))
      .catch(() => {});
  }, [activeBrand]);

  const item = items.find((i) => i.id === itemId) ?? null;

  function selectItem(id: string) {
    setItemId(id);
    const next = items.find((i) => i.id === id) ?? null;
    setThumbnailUrl(next?.thumbnailUrl ?? "");
    setConcepts([]);
  }

  async function generate() {
    if (!item || generating) return;
    setGenerating(true);
    setError(null);
    try {
      const res = await fetch(`/api/creator-studio/items/${item.id}/thumbnail/concepts`, { method: "POST" });
      const data = (await res.json()) as { concepts?: ThumbnailConcept[]; error?: string };
      if (!res.ok) {
        setError(data.error ?? "Generation failed");
        return;
      }
      setConcepts(data.concepts ?? []);
    } finally {
      setGenerating(false);
    }
  }

  async function saveThumbnail() {
    if (!item) return;
    setSaving(true);
    const res = await fetch(`/api/creator-studio/items/${item.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ thumbnailUrl: thumbnailUrl || null }),
    });
    setSaving(false);
    if (res.ok) {
      const updated = (await res.json()) as ContentItem;
      setItems((prev) => prev.map((i) => (i.id === updated.id ? updated : i)));
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    }
  }

  if (!activeBrand) {
    return (
      <div className="p-8 max-w-2xl">
        <h1 className="text-lg font-semibold text-[--foreground] mb-2">Thumbnail Studio</h1>
        <p className="text-sm text-[--muted-foreground]">Select a brand to work on thumbnails.</p>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-3xl">
      <h1 className="text-lg font-semibold text-[--foreground] mb-1 flex items-center gap-2">
        <ImageIcon className="w-5 h-5 text-[--primary]" /> Thumbnail Studio
      </h1>
      <p className="text-sm text-[--muted-foreground] mb-1">
        AI-generated concepts (headline, composition, color direction) for a video or short.
      </p>
      <p className="text-xs text-[--muted-foreground] mb-6">
        No image generation, background removal, or CTR/heatmap prediction here — there is no
        image-gen or vision-model integration in this app yet. Design the actual image elsewhere
        and paste its URL below.
      </p>

      <div className="rounded-xl border border-[--border] bg-[--card] p-4 mb-6">
        <select
          value={itemId}
          onChange={(e) => selectItem(e.target.value)}
          className="w-full h-9 rounded-lg border border-[--border] bg-[--muted] px-3 text-sm text-[--foreground] mb-3"
        >
          <option value="">Select a video or short…</option>
          {items.map((i) => (
            <option key={i.id} value={i.id}>{i.title} ({i.type})</option>
          ))}
        </select>

        {item && (
          <>
            <div className="flex items-center gap-2 mb-3">
              <input
                value={thumbnailUrl}
                onChange={(e) => setThumbnailUrl(e.target.value)}
                placeholder="Final thumbnail image URL…"
                className="flex-1 h-9 rounded-lg border border-[--border] bg-[--muted] px-3 text-sm text-[--foreground] outline-none focus:border-[--primary]/50"
              />
              <button
                onClick={saveThumbnail}
                disabled={saving}
                className="flex items-center gap-1.5 text-xs bg-[--primary] text-[--primary-foreground] rounded-lg px-3 py-2 disabled:opacity-60 shrink-0"
              >
                {saved ? <Check className="w-3.5 h-3.5" /> : <Save className="w-3.5 h-3.5" />}
                {saving ? "Saving…" : saved ? "Saved" : "Save"}
              </button>
            </div>
            <button
              onClick={generate}
              disabled={generating}
              className="flex items-center gap-1.5 text-xs border border-[--border] rounded-lg px-3 py-1.5 text-[--foreground] hover:bg-[--muted] disabled:opacity-40"
            >
              {generating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
              {generating ? "Generating…" : "Generate concepts"}
            </button>
            {error && <p className="text-xs text-[--destructive] mt-2">{error}</p>}
          </>
        )}
      </div>

      {item?.thumbnailUrl && (
        <div className="mb-6">
          <div className="text-[10px] uppercase tracking-widest text-[--muted-foreground] mb-2">Current thumbnail</div>
          <a href={item.thumbnailUrl} target="_blank" rel="noreferrer" className="text-xs text-[--primary] hover:underline">
            {item.thumbnailUrl}
          </a>
        </div>
      )}

      {concepts.length > 0 && (
        <div className="grid sm:grid-cols-2 gap-3">
          {concepts.map((c, i) => (
            <div key={i} className="rounded-lg border border-[--border] bg-[--card] p-3">
              <div className="text-sm font-semibold text-[--foreground] mb-1.5">{c.headlineText}</div>
              <p className="text-xs text-[--muted-foreground] mb-1.5">{c.visualDescription}</p>
              <div className="text-[10px] text-[--primary]">{c.colorDirection}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
