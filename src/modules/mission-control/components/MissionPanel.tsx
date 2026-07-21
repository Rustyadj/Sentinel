import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface MissionPanelProps {
  title: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  contentClassName?: string;
  headingLevel?: "h2" | "h3";
}

export function MissionPanel({
  title,
  action,
  children,
  className,
  contentClassName,
  headingLevel = "h2",
}: MissionPanelProps) {
  const Heading = headingLevel;
  return (
    <section className={cn("overflow-hidden rounded-xl border border-[#262d38] bg-[#171c24] text-[#edf1f7] shadow-[0_16px_40px_rgba(15,23,42,0.08)]", className)}>
      <header className="flex min-h-12 items-center justify-between gap-4 border-b border-white/[0.08] px-4 py-2.5">
        <Heading className="text-[12px] font-semibold tracking-[0.035em] text-[#f5f7fb]">{title}</Heading>
        {action}
      </header>
      <div className={contentClassName}>{children}</div>
    </section>
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
