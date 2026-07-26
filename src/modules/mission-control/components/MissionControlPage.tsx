"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import type { MissionControlData, MissionControlService } from "@/lib/mission-control/types";
import { missionControlService } from "@/lib/mission-control/service";
import { MissionBrief } from "./MissionBrief";
import { ContinueWork } from "./ContinueWork";
import { AttentionQueue } from "./AttentionQueue";
import { AgentOperations } from "./AgentOperations";
import { MissionFeed } from "./MissionFeed";
import { SystemHealth } from "./SystemHealth";
import { NeuralPreview } from "./NeuralPreview";
import { QuickActions } from "./QuickActions";
import { PersistentVoiceOrb } from "./PersistentVoiceOrb";
import { AdaptiveGovernanceOverview } from "./AdaptiveGovernanceOverview";

interface MissionControlPageProps {
  service?: MissionControlService;
}

export function MissionControlPage({ service = missionControlService }: MissionControlPageProps) {
  const [data, setData] = useState<MissionControlData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    service.load(controller.signal).then(setData).catch((reason: unknown) => {
      if (controller.signal.aborted) return;
      setError(reason instanceof Error ? reason.message : "Mission Control could not load.");
    });
    return () => controller.abort();
  }, [attempt, service]);

  const retry = () => {
    setError(null);
    setData(null);
    setAttempt((value) => value + 1);
  };

  if (error) {
    const lower = error.toLowerCase();
    const variant = lower.includes("unauthorized") || lower.includes("permission") ? "permission" : lower.includes("network") || lower.includes("fetch") || lower.includes("offline") ? "offline" : "error";
    return <MissionControlError message={error} variant={variant} onRetry={retry} />;
  }
  if (!data) return <MissionControlSkeleton />;

  return (
    <div className="mission-control-page min-h-full bg-[--canvas] text-[--canvas-foreground]">
      <div className="mx-auto w-full max-w-[1680px] space-y-4 p-3 sm:p-4 lg:p-5">
        {Object.values(data.sources).some((entry) => entry.state !== "live") ? (
          <div role="status" className="flex items-center justify-between gap-3 rounded-lg border border-amber-400/20 bg-amber-400/[0.055] px-3 py-2 text-[10px] text-amber-100/80 shadow-[inset_0_1px_0_rgba(255,255,255,0.025)]">
            <span><strong className="font-semibold">Source status is explicit.</strong> Unavailable and stale sections never substitute demo or fabricated operational values.</span>
            <time className="hidden shrink-0 text-amber-300/65 sm:block" dateTime={data.generatedAt}>Updated {new Date(data.generatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time>
          </div>
        ) : null}

        <MissionBrief data={data} />
        <div className="grid items-stretch gap-4 xl:grid-cols-[minmax(0,1.55fr)_minmax(340px,0.88fr)]">
          <div className="h-full xl:col-start-1 xl:row-start-1 xl:row-span-2"><AttentionQueue items={data.attention} service={service} sourceState={data.sources.attention} /></div>
          <div className="h-full xl:col-start-2 xl:row-start-1"><ContinueWork items={data.continueItems} sourceState={data.sources.continue} /></div>
          <div className="h-full xl:col-start-1 xl:row-start-3"><AgentOperations agents={data.agents} sourceState={data.sources.agents} /></div>
          <div className="h-full xl:col-start-2 xl:row-start-2"><SystemHealth items={data.health} sourceState={data.sources.health} /></div>
          <div className="h-full xl:col-start-1 xl:row-start-4" id="mission-feed"><MissionFeed items={data.feed} sourceState={data.sources.feed} /></div>
          <div className="h-full xl:col-start-2 xl:row-start-3"><NeuralPreview data={data.neural} sourceState={data.sources.neural} /></div>
          <div className="h-full xl:col-start-2 xl:row-start-4"><QuickActions actions={data.quickActions} /></div>
          <div className="h-full xl:col-span-2"><AdaptiveGovernanceOverview /></div>
        </div>
      </div>
      <PersistentVoiceOrb />
    </div>
  );
}

export function MissionControlSkeleton() {
  return (
    <div data-testid="mission-control-loading" aria-label="Loading Mission Control" className="min-h-full bg-[--canvas] p-3 sm:p-5">
      <div className="mx-auto max-w-[1680px] animate-pulse space-y-4 motion-reduce:animate-none">
        <div className="h-56 rounded-xl bg-[#151b24]" />
        <div className="h-64 rounded-xl bg-[#171c24]" />
        <div className="h-80 rounded-xl bg-[#171c24]" />
        <div className="grid gap-4 lg:grid-cols-2"><div className="h-72 rounded-xl bg-[#171c24]" /><div className="h-72 rounded-xl bg-[#171c24]" /></div>
      </div>
    </div>
  );
}

export function MissionControlError({ message, variant = "error", onRetry }: { message: string; variant?: "error" | "offline" | "permission"; onRetry: () => void }) {
  const title = variant === "permission" ? "Permission required" : variant === "offline" ? "Mission Control is offline" : "Mission Control is unavailable";
  const detail = variant === "permission" ? "Your current account cannot load this operational context." : variant === "offline" ? "Sentinel could not reach the control plane. Local context is preserved." : message;
  return (
    <div data-testid={`mission-control-${variant}`} className="flex min-h-full items-center justify-center bg-[--canvas] p-6 text-[--canvas-foreground]">
      <section className="w-full max-w-md rounded-xl border border-[--canvas-card-border] bg-[--canvas-card] p-6 text-center shadow-2xl shadow-black/30" aria-labelledby="mission-error-title">
        <span className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-red-500/10 text-red-400"><AlertTriangle className="h-5 w-5" /></span>
        <h1 id="mission-error-title" className="mt-4 text-lg font-semibold">{title}</h1>
        <p className="mt-2 text-sm text-[#9ca9ba]">{detail}</p>
        <button type="button" onClick={onRetry} className="mt-5 inline-flex h-9 items-center gap-2 rounded-md bg-violet-600 px-4 text-xs font-medium text-white outline-none hover:bg-violet-500 focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2"><RefreshCw className="h-3.5 w-3.5" />Retry</button>
      </section>
    </div>
  );
}

export function MissionControlEmpty() {
  return (
    <div data-testid="mission-control-empty" className="flex min-h-full items-center justify-center bg-[--canvas] p-6 text-[--canvas-foreground]">
      <section className="w-full max-w-lg rounded-xl border border-[--canvas-card-border] bg-[--canvas-card] p-8 text-center shadow-2xl shadow-black/30" aria-labelledby="mission-empty-title">
        <h1 id="mission-empty-title" className="text-lg font-semibold">You are all caught up</h1>
        <p className="mt-2 text-sm text-[#9ca9ba]">No active work, agent activity, or decisions need your attention right now.</p>
        <a href="/projects" className="mt-5 inline-flex h-9 items-center rounded-md bg-violet-600 px-4 text-xs font-medium text-white outline-none hover:bg-violet-500 focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2">Start a new project</a>
      </section>
    </div>
  );
}
