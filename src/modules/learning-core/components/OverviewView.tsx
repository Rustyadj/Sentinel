"use client";

import { useEffect, useState } from "react";
import { Sparkles, HelpCircle } from "lucide-react";
import Link from "next/link";
import type { CuriosityEvent } from "../types";

function StatCard({ label, value, href }: { label: string; value: string | number; href?: string }) {
  const inner = (
    <div className="rounded-lg border border-[--sidebar-border] bg-[--card] p-4 hover:border-[--primary]/30 transition-colors">
      <div className="text-2xl font-semibold text-[--foreground]">{value}</div>
      <div className="text-xs text-[--muted-foreground] mt-1">{label}</div>
    </div>
  );
  return href ? <Link href={href}>{inner}</Link> : inner;
}

export function OverviewView() {
  const [events, setEvents] = useState<CuriosityEvent[]>([]);

  useEffect(() => {
    fetch("/api/learning-core/curiosity?limit=200")
      .then((r) => r.json())
      .then(setEvents)
      .catch(() => {});
  }, []);

  const unresolved = events.filter((e) => !e.resolved).length;
  const avgScore = events.length ? events.reduce((sum, e) => sum + e.score, 0) / events.length : 0;

  return (
    <div className="p-6 max-w-4xl">
      <h1 className="text-lg font-semibold text-[--foreground] mb-1 flex items-center gap-2">
        <Sparkles className="w-4 h-4 text-[--primary]" /> Learning Core
      </h1>
      <p className="text-sm text-[--muted-foreground] mb-6">
        The intelligence center every agent reports into — recognizing uncertainty, learning
        preferences, and turning experience into measured, reversible improvement.
      </p>

      <div className="grid grid-cols-3 gap-3 mb-8">
        <StatCard label="Curiosity events" value={events.length} href="/learning-core/curiosity" />
        <StatCard label="Unresolved questions" value={unresolved} href="/learning-core/curiosity" />
        <StatCard label="Avg curiosity score" value={avgScore.toFixed(2)} />
      </div>

      <div className="rounded-lg border border-[--sidebar-border] bg-[--card] p-4">
        <h2 className="text-xs font-semibold text-[--foreground] mb-2 flex items-center gap-1.5">
          <HelpCircle className="w-3.5 h-3.5 text-[--primary]" /> What&apos;s live vs. coming
        </h2>
        <p className="text-xs text-[--muted-foreground] leading-relaxed">
          Curiosity is live end-to-end (agent → score → question → resolution → graph node).
          Knowledge Gaps, Reflection, Experience Replay, and Metrics ship next. Hypotheses,
          Experiments, Benchmarks, Skill Library, Improvement Queue, Trust Center, Feature Flags,
          and Evolution Timeline are being built in parallel — see{" "}
          <code className="text-[--foreground]">docs/LEARNING_CORE_PLAN.md</code>.
        </p>
      </div>
    </div>
  );
}
