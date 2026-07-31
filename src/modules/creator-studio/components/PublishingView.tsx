"use client";

import { useEffect, useState } from "react";
import { Rocket, RotateCcw, Loader2, CheckCircle2, XCircle, Clock3 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Brand, ContentItem, ContentItemStatus } from "../types";

const QUEUE_STATUSES: ContentItemStatus[] = ["review", "scheduled", "publishing", "published", "failed"];

const STATUS_ICON: Partial<Record<ContentItemStatus, typeof Clock3>> = {
  review: Clock3,
  scheduled: Clock3,
  publishing: Loader2,
  published: CheckCircle2,
  failed: XCircle,
};

const STATUS_COLOR: Partial<Record<ContentItemStatus, string>> = {
  review: "text-[--muted-foreground]",
  scheduled: "text-blue-400",
  publishing: "text-amber-400",
  published: "text-emerald-400",
  failed: "text-red-400",
};

export function PublishingView({ activeBrand }: { activeBrand: Brand | null }) {
  const [items, setItems] = useState<ContentItem[]>([]);
  const [filter, setFilter] = useState<ContentItemStatus | "all">("all");
  const [publishingId, setPublishingId] = useState<string | null>(null);

  useEffect(() => {
    if (!activeBrand) return;
    fetch(`/api/creator-studio/items?brandId=${activeBrand.id}`)
      .then((r) => r.json())
      .then((data: ContentItem[]) => setItems(data.filter((i) => QUEUE_STATUSES.includes(i.status))))
      .catch(() => {});
  }, [activeBrand]);

  async function publishNow(item: ContentItem) {
    setPublishingId(item.id);
    setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, status: "publishing" } : i)));
    try {
      const res = await fetch(`/api/creator-studio/items/${item.id}/publish`, { method: "POST" });
      if (res.ok) {
        const { item: updated } = (await res.json()) as { item: ContentItem };
        setItems((prev) => prev.map((i) => (i.id === item.id ? updated : i)));
      } else {
        setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, status: "failed" } : i)));
      }
    } finally {
      setPublishingId(null);
    }
  }

  async function setStatus(item: ContentItem, status: ContentItemStatus) {
    setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, status } : i)));
    await fetch(`/api/creator-studio/items/${item.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
  }

  if (!activeBrand) {
    return (
      <div className="p-8 max-w-2xl">
        <h1 className="text-lg font-semibold text-[--foreground] mb-2">Publishing</h1>
        <p className="text-sm text-[--muted-foreground]">Select a brand to see its publishing queue.</p>
      </div>
    );
  }

  const visible = filter === "all" ? items : items.filter((i) => i.status === filter);

  return (
    <div className="p-8 max-w-4xl">
      <h1 className="text-lg font-semibold text-[--foreground] mb-1 flex items-center gap-2">
        <Rocket className="w-5 h-5 text-[--primary]" /> Publishing
      </h1>
      <p className="text-sm text-[--muted-foreground] mb-1">
        Unified queue across every content type and platform for {activeBrand.name}.
      </p>
      <p className="text-xs text-[--muted-foreground] mb-6">
        No platform integrations are connected yet (YouTube/TikTok/Meta/etc.) — Publish now
        simulates a successful publish so the workflow is real; it doesn&rsquo;t call a live API.
      </p>

      <div className="flex flex-wrap gap-1.5 mb-4">
        <button
          onClick={() => setFilter("all")}
          className={cn(
            "text-[11px] px-2.5 py-1 rounded-full border",
            filter === "all" ? "border-[--primary]/40 bg-[--primary]/10 text-[--primary]" : "border-[--border] text-[--muted-foreground]"
          )}
        >
          All ({items.length})
        </button>
        {QUEUE_STATUSES.map((s) => {
          const count = items.filter((i) => i.status === s).length;
          if (count === 0) return null;
          return (
            <button
              key={s}
              onClick={() => setFilter(s)}
              className={cn(
                "text-[11px] px-2.5 py-1 rounded-full border capitalize",
                filter === s ? "border-[--primary]/40 bg-[--primary]/10 text-[--primary]" : "border-[--border] text-[--muted-foreground]"
              )}
            >
              {s} ({count})
            </button>
          );
        })}
      </div>

      {visible.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[--border] py-10 text-center text-sm text-[--muted-foreground]">
          Nothing in the queue.
        </div>
      ) : (
        <div className="space-y-1.5">
          {visible.map((item) => {
            const Icon = STATUS_ICON[item.status] ?? Clock3;
            return (
              <div key={item.id} className="flex items-center gap-3 rounded-lg border border-[--border] bg-[--card] px-3 py-2.5">
                <Icon className={cn("w-4 h-4 shrink-0", STATUS_COLOR[item.status], item.status === "publishing" && "animate-spin")} />
                <div className="min-w-0 flex-1">
                  <div className="text-sm text-[--foreground] truncate">{item.title}</div>
                  <div className="text-[10px] text-[--muted-foreground] uppercase">
                    {item.type} {item.platform ? `· ${item.platform}` : ""} · {item.status}
                  </div>
                </div>
                {(item.status === "review" || item.status === "scheduled") && (
                  <button
                    onClick={() => publishNow(item)}
                    disabled={publishingId === item.id}
                    className="flex items-center gap-1.5 text-xs bg-[--primary] text-[--primary-foreground] rounded-lg px-2.5 py-1.5 disabled:opacity-40 shrink-0"
                  >
                    <Rocket className="w-3.5 h-3.5" /> Publish now
                  </button>
                )}
                {item.status === "failed" && (
                  <button
                    onClick={() => publishNow(item)}
                    disabled={publishingId === item.id}
                    className="flex items-center gap-1.5 text-xs border border-[--border] rounded-lg px-2.5 py-1.5 text-[--foreground] hover:bg-[--muted] disabled:opacity-40 shrink-0"
                  >
                    <RotateCcw className="w-3.5 h-3.5" /> Retry
                  </button>
                )}
                {item.status === "published" && (
                  <select
                    value={item.status}
                    onChange={(e) => setStatus(item, e.target.value as ContentItemStatus)}
                    className="h-7 text-[10px] rounded border border-[--border] bg-[--muted] px-1.5 text-[--foreground] shrink-0"
                  >
                    <option value="published">Published</option>
                    <option value="archived">Archive</option>
                  </select>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
