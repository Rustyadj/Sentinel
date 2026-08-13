"use client";

import { useState } from "react";
import { Plus, Trash2, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Brand } from "../types";

export function BrandsView({
  brands,
  activeBrandId,
  onSelectBrand,
  onCreateBrand,
  onDeleteBrand,
}: {
  brands: Brand[];
  activeBrandId: string | null;
  onSelectBrand: (id: string) => void;
  onCreateBrand: (name: string) => Promise<void>;
  onDeleteBrand: (id: string) => void;
}) {
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);

  async function submit() {
    if (!name.trim() || creating) return;
    setCreating(true);
    try {
      await onCreateBrand(name.trim());
      setName("");
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="p-8 max-w-3xl">
      <h1 className="text-lg font-semibold text-[--foreground] mb-1">Brands</h1>
      <p className="text-sm text-[--muted-foreground] mb-6">
        Each brand keeps its own isolated voice, audience, and content — nothing crosses over.
      </p>

      <div className="flex items-center gap-2 mb-6">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder="New brand name…"
          className="flex-1 h-9 rounded-lg border border-[--border] bg-[--muted] px-3 text-sm text-[--foreground] placeholder:text-[--muted-foreground] outline-none focus:border-[--primary]/50"
        />
        <button
          onClick={submit}
          disabled={!name.trim() || creating}
          className="h-9 px-3 rounded-lg bg-[--primary] text-[--primary-foreground] text-sm font-medium disabled:opacity-40 flex items-center gap-1.5"
        >
          <Plus className="w-4 h-4" /> Add brand
        </button>
      </div>

      {brands.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[--border] py-10 text-center text-sm text-[--muted-foreground]">
          No brands yet. Add one above to get started.
        </div>
      ) : (
        <div className="grid gap-2">
          {brands.map((brand) => (
            <div
              key={brand.id}
              className={cn(
                "flex items-center justify-between gap-3 rounded-lg border px-4 py-3 transition-colors",
                brand.id === activeBrandId
                  ? "border-[--primary]/40 bg-[--primary]/5"
                  : "border-[--border] bg-[--card]"
              )}
            >
              <div className="min-w-0">
                <div className="text-sm font-medium text-[--foreground] truncate">{brand.name}</div>
                <div className="text-[10px] text-[--muted-foreground]">
                  /{brand.slug} · {brand._count?.ideas ?? 0} ideas
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {brand.id === activeBrandId ? (
                  <span className="flex items-center gap-1 text-[10px] text-[--primary]">
                    <Check className="w-3 h-3" /> Active
                  </span>
                ) : (
                  <button
                    onClick={() => onSelectBrand(brand.id)}
                    className="text-xs text-[--muted-foreground] hover:text-[--foreground]"
                  >
                    Switch to
                  </button>
                )}
                <button
                  onClick={() => onDeleteBrand(brand.id)}
                  className="text-[--muted-foreground] hover:text-[--destructive] transition-colors"
                >
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
