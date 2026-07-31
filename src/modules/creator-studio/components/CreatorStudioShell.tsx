"use client";

import { useState } from "react";
import Link from "next/link";
import { Clapperboard, ChevronDown, Check, Plus, Lock } from "lucide-react";
import { GraphCanvas } from "@/components/graph/GraphCanvas";
import { cn } from "@/lib/utils";
import type { Brand, CreatorStudioSection } from "../types";

function BrandSwitcher({
  brands,
  activeBrandId,
  onSelectBrand,
  onCreateBrand,
}: {
  brands: Brand[];
  activeBrandId: string | null;
  onSelectBrand: (id: string) => void;
  onCreateBrand: () => void;
}) {
  const [open, setOpen] = useState(false);
  const active = brands.find((b) => b.id === activeBrandId);

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-2 px-2.5 py-2 rounded-lg border border-[--sidebar-border] bg-[--panel] hover:border-[--primary]/40 transition-colors text-left"
      >
        <span className="text-xs font-medium text-[--foreground] truncate">
          {active ? active.name : brands.length ? "Select brand" : "No brands yet"}
        </span>
        <ChevronDown className="w-3.5 h-3.5 text-[--muted-foreground] shrink-0" />
      </button>
      {open && (
        <div className="absolute z-20 mt-1 w-full rounded-lg border border-[--sidebar-border] bg-[--card] shadow-xl overflow-hidden">
          {brands.map((brand) => (
            <button
              key={brand.id}
              onClick={() => {
                onSelectBrand(brand.id);
                setOpen(false);
              }}
              className="w-full flex items-center justify-between gap-2 px-2.5 py-2 text-xs text-[--foreground] hover:bg-[--accent] transition-colors"
            >
              <span className="truncate">{brand.name}</span>
              {brand.id === activeBrandId && <Check className="w-3.5 h-3.5 text-[--primary] shrink-0" />}
            </button>
          ))}
          <button
            onClick={() => {
              onCreateBrand();
              setOpen(false);
            }}
            className="w-full flex items-center gap-2 px-2.5 py-2 text-xs text-[--primary] hover:bg-[--accent] transition-colors border-t border-[--sidebar-border]"
          >
            <Plus className="w-3.5 h-3.5" /> New brand
          </button>
        </div>
      )}
    </div>
  );
}

export function CreatorStudioShell({
  sections,
  activeSection,
  brands,
  activeBrandId,
  onSelectBrand,
  onCreateBrand,
  children,
}: {
  sections: CreatorStudioSection[];
  activeSection: string;
  brands: Brand[];
  activeBrandId: string | null;
  onSelectBrand: (id: string) => void;
  onCreateBrand: () => void;
  children: React.ReactNode;
}) {
  const activeBrand = brands.find((brand) => brand.id === activeBrandId) ?? null;

  return (
    <div className="h-full flex overflow-hidden">
      <div className="w-56 flex flex-col h-full bg-[--sidebar] border-r border-[--sidebar-border] overflow-hidden shrink-0">
        <div className="px-3 py-3 border-b border-[--sidebar-border] space-y-3">
          <span className="text-xs font-semibold text-[--foreground] flex items-center gap-1.5">
            <Clapperboard className="w-3.5 h-3.5 text-[--primary]" /> Creator Studio
          </span>
          <BrandSwitcher
            brands={brands}
            activeBrandId={activeBrandId}
            onSelectBrand={onSelectBrand}
            onCreateBrand={onCreateBrand}
          />
        </div>
        <nav className="flex-1 overflow-y-auto p-2 space-y-0.5">
          {sections.map((section) => {
            const isActive = section.id === activeSection;
            const disabled = section.status === "planned";
            return (
              <Link
                key={section.id}
                href={disabled ? "#" : `/creator-studio/${section.id}`}
                aria-disabled={disabled}
                className={cn(
                  "flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg text-xs transition-colors",
                  isActive
                    ? "bg-[--primary]/15 text-[--primary]"
                    : disabled
                      ? "text-[--muted-foreground]/50 cursor-default pointer-events-none"
                      : "text-[--muted-foreground] hover:bg-white/5 hover:text-[--foreground]"
                )}
              >
                <span className="truncate">{section.label}</span>
                {disabled && <Lock className="w-3 h-3 shrink-0" />}
              </Link>
            );
          })}
        </nav>
      </div>
      <div className="flex-1 min-w-0 overflow-y-auto">{children}</div>
      <aside
        data-creator-studio-cluster
        data-brand-id={activeBrandId ?? undefined}
        className="hidden h-full w-[28%] min-w-[260px] max-w-[420px] shrink-0 border-l border-[--sidebar-border] bg-[#101215] lg:block"
      >
        {activeBrand ? (
          <GraphCanvas
            key={activeBrand.id}
            view="cluster"
            sourceType="brand"
            sourceId={activeBrand.id}
            title={`${activeBrand.name} cluster`}
            className="border-l-0"
          />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[--muted-foreground]">
              Brand cluster
            </span>
            <p className="text-xs leading-relaxed text-[--muted-foreground]">
              Select or create a brand to open its knowledge neighborhood.
            </p>
          </div>
        )}
      </aside>
    </div>
  );
}
