"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { workspaceApi, type CommandRecord } from "../api";
import { EmptyNote, ErrorNote, useResource } from "./primitives";

interface Entry { command: string; stdout: string; stderr: string; exitCode: number | null; durationMs: number | null; origin?: string; at: string }

function toEntry(record: CommandRecord): Entry {
  return {
    command: record.command,
    stdout: record.stdout,
    stderr: record.stderr,
    exitCode: record.exitCode,
    durationMs: record.durationMs,
    origin: `${record.origin} · ${record.agentId}`,
    at: record.startedAt,
  };
}

/**
 * Request/response terminal: each command is a bounded, audited execution
 * rather than an interactive PTY, so every line has a stored record behind it.
 */
export function TerminalTab({ workspaceId, homePath, canExecute }: { workspaceId: string; homePath: string; canExecute: boolean }) {
  const history = useResource(() => workspaceApi.commands(workspaceId, 25), workspaceId);
  const [sessionEntries, setSessionEntries] = useState<Entry[]>([]);
  const [command, setCommand] = useState("");
  const [cwd, setCwd] = useState(homePath);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const endRef = useRef<HTMLDivElement>(null);

  // Stored history and this session's runs are one derived list rather than
  // duplicated state, so a refresh can never desynchronise the two.
  const entries = useMemo(
    () => [...[...(history.data?.commands ?? [])].reverse().map(toEntry), ...sessionEntries],
    [history.data, sessionEntries],
  );

  useEffect(() => { endRef.current?.scrollIntoView({ block: "end" }); }, [entries.length, running]);

  async function submit() {
    if (!command.trim() || running) return;
    const sent = command;
    setCommand("");
    setRunning(true);
    setError(null);
    try {
      const { result } = await workspaceApi.run(workspaceId, sent, cwd);
      setSessionEntries((current) => [...current, {
        command: sent, stdout: result.stdout, stderr: result.stderr,
        exitCode: result.exitCode, durationMs: result.durationMs, origin: "sentinel-ui", at: new Date().toISOString(),
      }]);
    } catch (caught) {
      setError(caught);
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="h-[28rem] overflow-auto rounded-md border border-[--border] bg-black/30 p-3 font-mono text-xs">
        {entries.length === 0 && !history.loading ? <EmptyNote>No commands have been run in this workspace yet.</EmptyNote> : null}
        {entries.map((entry, index) => (
          <div key={`${entry.at}-${index}`} className="mb-3">
            <div className="text-[--muted-foreground]">
              <span className="text-emerald-400">$</span> {entry.command}
              <span className="ml-2 text-[10px]">{entry.origin}</span>
            </div>
            {entry.stdout ? <pre className="whitespace-pre-wrap break-words">{entry.stdout}</pre> : null}
            {entry.stderr ? <pre className="whitespace-pre-wrap break-words text-[--destructive]">{entry.stderr}</pre> : null}
            <div className="text-[10px] text-[--muted-foreground]">
              exit {entry.exitCode ?? "—"}{entry.durationMs !== null ? ` · ${entry.durationMs} ms` : ""}
            </div>
          </div>
        ))}
        {running ? <div className="flex items-center gap-2 text-[--muted-foreground]"><Loader2 className="h-3 w-3 animate-spin" /> running…</div> : null}
        <div ref={endRef} />
      </div>

      <ErrorNote error={error} />

      <div className="flex flex-wrap items-center gap-2">
        <Input className="w-64" value={cwd} onChange={(event) => setCwd(event.target.value)} placeholder="working directory" />
        <Input
          className="min-w-[16rem] flex-1 font-mono"
          value={command}
          disabled={!canExecute}
          placeholder={canExecute ? "bash command" : "You do not have execute access in this workspace"}
          onChange={(event) => setCommand(event.target.value)}
          onKeyDown={(event) => { if (event.key === "Enter") void submit(); }}
        />
        <Button size="sm" onClick={() => void submit()} disabled={!canExecute || running || !command.trim()}>
          <Send className="h-3.5 w-3.5" /> Run
        </Button>
      </div>
    </div>
  );
}
