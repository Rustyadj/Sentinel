"use client";

import { useEffect, useState } from "react";
import { Plus, Trash2, ExternalLink, Layers } from "lucide-react";
import { cn } from "@/lib/utils";
import { ASSET_CATEGORIES, ASSET_CATEGORY_LABELS, type Asset, type Brand } from "../types";

export function AssetLibraryView({ activeBrand }: { activeBrand: Brand | null }) {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [filter, setFilter] = useState<string>("all");
  const [name, setName] = useState("");
  const [category, setCategory] = useState<string>("photo");
  const [url, setUrl] = useState("");
  const [tagsText, setTagsText] = useState("");

  useEffect(() => {
    if (!activeBrand) return;
    fetch(`/api/creator-studio/assets?brandId=${activeBrand.id}`)
      .then((r) => r.json())
      .then((data: Asset[]) => setAssets(data))
      .catch(() => {});
  }, [activeBrand]);

  async function addAsset() {
    if (!activeBrand || !name.trim() || !url.trim()) return;
    const res = await fetch("/api/creator-studio/assets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        brandId: activeBrand.id,
        name: name.trim(),
        category,
        url: url.trim(),
        tags: tagsText.split(",").map((t) => t.trim()).filter(Boolean),
      }),
    });
    if (res.ok) {
      const asset = (await res.json()) as Asset;
      setAssets((prev) => [asset, ...prev]);
      setName("");
      setUrl("");
      setTagsText("");
    }
  }

  async function deleteAsset(id: string) {
    setAssets((prev) => prev.filter((a) => a.id !== id));
    await fetch(`/api/creator-studio/assets/${id}`, { method: "DELETE" });
  }

  if (!activeBrand) {
    return (
      <div className="p-8 max-w-2xl">
        <h1 className="text-lg font-semibold text-[--foreground] mb-2">Asset Library</h1>
        <p className="text-sm text-[--muted-foreground]">Select a brand to see its assets.</p>
      </div>
    );
  }

  const visible = filter === "all" ? assets : assets.filter((a) => a.category === filter);

  return (
    <div className="p-8 max-w-5xl">
      <h1 className="text-lg font-semibold text-[--foreground] mb-1 flex items-center gap-2">
        <Layers className="w-5 h-5 text-[--primary]" /> Asset Library
      </h1>
      <p className="text-sm text-[--muted-foreground] mb-6">
        Every video, photo, logo, font, and template for {activeBrand.name}, referenced by URL.
      </p>

      <div className="rounded-xl border border-[--border] bg-[--card] p-4 mb-6">
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Asset name"
            className="h-9 rounded-lg border border-[--border] bg-[--muted] px-3 text-sm text-[--foreground] outline-none focus:border-[--primary]/50"
          />
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="h-9 rounded-lg border border-[--border] bg-[--muted] px-3 text-sm text-[--foreground]"
          >
            {ASSET_CATEGORIES.map((c) => (
              <option key={c} value={c}>{ASSET_CATEGORY_LABELS[c]}</option>
            ))}
          </select>
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://…"
            className="h-9 rounded-lg border border-[--border] bg-[--muted] px-3 text-sm text-[--foreground] outline-none focus:border-[--primary]/50"
          />
          <input
            value={tagsText}
            onChange={(e) => setTagsText(e.target.value)}
            placeholder="tags, comma, separated"
            className="h-9 rounded-lg border border-[--border] bg-[--muted] px-3 text-sm text-[--foreground] outline-none focus:border-[--primary]/50"
          />
        </div>
        <button
          onClick={addAsset}
          disabled={!name.trim() || !url.trim()}
          className="mt-3 flex items-center gap-1.5 text-xs bg-[--primary] text-[--primary-foreground] rounded-lg px-3 py-1.5 disabled:opacity-40"
        >
          <Plus className="w-3.5 h-3.5" /> Add asset
        </button>
      </div>

      <div className="flex flex-wrap gap-1.5 mb-4">
        <button
          onClick={() => setFilter("all")}
          className={cn(
            "text-[11px] px-2.5 py-1 rounded-full border",
            filter === "all" ? "border-[--primary]/40 bg-[--primary]/10 text-[--primary]" : "border-[--border] text-[--muted-foreground]"
          )}
        >
          All ({assets.length})
        </button>
        {ASSET_CATEGORIES.map((c) => {
          const count = assets.filter((a) => a.category === c).length;
          if (count === 0) return null;
          return (
            <button
              key={c}
              onClick={() => setFilter(c)}
              className={cn(
                "text-[11px] px-2.5 py-1 rounded-full border",
                filter === c ? "border-[--primary]/40 bg-[--primary]/10 text-[--primary]" : "border-[--border] text-[--muted-foreground]"
              )}
            >
              {ASSET_CATEGORY_LABELS[c as keyof typeof ASSET_CATEGORY_LABELS]} ({count})
            </button>
          );
        })}
      </div>

      {visible.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[--border] py-10 text-center text-sm text-[--muted-foreground]">
          No assets in this category yet.
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {visible.map((asset) => (
            <div key={asset.id} className="rounded-lg border border-[--border] bg-[--card] p-3">
              <div className="flex items-start justify-between gap-2 mb-1.5">
                <span className="text-sm text-[--foreground] font-medium truncate">{asset.name}</span>
                <button onClick={() => deleteAsset(asset.id)} className="text-[--muted-foreground] hover:text-[--destructive] shrink-0">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
              <div className="flex items-center gap-1.5 text-[10px] text-[--muted-foreground] mb-2">
                <span className="uppercase">{ASSET_CATEGORY_LABELS[asset.category as keyof typeof ASSET_CATEGORY_LABELS] ?? asset.category}</span>
                <span>· v{asset.version}</span>
              </div>
              <a
                href={asset.url}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1 text-[11px] text-[--primary] hover:underline truncate"
              >
                <ExternalLink className="w-3 h-3 shrink-0" /> {asset.url}
              </a>
              {asset.tags.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-2">
                  {asset.tags.map((tag) => (
                    <span key={tag} className="text-[9px] px-1.5 py-0.5 rounded bg-[--muted] text-[--muted-foreground]">
                      {tag}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
