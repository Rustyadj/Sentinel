"use client";

import { useEffect, useState } from "react";
import { Lightbulb, Layers } from "lucide-react";
import type { Brand } from "../types";

function StatCard({ label, value, icon: Icon }: { label: string; value: number; icon: typeof Lightbulb }) {
  return (
    <div className="rounded-xl border border-[--border] bg-[--card] p-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] uppercase tracking-widest text-[--muted-foreground]">{label}</span>
        <Icon className="w-3.5 h-3.5 text-[--primary]" />
      </div>
      <div className="text-2xl font-semibold text-[--foreground]">{value}</div>
    </div>
  );
}

export function DashboardView({ activeBrand }: { activeBrand: Brand | null }) {
  const [ideaCount, setIdeaCount] = useState<number | null>(null);

  useEffect(() => {
    if (!activeBrand) return;
    fetch(`/api/creator-studio/dashboard?brandId=${activeBrand.id}`)
      .then((r) => r.json())
      .then((data: { ideaCount: number }) => setIdeaCount(data.ideaCount))
      .catch(() => setIdeaCount(null));
  }, [activeBrand]);

  if (!activeBrand) {
    return (
      <div className="p-8 max-w-2xl">
        <h1 className="text-lg font-semibold text-[--foreground] mb-2">Dashboard</h1>
        <p className="text-sm text-[--muted-foreground]">
          Create or select a brand from the switcher to see its dashboard.
        </p>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-4xl">
      <h1 className="text-lg font-semibold text-[--foreground] mb-1">{activeBrand.name}</h1>
      <p className="text-sm text-[--muted-foreground] mb-6">Mission control for this brand.</p>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <StatCard label="Ideas Waiting" value={ideaCount ?? 0} icon={Lightbulb} />
        <StatCard label="Content Items" value={0} icon={Layers} />
      </div>
      <p className="mt-8 text-xs text-[--muted-foreground]">
        Calendar, Projects, and the rest of the production pipeline ship in later phases —
        see the sections list on the left.
      </p>
    </div>
  );
}
