"use client";

import { useEffect, useState } from "react";
import { Plus, Video, FileText } from "lucide-react";
import { ScriptBuilder } from "./ScriptBuilder";
import type { Brand, ContentItem } from "../types";

export function YouTubeView({ activeBrand }: { activeBrand: Brand | null }) {
  const [items, setItems] = useState<ContentItem[]>([]);
  const [title, setTitle] = useState("");
  const [openItem, setOpenItem] = useState<ContentItem | null>(null);

  useEffect(() => {
    if (!activeBrand) return;
    fetch(`/api/creator-studio/items?brandId=${activeBrand.id}`)
      .then((r) => r.json())
      .then((data: ContentItem[]) => setItems(data.filter((i) => i.type === "video")))
      .catch(() => {});
  }, [activeBrand]);

  async function addItem() {
    if (!activeBrand || !title.trim()) return;
    const res = await fetch("/api/creator-studio/items", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ brandId: activeBrand.id, title: title.trim(), type: "video" }),
    });
    if (res.ok) {
      const item = (await res.json()) as ContentItem;
      setItems((prev) => [{ ...item, chapters: [], outline: [] }, ...prev]);
      setTitle("");
    }
  }

  async function openFull(item: ContentItem) {
    const res = await fetch(`/api/creator-studio/items/${item.id}`);
    if (res.ok) {
      const full = (await res.json()) as ContentItem;
      setOpenItem(full);
    }
  }

  function handleUpdated(updated: ContentItem) {
    setItems((prev) => prev.map((i) => (i.id === updated.id ? { ...i, ...updated } : i)));
    setOpenItem(updated);
  }

  if (!activeBrand) {
    return (
      <div className="p-8 max-w-2xl">
        <h1 className="text-lg font-semibold text-[--foreground] mb-2">YouTube</h1>
        <p className="text-sm text-[--muted-foreground]">Select a brand to see its videos.</p>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-3xl">
      <h1 className="text-lg font-semibold text-[--foreground] mb-1 flex items-center gap-2">
        <Video className="w-5 h-5 text-red-500" /> YouTube
      </h1>
      <p className="text-sm text-[--muted-foreground] mb-6">
        Scripts, titles, descriptions, tags, and chapters for {activeBrand.name}&rsquo;s videos.
      </p>

      <div className="flex items-center gap-2 mb-6">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addItem()}
          placeholder="New video title…"
          className="flex-1 h-9 rounded-lg border border-[--border] bg-[--muted] px-3 text-sm text-[--foreground] placeholder:text-[--muted-foreground] outline-none focus:border-[--primary]/50"
        />
        <button
          onClick={addItem}
          disabled={!title.trim()}
          className="h-9 px-3 rounded-lg bg-[--primary] text-[--primary-foreground] text-sm font-medium disabled:opacity-40 flex items-center gap-1.5"
        >
          <Plus className="w-4 h-4" /> Add video
        </button>
      </div>

      {items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[--border] py-10 text-center text-sm text-[--muted-foreground]">
          No videos yet.
        </div>
      ) : (
        <div className="space-y-1.5">
          {items.map((item) => (
            <button
              key={item.id}
              onClick={() => openFull(item)}
              className="w-full flex items-center justify-between gap-2 rounded-lg border border-[--border] bg-[--card] hover:border-[--primary]/30 px-3 py-2.5 text-left transition-colors"
            >
              <div className="min-w-0 flex items-center gap-2">
                <FileText className="w-3.5 h-3.5 text-[--muted-foreground] shrink-0" />
                <span className="text-sm text-[--foreground] truncate">{item.title}</span>
              </div>
              <span className="text-[10px] text-[--muted-foreground] uppercase shrink-0">{item.status}</span>
            </button>
          ))}
        </div>
      )}

      {openItem && (
        <ScriptBuilder item={openItem} onClose={() => setOpenItem(null)} onUpdated={handleUpdated} />
      )}
    </div>
  );
}
