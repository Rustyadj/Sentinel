import Link from "next/link";
import { ArrowUpRight, AudioLines, BotMessageSquare, BrainCircuit, Play } from "lucide-react";
import type { MissionControlData } from "@/lib/mission-control/types";
import { cn } from "@/lib/utils";

const toneStyles = {
  critical: "text-red-300",
  warning: "text-amber-300",
  positive: "text-emerald-300",
  neutral: "text-sky-300",
};

const actions = [
  { label: "Continue Working", href: "#continue-work", icon: Play, primary: true },
  { label: "Start Voice", href: "/chat?voice=1", icon: AudioLines },
  { label: "Ask Sentinel", href: "/chat", icon: BotMessageSquare },
  { label: "Open Neural Space", href: "/chat?space=graph", icon: BrainCircuit },
];

export function MissionBrief({ data }: { data: MissionControlData }) {
  return (
    <section aria-labelledby="mission-brief-title" className="overflow-hidden rounded-xl border border-[#253044] bg-[#101925] text-[#eef2f8] shadow-[0_18px_50px_rgba(15,23,42,0.12)]">
      <div className="grid gap-0 xl:grid-cols-[minmax(310px,0.78fr)_minmax(0,1.65fr)]">
        <div className="border-b border-white/[0.08] p-5 xl:border-b-0 xl:border-r">
          <div className="mb-3 flex items-center justify-between gap-3">
            <span className="text-[10px] font-semibold tracking-[0.12em] text-violet-300">MISSION BRIEF</span>
            <span className="text-[10px] text-[#8491a3]">Updated just now</span>
          </div>
          <h1 id="mission-brief-title" className="text-[24px] font-semibold tracking-[-0.02em] text-white">
            Good morning, {data.greetingName}
          </h1>
          <p className="mt-2 max-w-xl text-[12px] leading-5 text-[#aeb8c7]">{data.operationalSummary}</p>
          <div className="mt-5 flex flex-wrap gap-2">
            {actions.map(({ label, href, icon: Icon, primary }) => (
              <Link
                key={label}
                href={href}
                className={cn(
                  "inline-flex h-9 items-center gap-2 rounded-md border px-3.5 text-[11px] font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-violet-300/70",
                  primary
                    ? "border-violet-400/70 bg-violet-600 text-white shadow-[0_7px_20px_rgba(109,74,255,0.24)] hover:bg-violet-500"
                    : "border-white/[0.14] bg-white/[0.025] text-[#d9e0ea] hover:border-violet-400/35 hover:bg-violet-500/10"
                )}
              >
                <Icon className="h-3.5 w-3.5 stroke-[1.7]" />
                {label}
              </Link>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5">
          {data.summaryMetrics.map((metric) => (
            <div key={metric.id} className="min-w-0 border-b border-r border-white/[0.07] p-4 last:border-r-0 sm:[&:nth-last-child(-n+2)]:border-b-0 xl:border-b-0">
              <div className="min-h-8 text-[9px] font-semibold uppercase leading-4 tracking-[0.06em] text-[#8794a7]">{metric.label}</div>
              <div className={cn("mt-1 text-3xl font-semibold tabular-nums", toneStyles[metric.tone])}>{metric.value}</div>
              <div className="mt-1 min-h-8 text-[10px] leading-4 text-[#9aa6b7]">{metric.detail}</div>
              <Link href={metric.href} className="mt-2 inline-flex items-center gap-1 text-[10px] font-medium text-violet-300 outline-none hover:text-violet-200 focus-visible:ring-2 focus-visible:ring-violet-400/60">
                {metric.actionLabel}<ArrowUpRight className="h-3 w-3" />
              </Link>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
