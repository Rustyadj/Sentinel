"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Server, Activity, RefreshCw, RotateCcw, ExternalLink,
  Terminal, FileText, ChevronDown, ChevronRight, Save,
  AlertCircle, CheckCircle2, Clock, Wifi, WifiOff,
  Loader2, Bot, Cpu, RotateCw, FolderOpen, FileCode2,
  History, ShieldAlert, SlidersHorizontal, RotateCcw as ResetIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  AGENT_CAPABILITY_KEYS, defaultCapabilityWeights,
  type AgentCapabilityKey, type CapabilityWeights,
} from "@/lib/orchestration/capability-defaults";

// ─── Types ────────────────────────────────────────────────────────────────────

type AgentStatus = "online" | "offline" | "degraded" | "unknown" | "checking";

interface VpsAgent {
  id: string;
  name: string;
  kind: string;
  type: string;
  description: string;
  model: string;
  endpoint: string;
  memoryScope: string;
  workspaceId: string;
  legacyPath: string | null;
  dashboardPort: number | null;
}

interface ConfigFile {
  id: string;
  name: string;
  ext: string;
  relativePath: string;
  size: number;
  modifiedAt: string;
}

// ─── Status helpers ───────────────────────────────────────────────────────────

const STATUS_DOT: Record<AgentStatus, string> = {
  online:   "bg-emerald-400",
  degraded: "bg-yellow-400",
  offline:  "bg-red-400",
  unknown:  "bg-[#3a3f50]",
  checking: "bg-[#3a3f50] animate-pulse",
};

const STATUS_LABEL: Record<AgentStatus, string> = {
  online:   "Online",
  degraded: "Degraded",
  offline:  "Offline",
  unknown:  "Unknown",
  checking: "Checking…",
};

// ─── Logs Panel ───────────────────────────────────────────────────────────────

function LogsPanel({ agentId }: { agentId: string }) {
  const [lines, setLines] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [source, setSource] = useState("");

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/agents/${agentId}/logs`);
      const data = await res.json() as { lines: string[]; source: string };
      setLines(data.lines ?? []);
      setSource(data.source ?? "");
    } catch {
      setLines(["[error] Failed to fetch logs"]);
    } finally {
      setLoading(false);
    }
  }, [agentId]);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => { void fetchLogs(); }, [fetchLogs]);
  /* eslint-enable react-hooks/set-state-in-effect */

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-[#5a5f6e] font-mono truncate max-w-[200px]">{source}</span>
        <button onClick={() => void fetchLogs()} disabled={loading}
          className="flex items-center gap-1 text-[10px] text-[#5a5f6e] hover:text-[#c8cdd8] transition-colors">
          <RefreshCw className={cn("w-3 h-3", loading && "animate-spin")} /> Refresh
        </button>
      </div>
      <div className="bg-[#060708] border border-[#1e2130] rounded-lg p-3 h-48 overflow-y-auto font-mono text-[10px] text-[#7a8099] space-y-0.5">
        {loading && !lines.length
          ? <span className="text-[#3a3f50]">Loading…</span>
          : !lines.length
          ? <span className="text-[#3a3f50]">No logs available</span>
          : lines.map((l, i) => <div key={i} className="break-all leading-relaxed">{l}</div>)
        }
      </div>
    </div>
  );
}

// ─── Config Editor ────────────────────────────────────────────────────────────

export function ConfigEditor({ agentId }: { agentId: string }) {
  const [files, setFiles] = useState<ConfigFile[]>([]);
  const [activeFileId, setActiveFileId] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [backups, setBackups] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [showBackups, setShowBackups] = useState(false);

  const fetchFiles = useCallback(async () => {
    try {
      const res = await fetch(`/api/agents/${agentId}/config-files`);
      const data = await res.json() as { files: ConfigFile[] };
      setFiles(data.files ?? []);
    } catch { /**/ }
  }, [agentId]);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => { void fetchFiles(); }, [fetchFiles]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const openFile = useCallback(async (fileId: string) => {
    setLoading(true);
    setError("");
    setShowBackups(false);
    try {
      const res = await fetch(`/api/agents/${agentId}/config-files/${fileId}`);
      const data = await res.json() as { content: string; backups: string[]; error?: string };
      if (data.error) { setError(data.error); return; }
      setContent(data.content ?? "");
      setBackups(data.backups ?? []);
      setActiveFileId(fileId);
    } catch { setError("Failed to load file"); }
    finally { setLoading(false); }
  }, [agentId]);

  async function save() {
    if (!activeFileId) return;
    setSaving(true); setSaved(false); setError("");
    try {
      const res = await fetch(`/api/agents/${agentId}/config-files/${activeFileId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      const data = await res.json() as { ok?: boolean; error?: string };
      if (data.error) { setError(data.error); return; }
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch { setError("Save failed"); }
    finally { setSaving(false); }
  }

  async function rollback(backupName: string) {
    if (!activeFileId) return;
    setError("");
    try {
      const res = await fetch(`/api/agents/${agentId}/config-files/${activeFileId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rollbackTo: backupName }),
      });
      const data = await res.json() as { ok?: boolean; error?: string };
      if (data.error) { setError(data.error); return; }
      await openFile(activeFileId);
      setShowBackups(false);
    } catch { setError("Rollback failed"); }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-1 flex-wrap">
        <FolderOpen className="w-3 h-3 text-[#5a5f6e] shrink-0" />
        {files.length === 0
          ? <span className="text-[10px] text-[#3a3f50]">No config files found in AGENT_CONFIG_DIR</span>
          : files.map((f) => (
            <button key={f.id} onClick={() => void openFile(f.id)}
              className={cn(
                "flex items-center gap-1 px-2 py-0.5 rounded text-[10px] border transition-colors",
                activeFileId === f.id
                  ? "border-indigo-500/40 bg-indigo-500/10 text-indigo-300"
                  : "border-[#1e2130] text-[#7a8099] hover:text-[#c8cdd8] hover:border-[#2a2f40]"
              )}>
              <FileCode2 className="w-2.5 h-2.5" />
              {f.name}
            </button>
          ))
        }
      </div>

      {activeFileId && (
        <>
          <div className="flex items-center gap-2">
            <button onClick={() => void save()} disabled={saving || loading}
              className={cn(
                "flex items-center gap-1 text-[10px] px-2 py-0.5 rounded border transition-colors",
                saved
                  ? "border-emerald-500/30 text-emerald-400 bg-emerald-500/10"
                  : "border-[#1e2130] text-[#7a8099] hover:text-[#c8cdd8]"
              )}>
              {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
              {saved ? "Saved" : "Save"}
            </button>
            {backups.length > 0 && (
              <button onClick={() => setShowBackups((p) => !p)}
                className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded border border-[#1e2130] text-[#7a8099] hover:text-[#c8cdd8] transition-colors">
                <History className="w-3 h-3" />
                {backups.length} backup{backups.length !== 1 ? "s" : ""}
              </button>
            )}
          </div>

          {showBackups && (
            <div className="bg-[#060708] border border-[#1e2130] rounded-lg p-2 space-y-1">
              {backups.map((b) => (
                <div key={b} className="flex items-center justify-between gap-2">
                  <span className="text-[10px] font-mono text-[#5a5f6e] truncate">{b}</span>
                  <button onClick={() => void rollback(b)}
                    className="text-[10px] text-amber-400 hover:text-amber-300 transition-colors shrink-0">
                    Restore
                  </button>
                </div>
              ))}
            </div>
          )}

          {error && (
            <p className="text-[10px] text-red-400 flex items-center gap-1">
              <AlertCircle className="w-3 h-3" /> {error}
            </p>
          )}

          {loading
            ? <div className="h-48 flex items-center justify-center bg-[#060708] border border-[#1e2130] rounded-lg">
                <Loader2 className="w-4 h-4 text-[#3a3f50] animate-spin" />
              </div>
            : <textarea value={content} onChange={(e) => setContent(e.target.value)} spellCheck={false}
                className="w-full bg-[#060708] border border-[#1e2130] rounded-lg p-3 h-56 font-mono text-[10px] text-[#c8cdd8] resize-none outline-none focus:border-indigo-500/40 transition-colors" />
          }
        </>
      )}
    </div>
  );
}

// ─── Capability Weights Editor ─────────────────────────────────────────────────

const CAPABILITY_LABELS: Record<AgentCapabilityKey, string> = {
  coding: "Coding", debugging: "Debugging", frontend: "Frontend", backend: "Backend",
  architecture: "Architecture", testing: "Testing", security: "Security",
  database: "Database", devops: "DevOps", research: "Research", refactoring: "Refactoring",
};

export function CapabilityWeightsEditor({ agentId }: { agentId: string }) {
  const [weights, setWeights] = useState<Record<AgentCapabilityKey, number>>(
    () => Object.fromEntries(AGENT_CAPABILITY_KEYS.map((k) => [k, 0.5])) as Record<AgentCapabilityKey, number>
  );
  const [isCustom, setIsCustom] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [dirty, setDirty] = useState(false);

  const applyWeights = useCallback((source: CapabilityWeights) => {
    setWeights(Object.fromEntries(
      AGENT_CAPABILITY_KEYS.map((k) => [k, source[k] ?? 0.5])
    ) as Record<AgentCapabilityKey, number>);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/agents/${agentId}`);
      if (!res.ok) { setError("Failed to load capability weights"); return; }
      const data = await res.json() as { capabilityWeights?: CapabilityWeights };
      const stored = data.capabilityWeights ?? {};
      const custom = Object.keys(stored).length > 0;
      setIsCustom(custom);
      applyWeights(custom ? stored : defaultCapabilityWeights(agentId));
      setDirty(false);
    } catch { setError("Failed to load capability weights"); }
    finally { setLoading(false); }
  }, [agentId, applyWeights]);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => { void load(); }, [load]);
  /* eslint-enable react-hooks/set-state-in-effect */

  function setWeight(key: AgentCapabilityKey, value: number) {
    setWeights((prev) => ({ ...prev, [key]: value }));
    setDirty(true);
    setSaved(false);
  }

  async function save() {
    setSaving(true); setSaved(false); setError("");
    try {
      const res = await fetch(`/api/agents/${agentId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ capabilityWeights: weights }),
      });
      const data = await res.json() as { error?: string };
      if (!res.ok || data.error) { setError(data.error ?? "Save failed"); return; }
      setIsCustom(true);
      setDirty(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch { setError("Save failed"); }
    finally { setSaving(false); }
  }

  function resetToDefaults() {
    applyWeights(defaultCapabilityWeights(agentId));
    setDirty(true);
    setSaved(false);
  }

  if (loading) {
    return (
      <div className="h-32 flex items-center justify-center">
        <Loader2 className="w-4 h-4 text-[#3a3f50] animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className={cn(
          "text-[10px] px-2 py-0.5 rounded-full border",
          isCustom
            ? "border-indigo-500/30 text-indigo-300 bg-indigo-500/10"
            : "border-[#1e2130] text-[#5a5f6e]"
        )}>
          {isCustom ? "Custom weights" : "Using built-in defaults"}
        </span>
        <div className="flex items-center gap-2">
          <button onClick={resetToDefaults}
            className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded border border-[#1e2130] text-[#7a8099] hover:text-[#c8cdd8] transition-colors">
            <ResetIcon className="w-3 h-3" /> Reset to defaults
          </button>
          <button onClick={() => void save()} disabled={saving || !dirty}
            className={cn(
              "flex items-center gap-1 text-[10px] px-2 py-0.5 rounded border transition-colors",
              saved
                ? "border-emerald-500/30 text-emerald-400 bg-emerald-500/10"
                : "border-[#1e2130] text-[#7a8099] hover:text-[#c8cdd8] disabled:opacity-40"
            )}>
            {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
            {saved ? "Saved" : "Save"}
          </button>
        </div>
      </div>

      {error && (
        <p className="text-[10px] text-red-400 flex items-center gap-1">
          <AlertCircle className="w-3 h-3" /> {error}
        </p>
      )}

      <p className="text-[10px] text-[#5a5f6e]">
        Routing hints the worker-router uses to score this agent against a task&apos;s required capabilities (0 = no fit, 1 = ideal fit). Actual routing also factors in current workload, file-scope conflicts, and this agent&apos;s real track record.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2">
        {AGENT_CAPABILITY_KEYS.map((key) => (
          <div key={key} className="space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-[#c8cdd8]">{CAPABILITY_LABELS[key]}</span>
              <span className="text-[10px] font-mono text-[#5a5f6e]">{weights[key].toFixed(2)}</span>
            </div>
            <input
              type="range" min={0} max={1} step={0.05} value={weights[key]}
              onChange={(e) => setWeight(key, Number(e.target.value))}
              className="w-full accent-indigo-500"
            />
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Agent Card ───────────────────────────────────────────────────────────────

function AgentCard({ agent }: { agent: VpsAgent }) {
  const [status, setStatus] = useState<AgentStatus>("checking");
  const [checkedAt, setCheckedAt] = useState<string | null>(null);
  const [panel, setPanel] = useState<"logs" | "config" | "capabilities" | null>(null);
  const [restarting, setRestarting] = useState(false);
  const [reloading, setReloading] = useState(false);
  const [actionMsg, setActionMsg] = useState("");

  const checkHealth = useCallback(async () => {
    setStatus("checking");
    try {
      const res = await fetch(`/api/agents/${agent.id}/health`);
      if (res.status === 401) { setStatus("unknown"); return; }
      const data = await res.json() as { status: AgentStatus; checkedAt?: string };
      setStatus(data.status ?? "unknown");
      setCheckedAt(data.checkedAt ?? null);
    } catch { setStatus("offline"); }
  }, [agent.id]);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => { void checkHealth(); }, [checkHealth]);
  /* eslint-enable react-hooks/set-state-in-effect */

  async function handleRestart() {
    setRestarting(true); setActionMsg("");
    try {
      const res = await fetch(`/api/agents/${agent.id}/restart`, { method: "POST" });
      const data = await res.json() as { ok: boolean; message?: string; error?: string };
      setActionMsg(data.message ?? data.error ?? "");
      if (data.ok) setTimeout(() => void checkHealth(), 4000);
    } finally { setRestarting(false); setTimeout(() => setActionMsg(""), 5000); }
  }

  async function handleReload() {
    setReloading(true); setActionMsg("");
    try {
      const res = await fetch(`/api/agents/${agent.id}/reload`, { method: "POST" });
      const data = await res.json() as { ok: boolean; message?: string; error?: string };
      setActionMsg(data.message ?? data.error ?? "");
      if (data.ok) setTimeout(() => void checkHealth(), 3000);
    } finally { setReloading(false); setTimeout(() => setActionMsg(""), 5000); }
  }

  const kindColor = agent.kind === "hermes" ? "text-violet-400" : agent.kind === "openclaw" ? "text-amber-400" : "text-indigo-400";
  const kindBg = agent.kind === "hermes" ? "bg-violet-500/10 border-violet-500/20" : agent.kind === "openclaw" ? "bg-amber-500/10 border-amber-500/20" : "bg-indigo-500/10 border-indigo-500/20";

  return (
    <div className={cn(
      "bg-[#0c0e12] border rounded-xl overflow-hidden transition-all",
      panel ? "border-[#2a2f40]" : "border-[#1e2130]"
    )}>
      <div className="flex items-center gap-3 p-4">
        <div className={cn("w-10 h-10 rounded-xl border flex items-center justify-center shrink-0", kindBg)}>
          {agent.kind === "hermes" ? <Cpu className={cn("w-5 h-5", kindColor)} /> : <Bot className={cn("w-5 h-5", kindColor)} />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-[#e2e5ed]">{agent.name}</span>
            <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", STATUS_DOT[status])} />
            <span className="text-[10px] text-[#5a5f6e]">{STATUS_LABEL[status]}</span>
          </div>
          <p className="text-xs text-[#5a5f6e] truncate">{agent.description}</p>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {agent.legacyPath && (
            <a href={agent.legacyPath} target="_blank" rel="noreferrer"
              className="p-1.5 rounded-lg text-[#5a5f6e] hover:text-[#c8cdd8] hover:bg-white/5 transition-colors" title="Legacy UI">
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          )}
          <button onClick={() => void checkHealth()} disabled={status === "checking"}
            className="p-1.5 rounded-lg text-[#5a5f6e] hover:text-[#c8cdd8] hover:bg-white/5 transition-colors" title="Health check">
            {status === "checking" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> :
              status === "online" ? <Wifi className="w-3.5 h-3.5 text-emerald-400" /> :
              <WifiOff className="w-3.5 h-3.5 text-red-400" />}
          </button>
          <button onClick={() => void handleReload()} disabled={reloading}
            className="p-1.5 rounded-lg text-[#5a5f6e] hover:text-indigo-400 hover:bg-indigo-500/10 transition-colors" title="Reload (SIGHUP)">
            <RotateCw className={cn("w-3.5 h-3.5", reloading && "animate-spin")} />
          </button>
          <button onClick={() => void handleRestart()} disabled={restarting}
            className="p-1.5 rounded-lg text-[#5a5f6e] hover:text-amber-400 hover:bg-amber-500/10 transition-colors" title="Full restart">
            <RotateCcw className={cn("w-3.5 h-3.5", restarting && "animate-spin")} />
          </button>
        </div>
      </div>

      <div className="flex items-center gap-3 px-4 pb-3 text-[10px] text-[#5a5f6e] flex-wrap">
        <span className="font-mono truncate max-w-[200px]">{agent.endpoint}</span>
        <span className="ml-auto">{agent.model}</span>
        <span>scope:{agent.memoryScope}</span>
        {checkedAt && (
          <span className="flex items-center gap-0.5">
            <Clock className="w-2.5 h-2.5" />{new Date(checkedAt).toLocaleTimeString()}
          </span>
        )}
      </div>

      {actionMsg && (
        <div className="mx-4 mb-3 px-3 py-1.5 rounded-lg bg-[#080a0d] border border-[#1e2130] text-[10px] text-[#7a8099]">
          {actionMsg}
        </div>
      )}

      <div className="flex border-t border-[#1e2130]">
        {(["logs", "config", "capabilities"] as const).map((p, i) => (
          <button key={p} onClick={() => setPanel(panel === p ? null : p)}
            className={cn(
              "flex-1 flex items-center justify-center gap-1.5 py-2 text-[10px] font-medium transition-colors",
              i > 0 && "border-l border-[#1e2130]",
              panel === p ? "text-indigo-400 bg-indigo-500/5" : "text-[#5a5f6e] hover:text-[#c8cdd8] hover:bg-white/3"
            )}>
            {p === "logs" ? <Terminal className="w-3 h-3" /> : p === "config" ? <FileText className="w-3 h-3" /> : <SlidersHorizontal className="w-3 h-3" />}
            {p === "logs" ? "Logs" : p === "config" ? "Config" : "Capabilities"}
            {panel === p ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
          </button>
        ))}
      </div>

      {panel && (
        <div className="p-4 border-t border-[#1e2130] bg-[#080a0d]">
          {panel === "logs" && <LogsPanel agentId={agent.id} />}
          {panel === "config" && <ConfigEditor agentId={agent.id} />}
          {panel === "capabilities" && <CapabilityWeightsEditor agentId={agent.id} />}
        </div>
      )}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export function AgentsPage() {
  const [agents, setAgents] = useState<VpsAgent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [authError, setAuthError] = useState(false);

  useEffect(() => {
    fetch("/api/vps/agents")
      .then((r) => {
        if (r.status === 401) { setAuthError(true); setLoading(false); return null; }
        return r.json() as Promise<VpsAgent[]>;
      })
      .then((data) => {
        if (data) setAgents(data);
        setLoading(false);
      })
      .catch(() => { setError("Failed to load agent registry"); setLoading(false); });
  }, []);

  return (
    <div className="h-full overflow-y-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-violet-500/10 border border-violet-500/20 flex items-center justify-center">
            <Server className="w-4 h-4 text-violet-400" />
          </div>
          <div>
            <h1 className="text-base font-semibold text-[#e2e5ed]">Agent Registry</h1>
            <p className="text-xs text-[#5a5f6e]">Hermes and OpenClaw — health, logs, config</p>
          </div>
        </div>
        <div className="flex items-center gap-1 text-[10px] text-[#3a3f50]">
          <Activity className="w-3 h-3" />
          <span>Live health checks</span>
        </div>
      </div>

      <div className="flex items-center gap-4 text-[10px] text-[#5a5f6e]">
        {[["bg-emerald-400", "Online"], ["bg-yellow-400", "Degraded"], ["bg-red-400", "Offline"], ["bg-[#3a3f50]", "Unknown"]]
          .map(([color, label]) => (
            <span key={label} className="flex items-center gap-1.5">
              <span className={cn("w-1.5 h-1.5 rounded-full", color)} />
              {label}
            </span>
          ))}
        <div className="ml-auto flex items-center gap-1 text-amber-500/80">
          <ShieldAlert className="w-3 h-3" />
          <span>Restart and config edits require Owner or Admin</span>
        </div>
      </div>

      {loading && <div className="flex items-center justify-center py-16"><Loader2 className="w-6 h-6 text-[#3a3f50] animate-spin" /></div>}

      {authError && (
        <div className="flex items-center gap-2 p-4 bg-yellow-500/5 border border-yellow-500/20 rounded-xl text-sm text-yellow-400">
          <AlertCircle className="w-4 h-4 shrink-0" />
          Sign in to view the agent registry.
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 p-4 bg-red-500/5 border border-red-500/20 rounded-xl text-sm text-red-400">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {error}
        </div>
      )}

      {!loading && !error && !authError && (
        <>
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: "Total agents", value: agents.length, icon: Server },
              { label: "Hermes", value: agents.filter((a) => a.kind === "hermes").length, icon: Cpu },
              { label: "OpenClaw", value: agents.filter((a) => a.kind === "openclaw").length, icon: Bot },
            ].map(({ label, value, icon: Icon }) => (
              <div key={label} className="bg-[#0c0e12] border border-[#1e2130] rounded-xl p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Icon className="w-4 h-4 text-[#5a5f6e]" /><span className="text-[10px] text-[#5a5f6e]">{label}</span>
                </div>
                <span className="text-2xl font-semibold text-[#e2e5ed]">{value}</span>
              </div>
            ))}
          </div>

          <div className="space-y-3">
            <h2 className="text-xs font-medium text-[#7a8099] uppercase tracking-wider">
              Registered Agents <span className="text-[#3a3f50] normal-case font-normal">({agents.length})</span>
            </h2>
            {agents.map((a) => <AgentCard key={a.id} agent={a} />)}
            {agents.length === 0 && (
              <div className="text-center py-12 text-sm text-[#3a3f50]">
                <CheckCircle2 className="w-6 h-6 mx-auto mb-2 text-[#1e2130]" />
                No VPS agents configured. Set HERMES_ENDPOINT in .env.local
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
