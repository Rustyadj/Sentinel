import type { ReactNode } from "react";
import type { DataSourceState } from "@/lib/mission-control/types";
import { cn } from "@/lib/utils";

interface MissionPanelProps {
  title: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  contentClassName?: string;
  headingLevel?: "h2" | "h3";
  sourceState?: DataSourceState;
}

export function MissionPanel({
  title,
  action,
  children,
  className,
  contentClassName,
  headingLevel = "h2",
  sourceState,
}: MissionPanelProps) {
  const Heading = headingLevel;
  return (
    <section className={cn("overflow-hidden rounded-xl border border-[#262d38] bg-[#171c24] text-[#edf1f7] shadow-[0_16px_40px_rgba(15,23,42,0.08)]", className)}>
      <header className="flex min-h-12 items-center justify-between gap-4 border-b border-white/[0.08] px-4 py-2.5">
        <Heading className="text-[12px] font-semibold tracking-[0.035em] text-[#f5f7fb]">{title}</Heading>
        <div className="flex items-center gap-2">
          {sourceState ? <DataStateBadge source={sourceState} /> : null}
          {action}
        </div>
      </header>
      <div className={contentClassName}>{children}</div>
    </section>
  );
}

export function DataStateBadge({ source }: { source: DataSourceState }) {
  const styles = {
    live: "border-emerald-400/30 bg-emerald-400/10 text-emerald-300",
    stale: "border-amber-400/30 bg-amber-400/10 text-amber-200",
    unavailable: "border-slate-400/25 bg-slate-400/10 text-slate-300",
    demo: "border-sky-400/30 bg-sky-400/10 text-sky-300",
  };
  return (
    <span title={`${source.source}${source.reason ? `: ${source.reason}` : ""}`} className={cn("inline-flex rounded border px-1.5 py-0.5 text-[8px] font-semibold uppercase tracking-[0.08em]", styles[source.state])}>
      {source.state}
    </span>
  );
}

export function UnavailableState({ source, emptyMessage }: { source: DataSourceState; emptyMessage: string }) {
  return (
    <div className="p-6 text-center">
      <p className="text-[10px] text-[#9ba7b8]">{source.state === "unavailable" ? source.reason ?? `${source.source} is unavailable.` : emptyMessage}</p>
      <p className="mt-1 text-[8px] text-[#667387]">Source: {source.source}</p>
    </div>
  );
}

export function PanelLink({ href, children, label }: { href: string; children: ReactNode; label?: string }) {
  return (
    <a
      href={href}
      aria-label={label}
      className="inline-flex min-h-8 items-center justify-center rounded-md border border-white/[0.11] bg-white/[0.035] px-3 text-[10px] font-medium text-[#d7deea] outline-none transition-colors hover:border-violet-400/40 hover:bg-violet-500/10 hover:text-white focus-visible:ring-2 focus-visible:ring-violet-400/60"
    >
      {children}
    </a>
  );
}

export function StatusDot({ tone, pulse = false }: { tone: "positive" | "warning" | "critical" | "neutral" | "accent"; pulse?: boolean }) {
  const colors = {
    positive: "bg-emerald-400",
    warning: "bg-amber-400",
    critical: "bg-red-400",
    neutral: "bg-slate-400",
    accent: "bg-violet-400",
  };
  return <span aria-hidden className={cn("h-2 w-2 shrink-0 rounded-full", colors[tone], pulse && "animate-pulse-dot")} />;
}
