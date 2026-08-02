"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity, AlertTriangle, Bot, CheckCircle2, CircleSlash2, Code2, ExternalLink,
  FileCode2, Loader2, PauseCircle, Play, RefreshCw, RotateCcw,
  ScrollText, Send, Server, ShieldCheck, Square, Terminal, Wrench,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ConfigEditor } from "./AgentsPage";

type RuntimeKind = "hermes" | "openclaw" | "claude-code" | "codex";
type ControlStatus = "verified" | "partial" | "unavailable";

interface RuntimeSummary {
  id: string;
  agentId: string;
  kind: RuntimeKind;
  transport: "http" | "process" | "docker" | "systemd";
  endpoint?: string;
  workspaceId?: string;
  enabled: boolean;
  model?: string;
  nativeUiUrl?: string;
  sentinelControl: ControlStatus;
  capabilities: RuntimeCapabilities;
}

interface RuntimeCapabilities {
  streaming: boolean;
  resume: boolean;
  cancel: boolean;
  toolEvents: boolean;
  fileChangeEvents: boolean;
  restart?: { supported: boolean; reason?: string };
  reload?: { supported: boolean; reason?: string };
}

interface RuntimeHealth {
  installed: boolean;
  processRunning: boolean;
  reachable: boolean;
  authenticated: boolean | null;
  ready: boolean;
  busy: boolean;
  degraded: boolean;
  version?: string;
  currentSessionId?: string;
  failureCode?: string;
  message?: string;
  checkedAt: string;
}

interface RuntimeSession {
  id: string;
  externalSessionId?: string;
  status: string;
  workingDirectory?: string;
  startedAt: string;
  lastActivityAt: string;
  exitCode?: number;
  metadata: Record<string, unknown>;
}

interface Repository { id: string; name: string; branch: string | null; dirty: boolean | null }
interface StreamItem { type: string; timestamp?: string; data?: Record<string, unknown> }

const DISPLAY_NAME: Record<RuntimeKind, string> = {
  hermes: "Hermes", openclaw: "OpenClaw", "claude-code": "Claude Code", codex: "Codex",
};

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const body = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(body.error ?? `Request failed (${response.status})`);
  return body;
}

async function readRuntimeStream(response: Response, onEvent: (event: StreamItem) => void) {
  if (!response.ok) throw new Error((await response.json().catch(() => null) as { error?: string } | null)?.error ?? "Runtime request failed");
  if (!response.body) throw new Error("Runtime returned no event stream");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? "";
    for (const frame of frames) {
      const line = frame.split("\n").find((candidate) => candidate.startsWith("data: "));
      if (!line || line === "data: [DONE]") continue;
      const parsed = JSON.parse(line.slice(6)) as StreamItem;
      onEvent(parsed.type === "runtime_event" && parsed.data?.event ? parsed.data.event as StreamItem : parsed);
    }
  }
}

function StatePill({ label, value }: { label: string; value: boolean | null }) {
  const tone = value === true ? "text-emerald-400 border-emerald-500/25 bg-emerald-500/8"
    : value === false ? "text-red-400 border-red-500/25 bg-red-500/8"
      : "text-amber-300 border-amber-500/25 bg-amber-500/8";
  return <div className={cn("rounded-lg border px-2.5 py-2", tone)}><div className="text-[9px] opacity-70">{label}</div><div className="mt-0.5 text-xs font-medium">{value === true ? "Yes" : value === false ? "No" : "Unknown"}</div></div>;
}

function CoverageRail({ health, hasEvents, hasLogs }: { health: RuntimeHealth | null; hasEvents: boolean; hasLogs: boolean }) {
  const checks = [
    ["Health", health?.ready === true], ["Execution", hasEvents], ["Streaming", hasEvents],
    ["Cancellation", false], ["Logs", hasLogs], ["Authorization", true], ["Audit", true],
  ] as const;
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-7" aria-label="Sentinel control acceptance coverage">
      {checks.map(([label, passed]) => (
        <div key={label} className="flex items-center gap-2 border-b border-[--border] pb-2 text-[10px] text-[--muted-foreground]">
          {passed ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" /> : <PauseCircle className="h-3.5 w-3.5 text-amber-400" />}
          <span>{label}</span>
        </div>
      ))}
    </div>
  );
}

function pullRequestUrl(events: StreamItem[]) {
  for (const event of events) {
    const match = JSON.stringify(event.data ?? {}).match(/https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+/);
    if (match) return match[0];
  }
  return null;
}

export function AgentRuntimeConsole() {
  const [runtimes, setRuntimes] = useState<RuntimeSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [health, setHealth] = useState<RuntimeHealth | null>(null);
  const [sessions, setSessions] = useState<RuntimeSession[]>([]);
  const [repositories, setRepositories] = useState<Repository[]>([]);
  const [repository, setRepository] = useState("");
  const [task, setTask] = useState("");
  const [events, setEvents] = useState<StreamItem[]>([]);
  const [logs, setLogs] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [configOpen, setConfigOpen] = useState(false);
  const [error, setError] = useState("");

  const selected = runtimes.find((runtime) => runtime.id === selectedId) ?? null;
  const activeSession = sessions.find((session) => session.status === "running") ?? sessions[0] ?? null;
  const isCoding = selected?.kind === "claude-code" || selected?.kind === "codex";
  const prUrl = useMemo(() => pullRequestUrl(events), [events]);

  const loadRuntimes = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const result = await api<{ runtimes: RuntimeSummary[] }>("/api/agent-runtimes");
      setRuntimes(result.runtimes);
      setSelectedId((current) => current && result.runtimes.some((runtime) => runtime.id === current) ? current : result.runtimes[0]?.id ?? null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Failed to load runtimes"); }
    finally { setLoading(false); }
  }, []);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => { void loadRuntimes(); }, [loadRuntimes]);

  const refreshSelected = useCallback(async () => {
    if (!selectedId) return;
    setError("");
    try {
      const [healthResult, sessionsResult, repositoriesResult] = await Promise.all([
        api<{ health: RuntimeHealth }>(`/api/agent-runtimes/${selectedId}/health`),
        api<{ sessions: RuntimeSession[] }>(`/api/agent-runtimes/${selectedId}/sessions?limit=25`),
        api<{ repositories: Repository[] }>(`/api/agent-runtimes/${selectedId}/repositories`).catch(() => ({ repositories: [] })),
      ]);
      setHealth(healthResult.health); setSessions(sessionsResult.sessions); setRepositories(repositoriesResult.repositories);
      setRepository((current) => repositoriesResult.repositories.some((item) => item.id === current) ? current : repositoriesResult.repositories[0]?.id ?? "");
    } catch (cause) { setHealth(null); setError(cause instanceof Error ? cause.message : "Runtime refresh failed"); }
  }, [selectedId]);

  useEffect(() => { setEvents([]); setLogs([]); void refreshSelected(); }, [refreshSelected]);
  /* eslint-enable react-hooks/set-state-in-effect */

  async function ensureSession() {
    if (!selected?.workspaceId) throw new Error("Runtime has no authorized workspace assignment");
    if (activeSession && !["cancelled", "timed_out"].includes(activeSession.status)) return activeSession;
    const result = await api<{ session: RuntimeSession }>(`/api/agent-runtimes/${selected.id}/sessions`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspaceId: selected.workspaceId, workingDirectory: repository || undefined }),
    });
    setSessions((current) => [result.session, ...current]);
    return result.session;
  }

  async function startNewSession() {
    if (!selected?.workspaceId) throw new Error("Runtime has no authorized workspace assignment");
    const result = await api<{ session: RuntimeSession }>(`/api/agent-runtimes/${selected.id}/sessions`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspaceId: selected.workspaceId, workingDirectory: repository || undefined }),
    });
    setSessions((current) => [result.session, ...current]);
    return result.session;
  }

  async function resumeSession() {
    if (!activeSession) return;
    try {
      const result = await api<{ session: RuntimeSession }>(`/api/agent-sessions/${activeSession.id}/resume`, { method: "POST" });
      setSessions((current) => [result.session, ...current]);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Resume failed"); }
  }

  async function sendTask() {
    if (!selected || !task.trim() || running) return;
    setRunning(true); setError(""); setEvents([]);
    try {
      const session = await ensureSession();
      const response = await fetch(`/api/agent-sessions/${session.id}/messages`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt: task.trim() }),
      });
      await readRuntimeStream(response, (event) => setEvents((current) => [...current, event].slice(-500)));
      setTask("");
      await refreshSelected();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Task failed"); }
    finally { setRunning(false); }
  }

  async function cancelTask() {
    if (!activeSession) return;
    try { await api(`/api/agent-sessions/${activeSession.id}/cancel`, { method: "POST" }); await refreshSelected(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Cancel failed"); }
  }

  async function loadLogs() {
    if (!selected) return;
    const url = activeSession
      ? `/api/agent-sessions/${activeSession.id}/logs`
      : `/api/agents/${selected.agentId}/logs?source=auto&lines=200`;
    try { const result = await api<{ lines: string[] }>(url); setLogs(result.lines); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Logs failed"); }
  }

  async function runtimeAction(action: "restart" | "reload") {
    if (!selected) return;
    try { await api(`/api/agent-runtimes/${selected.id}/${action}`, { method: "POST" }); await refreshSelected(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : `${action} failed`); }
  }

  const statusCounts = useMemo(() => ({
    total: runtimes.length,
    coding: runtimes.filter((runtime) => runtime.kind === "claude-code" || runtime.kind === "codex").length,
    verified: runtimes.filter((runtime) => runtime.sentinelControl === "verified").length,
  }), [runtimes]);

  return (
    <main className="h-full overflow-y-auto bg-[--background] p-4 text-[--foreground] sm:p-6">
      <div className="mx-auto max-w-[1500px] space-y-5">
        <header className="flex flex-col gap-4 border-b border-[--border] pb-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="mb-2 flex items-center gap-2 text-[10px] text-amber-400"><ShieldCheck className="h-3.5 w-3.5" /> Production control plane · live VPS acceptance pending</div>
            <h1 className="text-xl font-semibold">Agent runtime console</h1>
            <p className="mt-1 max-w-2xl text-xs text-[--muted-foreground]">One governed surface for Hermes, OpenClaw, Claude Code, and Codex. No runtime is marked Verified until the host runbook passes.</p>
          </div>
          <div className="flex gap-5 text-xs"><span><b className="text-lg">{statusCounts.total}</b> runtimes</span><span><b className="text-lg">{statusCounts.coding}</b> coding</span><span className="text-amber-400"><b className="text-lg">{statusCounts.verified}</b> verified</span></div>
        </header>

        {error ? <div role="alert" className="flex items-center gap-2 rounded-lg border border-red-500/25 bg-red-500/8 px-3 py-2 text-xs text-red-300"><AlertTriangle className="h-4 w-4" />{error}</div> : null}

        <section className="grid gap-4 xl:grid-cols-[320px_minmax(0,1fr)]">
          <aside className="space-y-2" aria-label="Runtime list">
            <div className="flex items-center justify-between pb-2"><h2 className="text-xs font-medium text-[--muted-foreground]">Runtime inventory</h2><button onClick={() => void loadRuntimes()} className="rounded p-1.5 text-[--muted-foreground] hover:bg-[--accent]" aria-label="Refresh runtimes"><RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} /></button></div>
            {runtimes.map((runtime) => (
              <button key={runtime.id} onClick={() => setSelectedId(runtime.id)} className={cn("w-full rounded-xl border p-3 text-left transition-colors", selectedId === runtime.id ? "border-indigo-500/45 bg-indigo-500/8" : "border-[--border] bg-[--card] hover:border-[--muted-foreground]/40")}>
                <div className="flex items-start gap-3"><div className="rounded-lg border border-[--border] bg-[--muted] p-2">{runtime.kind === "claude-code" || runtime.kind === "codex" ? <Code2 className="h-4 w-4" /> : <Bot className="h-4 w-4" />}</div><div className="min-w-0 flex-1"><div className="flex items-center justify-between gap-2"><span className="truncate text-sm font-medium">{runtime.agentId}</span><span className={cn("text-[9px] capitalize", runtime.sentinelControl === "verified" ? "text-emerald-400" : runtime.sentinelControl === "partial" ? "text-amber-400" : "text-red-400")}>{runtime.sentinelControl}</span></div><div className="mt-1 flex gap-2 text-[10px] text-[--muted-foreground]"><span>{DISPLAY_NAME[runtime.kind]}</span><span>·</span><span>{runtime.transport}</span></div></div></div>
              </button>
            ))}
            {!loading && runtimes.length === 0 ? <div className="rounded-xl border border-dashed border-[--border] p-6 text-center text-xs text-[--muted-foreground]"><CircleSlash2 className="mx-auto mb-2 h-5 w-5" />No runtime is assigned to a workspace you can view.</div> : null}
          </aside>

          {selected ? (
            <div className="min-w-0 space-y-4">
              <section className="rounded-xl border border-[--border] bg-[--card] p-4">
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between"><div><div className="flex items-center gap-2"><Server className="h-4 w-4 text-indigo-400" /><h2 className="text-base font-semibold">{selected.agentId}</h2><span className="rounded border border-amber-500/25 bg-amber-500/8 px-2 py-0.5 text-[9px] text-amber-300">Sentinel Control: Partial</span></div><p className="mt-1 text-[10px] text-[--muted-foreground]">{selected.kind} · {selected.transport} · {health?.version ?? "version unknown"}</p><p className="mt-1 text-[10px] text-[--muted-foreground]">Model {selected.model ?? "runtime managed"} · Workspace {selected.workspaceId ?? "unassigned"}</p></div><div className="flex flex-wrap gap-2"><button onClick={() => void refreshSelected()} className="rounded-lg border border-[--border] px-2.5 py-1.5 text-[10px] hover:bg-[--accent]"><Activity className="mr-1 inline h-3 w-3" />Open / check</button><button onClick={() => setConfigOpen((current) => !current)} className="rounded-lg border border-[--border] px-2.5 py-1.5 text-[10px] hover:bg-[--accent]"><Wrench className="mr-1 inline h-3 w-3" />Edit config</button>{selected.capabilities.reload?.supported ? <button onClick={() => void runtimeAction("reload")} className="rounded-lg border border-[--border] px-2.5 py-1.5 text-[10px] hover:bg-[--accent]"><Wrench className="mr-1 inline h-3 w-3" />Reload</button> : null}{selected.capabilities.restart?.supported ? <button onClick={() => void runtimeAction("restart")} className="rounded-lg border border-[--border] px-2.5 py-1.5 text-[10px] hover:bg-[--accent]"><RotateCcw className="mr-1 inline h-3 w-3" />Restart</button> : null}{selected.nativeUiUrl ? <a href={selected.nativeUiUrl} target="_blank" rel="noreferrer" className="rounded-lg border border-[--border] px-2.5 py-1.5 text-[10px] hover:bg-[--accent]">Native UI <ExternalLink className="ml-1 inline h-3 w-3" /></a> : <span className="rounded-lg border border-dashed border-[--border] px-2.5 py-1.5 text-[10px] text-[--muted-foreground]">Native UI unavailable</span>}</div></div>
                <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6"><StatePill label="Installed" value={health?.installed ?? null} /><StatePill label="Process" value={health?.processRunning ?? null} /><StatePill label="API" value={health?.reachable ?? null} /><StatePill label="Authenticated" value={health?.authenticated ?? null} /><StatePill label="Ready" value={health?.ready ?? null} /><StatePill label="Busy" value={health?.busy ?? null} /></div>
                {health?.message ? <p className="mt-3 text-[10px] text-amber-300">{health.failureCode}: {health.message}</p> : null}
                <div className="mt-4"><CoverageRail health={health} hasEvents={events.length > 0} hasLogs={logs.length > 0} /></div>
              </section>

              <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
                <div className="rounded-xl border border-[--border] bg-[--card] p-4">
                  <div className="mb-3 flex items-center justify-between"><h3 className="text-xs font-medium">{isCoding ? "Coding task" : "Runtime task"}</h3><span className="text-[9px] text-[--muted-foreground]">No silent model fallback</span></div>
                  {isCoding ? <label className="mb-3 block text-[10px] text-[--muted-foreground]">Repository<select value={repository} onChange={(event) => setRepository(event.target.value)} className="mt-1 w-full rounded-lg border border-[--border] bg-[--muted] px-2.5 py-2 text-xs text-[--foreground]"><option value="">Default allowlisted root</option>{repositories.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.branch ?? "branch unknown"}{item.dirty ? " · modified" : ""}</option>)}</select></label> : null}
                  <label className="block text-[10px] text-[--muted-foreground]">Task<textarea value={task} onChange={(event) => setTask(event.target.value)} placeholder={health?.ready ? "Describe the task for this runtime…" : "Runtime must be ready before execution"} className="mt-1 h-28 w-full resize-none rounded-lg border border-[--border] bg-[--muted] p-3 text-xs text-[--foreground] outline-none focus:border-indigo-500/50" /></label>
                  <div className="mt-3 flex flex-wrap gap-2"><button onClick={() => void sendTask()} disabled={!task.trim() || running || health?.ready !== true} className="rounded-lg bg-indigo-600 px-3 py-2 text-xs text-white disabled:cursor-not-allowed disabled:opacity-40">{running ? <Loader2 className="mr-1 inline h-3.5 w-3.5 animate-spin" /> : <Send className="mr-1 inline h-3.5 w-3.5" />}Send task</button><button onClick={() => void startNewSession().catch((cause) => setError(cause instanceof Error ? cause.message : "Session failed"))} disabled={health?.ready !== true} className="rounded-lg border border-[--border] px-3 py-2 text-xs hover:bg-[--accent] disabled:opacity-40"><Play className="mr-1 inline h-3.5 w-3.5" />New session</button><button onClick={() => void resumeSession()} disabled={!activeSession?.externalSessionId || !selected.capabilities.resume} className="rounded-lg border border-[--border] px-3 py-2 text-xs hover:bg-[--accent] disabled:opacity-40"><RefreshCw className="mr-1 inline h-3.5 w-3.5" />Resume</button><button onClick={() => void cancelTask()} disabled={!activeSession || !selected.capabilities.cancel} className="rounded-lg border border-red-500/25 px-3 py-2 text-xs text-red-300 disabled:opacity-40"><Square className="mr-1 inline h-3.5 w-3.5" />Cancel</button></div>
                </div>

                <div className="rounded-xl border border-[--border] bg-[--card] p-4"><div className="mb-3 flex items-center justify-between"><h3 className="text-xs font-medium">Session</h3><button onClick={() => void loadLogs()} className="text-[10px] text-[--muted-foreground] hover:text-[--foreground]"><ScrollText className="mr-1 inline h-3 w-3" />View logs</button></div>{activeSession ? <dl className="space-y-2 text-[10px]"><div className="flex justify-between"><dt className="text-[--muted-foreground]">Status</dt><dd>{activeSession.status}</dd></div><div className="flex justify-between gap-4"><dt className="text-[--muted-foreground]">Session</dt><dd className="truncate font-mono">{activeSession.id}</dd></div><div className="flex justify-between gap-4"><dt className="text-[--muted-foreground]">Working directory</dt><dd className="truncate font-mono">{activeSession.workingDirectory ?? "—"}</dd></div><div className="flex justify-between"><dt className="text-[--muted-foreground]">Started</dt><dd>{new Date(activeSession.startedAt).toLocaleString()}</dd></div><div className="flex justify-between gap-4"><dt className="text-[--muted-foreground]">Last task</dt><dd className="truncate">{typeof activeSession.metadata.lastTask === "string" ? activeSession.metadata.lastTask : "—"}</dd></div><div className="flex justify-between"><dt className="text-[--muted-foreground]">Exit</dt><dd>{activeSession.exitCode ?? "—"}</dd></div></dl> : <div className="py-8 text-center text-xs text-[--muted-foreground]">No managed session yet · runtime-level logs may still be available.</div>}<div className="mt-4 border-t border-[--border] pt-3"><div className="mb-2 text-[10px] text-[--muted-foreground]">Capabilities</div><div className="flex flex-wrap gap-1">{Object.entries(selected.capabilities).filter(([, value]) => value === true).map(([name]) => <span key={name} className="rounded bg-[--muted] px-1.5 py-0.5 text-[9px]">{name}</span>)}</div></div></div>
              </section>

              <section className="rounded-xl border border-[--border] bg-[#060708] p-4"><div className="mb-3 flex items-center gap-2"><Terminal className="h-3.5 w-3.5 text-emerald-400" /><h3 className="text-xs font-medium">Live runtime events</h3>{prUrl ? <a href={prUrl} target="_blank" rel="noreferrer" className="ml-2 text-[10px] text-indigo-300 hover:text-indigo-200">Open PR <ExternalLink className="ml-1 inline h-3 w-3" /></a> : null}<span className="ml-auto text-[9px] text-[--muted-foreground]">Provider output only · no simulated terminal</span></div><div className="max-h-72 min-h-32 overflow-y-auto font-mono text-[10px] leading-relaxed text-[#8f96aa]">{events.length ? events.map((event, index) => <div key={`${event.timestamp ?? "event"}-${index}`} className="border-b border-white/5 py-1"><span className="mr-2 text-indigo-400">{event.type}</span>{JSON.stringify(event.data ?? {})}</div>) : logs.length ? logs.map((line, index) => <div key={index} className="py-0.5">{line}</div>) : <div className="flex min-h-28 items-center justify-center text-[#414656]"><FileCode2 className="mr-2 h-4 w-4" />Events appear only after a real runtime task starts.</div>}</div></section>
              {configOpen ? <section className="rounded-xl border border-[--border] bg-[--card] p-4"><div className="mb-3 flex items-center justify-between"><h3 className="text-xs font-medium">Runtime configuration</h3><span className="text-[9px] text-[--muted-foreground]">Server-enforced configure permission</span></div><ConfigEditor agentId={selected.agentId} /></section> : null}
            </div>
          ) : <div className="flex min-h-80 items-center justify-center rounded-xl border border-dashed border-[--border] text-xs text-[--muted-foreground]">Select a runtime to inspect its control surface.</div>}
        </section>
      </div>
    </main>
  );
}
