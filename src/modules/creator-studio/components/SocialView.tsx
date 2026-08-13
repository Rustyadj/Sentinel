"use client";

import { useEffect, useState } from "react";
import { Send, Sparkles, Loader2, Trash2, Share2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { SOCIAL_PLATFORMS, SOCIAL_PLATFORM_LABELS, type Brand, type ContentItem, type SocialPlatform } from "../types";

async function readSSE(response: Response, onToken: (text: string) => void): Promise<void> {
  if (!response.body) return;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        try {
          const parsed = JSON.parse(line.slice(6).trim()) as { type: string; text?: string };
          if (parsed.type === "text" && parsed.text) onToken(parsed.text);
        } catch {
          /* ignore */
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

export function SocialView({ activeBrand }: { activeBrand: Brand | null }) {
  const [items, setItems] = useState<ContentItem[]>([]);
  const [platforms, setPlatforms] = useState<Set<SocialPlatform>>(new Set(["x"]));
  const [content, setContent] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");
  const [posting, setPosting] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [filter, setFilter] = useState<string>("all");

  useEffect(() => {
    if (!activeBrand) return;
    fetch(`/api/creator-studio/items?brandId=${activeBrand.id}&type=social`)
      .then((r) => r.json())
      .then((data: ContentItem[]) => setItems(data))
      .catch(() => {});
  }, [activeBrand]);

  function togglePlatform(p: SocialPlatform) {
    setPlatforms((prev) => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return next;
    });
  }

  async function generateCaption() {
    if (!activeBrand || generating || platforms.size === 0) return;
    setGenerating(true);
    // Use a throwaway draft item as the generation target so brand context still applies.
    let full = "";
    try {
      const draft = await fetch("/api/creator-studio/items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brandId: activeBrand.id, title: "Draft caption", type: "social" }),
      }).then((r) => r.json() as Promise<ContentItem>);

      const res = await fetch(`/api/creator-studio/items/${draft.id}/script/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          target: "script",
          instruction: `Write a short, punchy social media caption for ${[...platforms].join(", ")}.`,
          currentContent: content || undefined,
        }),
      });
      if (res.ok) {
        await readSSE(res, (token) => {
          full += token;
          setContent(full);
        });
      }
      await fetch(`/api/creator-studio/items/${draft.id}`, { method: "DELETE" });
    } finally {
      setGenerating(false);
    }
  }

  async function post() {
    if (!activeBrand || !content.trim() || platforms.size === 0 || posting) return;
    setPosting(true);
    try {
      const created: ContentItem[] = [];
      for (const platform of platforms) {
        const res = await fetch("/api/creator-studio/items", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            brandId: activeBrand.id,
            title: content.slice(0, 60) || `${SOCIAL_PLATFORM_LABELS[platform]} post`,
            type: "social",
            platform,
            scheduledAt: scheduledAt || undefined,
          }),
        });
        if (res.ok) {
          const item = (await res.json()) as ContentItem;
          await fetch(`/api/creator-studio/items/${item.id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ content, status: scheduledAt ? "scheduled" : "review" }),
          });
          created.push({ ...item, content, status: scheduledAt ? "scheduled" : "review" });
        }
      }
      setItems((prev) => [...created, ...prev]);
      setContent("");
      setScheduledAt("");
    } finally {
      setPosting(false);
    }
  }

  async function deleteItem(id: string) {
    setItems((prev) => prev.filter((i) => i.id !== id));
    await fetch(`/api/creator-studio/items/${id}`, { method: "DELETE" });
  }

  if (!activeBrand) {
    return (
      <div className="p-8 max-w-2xl">
        <h1 className="text-lg font-semibold text-[--foreground] mb-2">Social Media</h1>
        <p className="text-sm text-[--muted-foreground]">Select a brand to see its posts.</p>
      </div>
    );
  }

  const visible = filter === "all" ? items : items.filter((i) => i.platform === filter);

  return (
    <div className="p-8 max-w-3xl">
      <h1 className="text-lg font-semibold text-[--foreground] mb-1 flex items-center gap-2">
        <Share2 className="w-5 h-5 text-[--primary]" /> Social Media
      </h1>
      <p className="text-sm text-[--muted-foreground] mb-6">
        Compose once, cross-post to every selected platform for {activeBrand.name}.
      </p>

      <div className="rounded-xl border border-[--border] bg-[--card] p-4 mb-6">
        <div className="flex flex-wrap gap-1.5 mb-3">
          {SOCIAL_PLATFORMS.map((p) => (
            <button
              key={p}
              onClick={() => togglePlatform(p)}
              className={cn(
                "text-[11px] px-2.5 py-1 rounded-full border transition-colors",
                platforms.has(p)
                  ? "border-[--primary]/40 bg-[--primary]/10 text-[--primary]"
                  : "border-[--border] text-[--muted-foreground]"
              )}
            >
              {SOCIAL_PLATFORM_LABELS[p]}
            </button>
          ))}
        </div>
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          rows={4}
          placeholder="What do you want to say?"
          className="w-full rounded-lg border border-[--border] bg-[--muted] px-3 py-2 text-sm text-[--foreground] outline-none focus:border-[--primary]/50 resize-none"
        />
        <div className="flex items-center gap-2 mt-3">
          <button
            onClick={generateCaption}
            disabled={generating || platforms.size === 0}
            className="flex items-center gap-1.5 text-xs border border-[--border] rounded-lg px-2.5 py-1.5 text-[--foreground] hover:bg-[--muted] disabled:opacity-40"
          >
            {generating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
            {generating ? "Writing…" : "Generate caption"}
          </button>
          <input
            type="datetime-local"
            value={scheduledAt}
            onChange={(e) => setScheduledAt(e.target.value)}
            className="h-8 rounded-lg border border-[--border] bg-[--muted] px-2 text-xs text-[--foreground]"
          />
          <button
            onClick={post}
            disabled={!content.trim() || platforms.size === 0 || posting}
            className="ml-auto flex items-center gap-1.5 text-xs bg-[--primary] text-[--primary-foreground] rounded-lg px-3 py-1.5 disabled:opacity-40"
          >
            <Send className="w-3.5 h-3.5" /> {scheduledAt ? "Schedule" : "Save draft"}
          </button>
        </div>
      </div>

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
        {SOCIAL_PLATFORMS.map((p) => {
          const count = items.filter((i) => i.platform === p).length;
          if (count === 0) return null;
          return (
            <button
              key={p}
              onClick={() => setFilter(p)}
              className={cn(
                "text-[11px] px-2.5 py-1 rounded-full border",
                filter === p ? "border-[--primary]/40 bg-[--primary]/10 text-[--primary]" : "border-[--border] text-[--muted-foreground]"
              )}
            >
              {SOCIAL_PLATFORM_LABELS[p]} ({count})
            </button>
          );
        })}
      </div>

      {visible.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[--border] py-10 text-center text-sm text-[--muted-foreground]">
          No posts yet.
        </div>
      ) : (
        <div className="space-y-1.5">
          {visible.map((item) => (
            <div key={item.id} className="rounded-lg border border-[--border] bg-[--card] p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-[9px] uppercase px-1.5 py-0.5 rounded bg-[--muted] text-[--muted-foreground]">
                      {item.platform ? SOCIAL_PLATFORM_LABELS[item.platform as SocialPlatform] ?? item.platform : "—"}
                    </span>
                    <span className="text-[9px] uppercase text-[--muted-foreground]">{item.status}</span>
                  </div>
                  <p className="text-xs text-[--foreground] line-clamp-2">{item.content || item.title}</p>
                </div>
                <button onClick={() => deleteItem(item.id)} className="text-[--muted-foreground] hover:text-[--destructive] shrink-0">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
