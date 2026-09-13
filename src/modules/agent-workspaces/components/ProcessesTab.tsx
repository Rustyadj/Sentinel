"use client";

import { useState } from "react";
import { Play, RefreshCw, ScrollText, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { workspaceApi } from "../api";
import { EmptyNote, ErrorNote, formatBytes, relativeTime, useResource } from "./primitives";

export function ProcessesTab({ workspaceId, canExecute }: { workspaceId: string; canExecute: boolean }) {
  const processes = useResource(() => workspaceApi.processes(workspaceId), workspaceId);
  const [label, setLabel] = useState("");
  const [command, setCommand] = useState("");
  const [ports, setPorts] = useState("");
  const [logs, setLogs] = useState<{ id: string; lines: string[] } | null>(null);
  const [error, setError] = useState<unknown>(null);

  async function start() {
    setError(null);
    try {
      await workspaceApi.startProcess(workspaceId, {
        label,
        command,
        ports: ports.split(",").map((value) => Number.parseInt(value.trim(), 10)).filter(Number.isFinite),
      });
      setLabel(""); setCommand(""); setPorts("");
      await processes.refresh();
    } catch (caught) {
      setError(caught);
    }
  }

  return (
    <div className="space-y-4">
      {canExecute ? (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-[--border] p-3">
          <Input className="w-44" placeholder="label (dev server)" value={label} onChange={(event) => setLabel(event.target.value)} />
          <Input className="min-w-[16rem] flex-1 font-mono" placeholder="npm run dev" value={command} onChange={(event) => setCommand(event.target.value)} />
          <Input className="w-32" placeholder="ports 3000" value={ports} onChange={(event) => setPorts(event.target.value)} />
          <Button size="sm" onClick={() => void start()} disabled={!label.trim() || !command.trim()}>
            <Play className="h-3.5 w-3.5" /> Start process
          </Button>
        </div>
      ) : null}

      <ErrorNote error={error} />
      <ErrorNote error={processes.error} />

      <div className="rounded-md border border-[--border]">
        <div className="flex items-center justify-between border-b border-[--border] px-3 py-2 text-xs font-medium">
          Tracked processes
          <Button size="sm" variant="ghost" onClick={() => void processes.refresh()}><RefreshCw className="h-3.5 w-3.5" /></Button>
        </div>
        {processes.data?.tracked.length ? processes.data.tracked.map((process) => (
          <div key={process.id} className="flex flex-wrap items-center gap-3 border-b border-[--border] px-3 py-2 text-xs last:border-b-0">
            <span className="w-40 truncate font-medium">{process.label}</span>
            <span className="min-w-0 flex-1 truncate font-mono text-[--muted-foreground]">{process.command}</span>
            <span className="tabular-nums">pid {process.pid ?? "—"}</span>
            <span>{process.ports.length ? `:${process.ports.join(", :")}` : "no ports"}</span>
            <span className={process.status === "running" ? "text-emerald-400" : "text-[--muted-foreground]"}>{process.status}</span>
            <span className="text-[--muted-foreground]">{relativeTime(process.startedAt)}</span>
            <Button size="sm" variant="ghost" onClick={async () => setLogs({ id: process.id, lines: (await workspaceApi.processLogs(workspaceId, process.id)).lines })}>
              <ScrollText className="h-3.5 w-3.5" />
            </Button>
            {canExecute && process.status === "running" ? (
              <Button size="sm" variant="ghost" onClick={async () => { await workspaceApi.stopProcess(workspaceId, process.id); await processes.refresh(); }}>
                <Square className="h-3.5 w-3.5" />
              </Button>
            ) : null}
          </div>
        )) : <EmptyNote>No tracked processes.</EmptyNote>}
      </div>

      <div className="rounded-md border border-[--border]">
        <div className="border-b border-[--border] px-3 py-2 text-xs font-medium">Live processes in the runtime</div>
        {processes.data?.live.length ? processes.data.live.map((process) => (
          <div key={process.pid} className="flex items-center gap-3 border-b border-[--border] px-3 py-1.5 text-xs last:border-b-0">
            <span className="w-16 tabular-nums text-[--muted-foreground]">{process.pid}</span>
            <span className="min-w-0 flex-1 truncate font-mono">{process.command}</span>
            <span className="tabular-nums">{process.cpuPercent?.toFixed(1) ?? "—"}%</span>
            <span className="tabular-nums">{formatBytes(process.memoryBytes)}</span>
            <span className="text-[--muted-foreground]">{relativeTime(process.startedAt)}</span>
          </div>
        )) : <EmptyNote>The runtime reports no user processes.</EmptyNote>}
      </div>

      {logs ? (
        <div className="rounded-md border border-[--border]">
          <div className="flex items-center justify-between border-b border-[--border] px-3 py-2 text-xs">
            Process log
            <button className="text-[--muted-foreground] hover:underline" onClick={() => setLogs(null)}>close</button>
          </div>
          <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words bg-black/30 p-3 font-mono text-[11px]">{logs.lines.join("\n")}</pre>
        </div>
      ) : null}
    </div>
  );
}
