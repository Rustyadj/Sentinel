"use client";

import { useState } from "react";
import { GitBranch, HardDrive, Loader2, Pause, Play, RefreshCw, RotateCcw, Square, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { workspaceApi, type WorkspaceDetail } from "../api";
import { ErrorNote, formatBytes, formatDuration, Metric, relativeTime, StateBadge } from "./primitives";

interface Props {
  detail: WorkspaceDetail;
  onChanged: () => void;
}

/** Runtime controls and the operational facts an operator actually needs. */
export function WorkspaceHeader({ detail, onChanged }: Props) {
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const { workspace, runtime, stats, state, limits, repository } = detail;

  async function act(action: string, run: () => Promise<unknown>) {
    setPending(action);
    setError(null);
    try {
      await run();
      onChanged();
    } catch (caught) {
      setError(caught);
    } finally {
      setPending(null);
    }
  }

  const running = state === "RUNNING";
  const busy = (action: string) => pending === action;

  return (
    <div className="space-y-3 border-b border-[--border] pb-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="truncate text-lg font-semibold">{workspace.name}</h1>
            <StateBadge state={state} />
            {workspace.locked ? <span className="text-[11px] text-amber-400">locked</span> : null}
          </div>
          <p className="mt-0.5 text-xs text-[--muted-foreground]">
            {workspace.agentId} · {workspace.runtimeType} · {workspace.image}
            {runtime?.containerName ? ` · ${runtime.containerName}` : ""}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => act("reconcile", () => workspaceApi.runtimeAction(workspace.id, "reconcile"))} disabled={Boolean(pending)}>
            {busy("reconcile") ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} Refresh
          </Button>
          {running ? (
            <>
              <Button size="sm" variant="outline" onClick={() => act("pause", () => workspaceApi.runtimeAction(workspace.id, "pause"))} disabled={Boolean(pending)}>
                <Pause className="h-3.5 w-3.5" /> Pause
              </Button>
              <Button size="sm" variant="outline" onClick={() => act("stop", () => workspaceApi.runtimeAction(workspace.id, "stop"))} disabled={Boolean(pending)}>
                <Square className="h-3.5 w-3.5" /> Stop runtime
              </Button>
            </>
          ) : (
            <Button size="sm" onClick={() => act("start", () => workspaceApi.runtimeAction(workspace.id, state === "PAUSED" ? "resume" : "start"))} disabled={Boolean(pending) || state === "ARCHIVED"}>
              {busy("start") ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
              {state === "PAUSED" ? "Resume" : "Start runtime"}
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={() => act("restart", () => workspaceApi.runtimeAction(workspace.id, "restart"))} disabled={Boolean(pending) || state === "ARCHIVED"}>
            <RotateCcw className="h-3.5 w-3.5" /> Restart
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              if (!window.confirm("Destroy the runtime container? Workspace files and snapshots are kept.")) return;
              void act("destroy", () => workspaceApi.destroyRuntime(workspace.id));
            }}
            disabled={Boolean(pending)}
          >
            <Trash2 className="h-3.5 w-3.5" /> Destroy runtime
          </Button>
        </div>
      </div>

      {runtime?.errorMessage ? <ErrorNote error={new Error(runtime.errorMessage)} /> : null}
      <ErrorNote error={error} />

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-7">
        <Metric label="Uptime" value={formatDuration(stats?.uptimeSeconds ?? null)} hint={relativeTime(runtime?.startedAt)} />
        <Metric label="CPU" value={stats?.cpuPercent === null || stats?.cpuPercent === undefined ? "—" : `${stats.cpuPercent.toFixed(1)}%`} hint={`limit ${limits.cpus} cpu`} />
        <Metric label="Memory" value={formatBytes(stats?.memoryBytes)} hint={`limit ${limits.memoryMb} MB`} />
        <Metric label="Disk" value={formatBytes(stats?.diskUsedBytes)} hint={`limit ${limits.diskGb} GB`} />
        <Metric label="Processes" value={String(detail.counts.runningProcesses)} hint={`live ${stats?.processCount ?? "—"}`} />
        <Metric
          label="Repository"
          value={repository?.branch ?? "—"}
          hint={repository ? `${repository.repository.split("/").pop()} · ${repository.dirtyFiles} dirty` : "no repository detected"}
        />
        <Metric label="Snapshots / Artifacts" value={`${detail.counts.snapshots} / ${detail.counts.artifacts}`} hint={workspace.volumeName ?? "no volume"} />
      </div>

      <div className="flex flex-wrap items-center gap-4 text-[11px] text-[--muted-foreground]">
        <span className="inline-flex items-center gap-1"><HardDrive className="h-3 w-3" /> {workspace.homePath}</span>
        <span className="inline-flex items-center gap-1"><GitBranch className="h-3 w-3" /> cross-client delegation: {detail.policy.crossAgentDelegation}</span>
        <span>last active {relativeTime(workspace.lastActiveAt)}</span>
        <span>reconciled {relativeTime(runtime?.reconciledAt)}</span>
      </div>
    </div>
  );
}
