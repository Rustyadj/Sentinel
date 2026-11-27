"use client";

import { useCallback, useEffect, useState } from "react";
import { Ban, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { WorkspaceHeader } from "@/components/workspace/WorkspaceHeader";
import { WorkspaceShell } from "@/components/workspace/WorkspaceShell";
import { cn } from "@/lib/utils";
// Client-safe modules only (no db / node imports).
import { AUTHORITY_OPERATIONS, CONSEQUENTIAL_OPERATIONS } from "@/lib/autonomy/authority";
import { AUTONOMY_SETTING_KEYS, NUMERIC_BOUNDS, type AutonomySettingsValues } from "@/lib/autonomy/settings";
import type { LayerDiffEntry } from "@/lib/autonomy/prompt-layers";

const field = "w-full rounded-md border border-(--border) bg-(--field) px-2.5 py-1.5 text-[13px] focus-visible:outline-2 focus-visible:outline-(--ring)";
const panel = "rounded-lg border border-(--border) bg-(--card) p-4";
const muted = "text-[12px] text-(--muted-foreground)";

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${typeof data.error === "string" ? data.error : `Request failed (${res.status})`}${Array.isArray(data.details) ? `: ${data.details.join("; ")}` : ""}`);
  return data as T;
}

interface Grant {
  id: string; operations: string[]; projectId: string | null; agentId: string | null; roomId: string | null; objectiveId: string | null;
  capabilities: string[]; runtimes: string[]; maxUses: number | null; usesCount: number; budgetCents: number | null; spentCents: number;
  period: string | null; periodMaxUses: number | null; expiresAt: string | null; revokedAt: string | null; reason: string; createdAt: string;
  uses: { id: string; operation: string; subjectType: string; subjectId: string; agentId: string; createdAt: string }[];
}
interface Metrics {
  windowDays: number; humanInterventions: number;
  objectives: { total: number; completed: number; completionRate: number | null; approvalRequests: number; approvalRequestsPerObjective: number | null; stepsClearedByStandingAuthority: number; failureRecoveryRate: number | null };
  roomTasks: { approvalRequests: number; clearedByStandingAuthority: number; humanQuestions: number };
  authority: { activeGrants: number; uses: number; revokedGrants: number };
  prompts: { compositions: number; avgSentinelChars: number | null; avgTotalChars: number | null; sentinelRestrictionFindings: number };
}
interface Composition { id: string; agentId: string; surface: string; layers: { id: string; source: string; version: string | null; chars: number; status: string }[]; sentinelText: string; sentinelChars: number; totalChars: number; useCount: number; lastUsedAt: string; sentinelRestrictionFindings: { code: string }[] }
interface Capability { key: string; kind: string; name: string; description: string; available: boolean; requiredAuthority: string; authorized: boolean; missingAuthority: string | null; reliability: number | null; credentialRef: string | null }

const pct = (n: number | null) => (n === null ? "—" : `${Math.round(n * 100)}%`);

export function AutonomyConsole({ workspaces }: { workspaces: { id: string; name: string }[] }) {
  const [workspaceId, setWorkspaceId] = useState(workspaces[0]?.id ?? "");
  const [error, setError] = useState<string | null>(null);

  return (
    <WorkspaceShell>
      <WorkspaceHeader
        title="Autonomy"
        description="Delegate authority once, set how independently agents work, and see exactly what they did and why."
        showBack={false}
        actions={workspaces.length > 1 ? (
          <select aria-label="Workspace" className={cn(field, "w-auto")} value={workspaceId} onChange={(e) => setWorkspaceId(e.target.value)}>
            {workspaces.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
        ) : null}
      />
      {error ? <p role="alert" className="mb-4 rounded-lg border border-(--status-error) px-3 py-2 text-[13px] text-(--status-error)">{error}</p> : null}
      {!workspaceId ? <p className={muted}>You are not a member of any workspace yet.</p> : (
        <Tabs defaultValue="overview">
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="authority">Delegated authority</TabsTrigger>
            <TabsTrigger value="settings">Settings</TabsTrigger>
            <TabsTrigger value="capabilities">Capabilities</TabsTrigger>
            <TabsTrigger value="prompts">Prompt inspector</TabsTrigger>
          </TabsList>
          <TabsContent value="overview"><Overview workspaceId={workspaceId} onError={setError} /></TabsContent>
          <TabsContent value="authority"><Authority workspaceId={workspaceId} onError={setError} /></TabsContent>
          <TabsContent value="settings"><SettingsPanel workspaceId={workspaceId} onError={setError} /></TabsContent>
          <TabsContent value="capabilities"><Capabilities workspaceId={workspaceId} onError={setError} /></TabsContent>
          <TabsContent value="prompts"><Prompts workspaceId={workspaceId} onError={setError} /></TabsContent>
        </Tabs>
      )}
    </WorkspaceShell>
  );
}

type PanelProps = { workspaceId: string; onError(message: string | null): void };

function useLoader<T>(url: string | null, onError: PanelProps["onError"]) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(false);
  const load = useCallback(async () => {
    if (!url) return;
    setLoading(true);
    try { setData(await call<T>(url)); onError(null); } catch (e) { onError(e instanceof Error ? e.message : "Load failed"); } finally { setLoading(false); }
  }, [url, onError]);
  useEffect(() => { const t = setTimeout(() => void load(), 0); return () => clearTimeout(t); }, [load]);
  return { data, loading, reload: load };
}

function Stat({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="rounded-lg border border-(--border) bg-(--card) px-3 py-2.5">
      <div className={muted}>{label}</div>
      <div className="mt-0.5 font-mono text-[18px] text-(--foreground)">{value}</div>
      {hint ? <div className="mt-0.5 text-[11px] text-(--muted-foreground)">{hint}</div> : null}
    </div>
  );
}

function Overview({ workspaceId, onError }: PanelProps) {
  const { data, loading, reload } = useLoader<{ metrics: Metrics }>(`/api/autonomy/metrics?workspaceId=${encodeURIComponent(workspaceId)}`, onError);
  const m = data?.metrics;
  return (
    <section className="mt-4 space-y-4" aria-busy={loading}>
      <div className="flex items-center justify-between">
        <p className={muted}>Counted from execution records over the last {m?.windowDays ?? 30} days — not from agent self-reports.</p>
        <Button size="sm" variant="ghost" onClick={() => void reload()} disabled={loading}><RefreshCw className="mr-1 h-3.5 w-3.5" />Refresh</Button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Human interventions" value={m?.humanInterventions ?? "—"} hint="approvals asked + questions to you" />
        <Stat label="Approvals per objective" value={m?.objectives.approvalRequestsPerObjective ?? "—"} hint={`${m?.objectives.stepsClearedByStandingAuthority ?? 0} steps cleared by standing authority`} />
        <Stat label="Objective completion" value={pct(m?.objectives.completionRate ?? null)} hint={`${m?.objectives.completed ?? 0} of ${m?.objectives.total ?? 0}`} />
        <Stat label="Failure recovery" value={pct(m?.objectives.failureRecoveryRate ?? null)} hint="retried steps that then completed" />
        <Stat label="Room task approvals" value={m?.roomTasks.approvalRequests ?? "—"} hint={`${m?.roomTasks.clearedByStandingAuthority ?? 0} cleared by standing authority`} />
        <Stat label="Active grants" value={m?.authority.activeGrants ?? "—"} hint={`${m?.authority.uses ?? 0} uses · ${m?.authority.revokedGrants ?? 0} revoked`} />
        <Stat label="Sentinel prompt overhead" value={m?.prompts.avgSentinelChars ?? "—"} hint={`avg chars of ${m?.prompts.avgTotalChars ?? "—"} per turn`} />
        <Stat label="Redundant restrictions" value={m?.prompts.sentinelRestrictionFindings ?? "—"} hint="in Sentinel's own prompt layers (target 0)" />
      </div>
    </section>
  );
}

function Authority({ workspaceId, onError }: PanelProps) {
  const { data, loading, reload } = useLoader<{ grants: Grant[] }>(`/api/autonomy/grants?workspaceId=${encodeURIComponent(workspaceId)}&includeRevoked=1`, onError);
  const [ops, setOps] = useState<string[]>(["routine"]);
  const [agentId, setAgentId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [capabilities, setCapabilities] = useState("");
  const [maxUses, setMaxUses] = useState("");
  const [budget, setBudget] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const toggle = (op: string) => setOps((current) => current.includes(op) ? current.filter((o) => o !== op) : [...current, op]);

  const submit = async () => {
    setBusy(true);
    try {
      await call("/api/autonomy/grants", { method: "POST", body: JSON.stringify({
        workspaceId, operations: ops, agentId: agentId || undefined, projectId: projectId || undefined,
        capabilities: capabilities.split(",").map((c) => c.trim()).filter(Boolean),
        maxUses: maxUses ? Number(maxUses) : undefined, budgetCents: budget ? Math.round(Number(budget) * 100) : undefined,
        expiresAt: expiresAt ? new Date(expiresAt).toISOString() : undefined, reason,
      }) });
      setReason(""); onError(null); await reload();
    } catch (e) { onError(e instanceof Error ? e.message : "Could not create grant"); } finally { setBusy(false); }
  };
  const revoke = async (id: string) => {
    setBusy(true);
    try { await call(`/api/autonomy/grants/${id}`, { method: "DELETE", body: JSON.stringify({}) }); await reload(); } catch (e) { onError(e instanceof Error ? e.message : "Revoke failed"); } finally { setBusy(false); }
  };

  return (
    <div className="mt-4 grid gap-6 xl:grid-cols-[360px_minmax(0,1fr)]">
      <form className={cn(panel, "space-y-3")} onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <h2 className="text-[14px] font-semibold">Delegate authority</h2>
        <fieldset className="space-y-1.5">
          <legend className={muted}>Operations</legend>
          <div className="flex flex-wrap gap-1.5">
            {["routine", ...AUTHORITY_OPERATIONS].map((op) => (
              <button key={op} type="button" aria-pressed={ops.includes(op)} onClick={() => toggle(op)}
                className={cn("rounded-md border px-2 py-1 text-[12px] transition-colors focus-visible:outline-2 focus-visible:outline-(--ring)",
                  ops.includes(op) ? "border-(--border-strong) bg-(--muted) text-(--foreground)" : "border-(--border) text-(--muted-foreground) hover:bg-(--muted)")}>
                {op}{(CONSEQUENTIAL_OPERATIONS as readonly string[]).includes(op) ? " *" : ""}
              </button>
            ))}
          </div>
          <p className="text-[11px] text-(--muted-foreground)">routine = read, write, exec, delegate. * consequential: named explicitly, needs permission.manage. financial needs a budget.</p>
        </fieldset>
        <div className="grid grid-cols-2 gap-3">
          <label className="block space-y-1 text-[12px] text-(--muted-foreground)">Agent (blank = any)<input className={field} value={agentId} onChange={(e) => setAgentId(e.target.value)} placeholder="codex" /></label>
          <label className="block space-y-1 text-[12px] text-(--muted-foreground)">Project id (blank = any)<input className={field} value={projectId} onChange={(e) => setProjectId(e.target.value)} /></label>
          <label className="block space-y-1 text-[12px] text-(--muted-foreground)">Max uses<input className={field} type="number" min="1" value={maxUses} onChange={(e) => setMaxUses(e.target.value)} /></label>
          <label className="block space-y-1 text-[12px] text-(--muted-foreground)">Budget (USD)<input className={field} type="number" min="0" step="1" value={budget} onChange={(e) => setBudget(e.target.value)} /></label>
        </div>
        <label className="block space-y-1 text-[12px] text-(--muted-foreground)">Capabilities (comma-separated, blank = any)<input className={field} value={capabilities} onChange={(e) => setCapabilities(e.target.value)} placeholder="backend, testing" /></label>
        <label className="block space-y-1 text-[12px] text-(--muted-foreground)">Expires<input className={field} type="datetime-local" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} /></label>
        <label className="block space-y-1 text-[12px] text-(--muted-foreground)">Reason<input className={field} value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} placeholder="Routine engineering on the import service" /></label>
        <Button type="submit" size="sm" disabled={busy || ops.length === 0}>Delegate</Button>
      </form>

      <section aria-label="Grants" aria-busy={loading} className="min-w-0 space-y-2">
        {data && data.grants.length === 0 ? (
          <div className="rounded-lg border border-dashed border-(--border) p-8 text-center text-[13px] text-(--muted-foreground)">No standing authority yet — every non-read action asks you individually. Delegate routine work to stop repeated approvals.</div>
        ) : null}
        {data?.grants.map((g) => (
          <article key={g.id} className={cn(panel, g.revokedAt && "opacity-60")}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex flex-wrap gap-1.5">{g.operations.map((op) => <Badge key={op} variant={(CONSEQUENTIAL_OPERATIONS as readonly string[]).includes(op) ? "warning" : "secondary"}>{op}</Badge>)}</div>
                <p className="mt-1.5 text-[12px] text-(--muted-foreground)">
                  {[g.agentId ? `agent ${g.agentId}` : "any agent", g.projectId ? `project ${g.projectId}` : "whole workspace", g.capabilities.length ? `caps ${g.capabilities.join("/")}` : null,
                    g.maxUses !== null ? `${g.usesCount}/${g.maxUses} uses` : `${g.usesCount} uses`, g.budgetCents !== null ? `$${(g.spentCents / 100).toFixed(2)} of $${(g.budgetCents / 100).toFixed(2)}` : null,
                    g.expiresAt ? `expires ${new Date(g.expiresAt).toLocaleString()}` : null].filter(Boolean).join(" · ")}
                </p>
                {g.reason ? <p className="mt-1 text-[13px]">{g.reason}</p> : null}
              </div>
              {g.revokedAt ? <Badge variant="outline">revoked</Badge> : (
                <Button size="sm" variant="outline" disabled={busy} onClick={() => void revoke(g.id)}><Ban className="mr-1 h-3.5 w-3.5" />Revoke</Button>
              )}
            </div>
            {g.uses.length ? (
              <ol className="mt-2 space-y-0.5 border-t border-(--border) pt-2 text-[11px] text-(--muted-foreground)">
                {g.uses.map((u) => <li key={u.id} className="font-mono">{new Date(u.createdAt).toLocaleString()} · {u.agentId} · {u.operation} · {u.subjectType} {u.subjectId.slice(0, 10)}</li>)}
              </ol>
            ) : null}
          </article>
        ))}
      </section>
    </div>
  );
}

const SETTING_LABELS: Record<keyof AutonomySettingsValues, string> = {
  proactiveExecution: "Proactive execution", independentTaskGeneration: "Independent task generation", automaticContinuation: "Automatic continuation",
  autonomousDelegation: "Autonomous delegation", dynamicToolDiscovery: "Dynamic tool discovery", skillDevelopment: "Skill development",
  recurringWorkflows: "Recurring workflows", standingDelegation: "Honour standing delegation", externalIntegrations: "External integrations",
  maxOrchestrationIterations: "Orchestration budget (turns)", maxRecoveryAttempts: "Recovery attempts per step", maxConcurrentTasks: "Concurrent tasks",
  proactiveIntervalMinutes: "Min minutes between proactive runs", proactiveDailyLimit: "Proactive runs per day", proactiveMinScore: "Proactive min score (0–1)",
};

function SettingsPanel({ workspaceId, onError }: PanelProps) {
  const [agentId, setAgentId] = useState("");
  const url = `/api/autonomy/settings?workspaceId=${encodeURIComponent(workspaceId)}${agentId ? `&agentId=${encodeURIComponent(agentId)}` : ""}`;
  const { data, reload } = useLoader<{ effective: AutonomySettingsValues; defaults: AutonomySettingsValues }>(url, onError);
  const [saving, setSaving] = useState<string | null>(null);
  const save = async (key: keyof AutonomySettingsValues, value: boolean | number) => {
    setSaving(key);
    try { await call("/api/autonomy/settings", { method: "PUT", body: JSON.stringify({ workspaceId, agentId: agentId || undefined, settings: { [key]: value } }) }); await reload(); } catch (e) { onError(e instanceof Error ? e.message : "Save failed"); } finally { setSaving(null); }
  };
  return (
    <section className={cn(panel, "mt-4 space-y-3")}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <p className={muted}>Productive autonomy is the default. None of these can override provider requirements, tenant isolation or the authority checks.</p>
        <label className="block space-y-1 text-[12px] text-(--muted-foreground)">Agent override (blank = workspace default)
          <input className={cn(field, "w-56")} value={agentId} onChange={(e) => setAgentId(e.target.value.trim())} placeholder="hermes-lisa" />
        </label>
      </div>
      <ul className="divide-y divide-(--border)">
        {data ? AUTONOMY_SETTING_KEYS.map((key) => {
          const value = data.effective[key];
          return (
            <li key={key} className="flex items-center justify-between gap-4 py-2.5">
              <span className="text-[13px]">{SETTING_LABELS[key]}{value !== data.defaults[key] ? <span className="ml-2 text-[11px] text-(--muted-foreground)">(default {String(data.defaults[key])})</span> : null}</span>
              {typeof value === "boolean" ? (
                <Switch checked={value} disabled={saving === key} aria-label={SETTING_LABELS[key]} onCheckedChange={(checked: boolean) => void save(key, checked)} />
              ) : (
                <input key={`${key}-${value}`} aria-label={SETTING_LABELS[key]} className={cn(field, "w-28 text-right font-mono")} type="number"
                  min={NUMERIC_BOUNDS[key as keyof typeof NUMERIC_BOUNDS].min} max={NUMERIC_BOUNDS[key as keyof typeof NUMERIC_BOUNDS].max}
                  step={NUMERIC_BOUNDS[key as keyof typeof NUMERIC_BOUNDS].integer ? 1 : 0.05} defaultValue={value}
                  onBlur={(e) => { const next = Number(e.target.value); if (Number.isFinite(next) && next !== value) void save(key, next); }} />
              )}
            </li>
          );
        }) : <li className="py-6 text-center text-[13px] text-(--muted-foreground)">Loading settings…</li>}
      </ul>
    </section>
  );
}

function Capabilities({ workspaceId, onError }: PanelProps) {
  const [query, setQuery] = useState("");
  const [agentId, setAgentId] = useState("hermes-lisa");
  const [submitted, setSubmitted] = useState({ query: "", agentId: "hermes-lisa" });
  const { data, loading } = useLoader<{ capabilities: Capability[] }>(`/api/autonomy/capabilities?workspaceId=${encodeURIComponent(workspaceId)}&agentId=${encodeURIComponent(submitted.agentId)}&q=${encodeURIComponent(submitted.query)}&limit=50`, onError);
  return (
    <section className="mt-4 space-y-3">
      <form className="flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); setSubmitted({ query, agentId }); }}>
        <input aria-label="What is needed" className={cn(field, "min-w-64 flex-1")} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="What does the agent need? e.g. search the web, send email, run tests" />
        <input aria-label="As agent" className={cn(field, "w-40")} value={agentId} onChange={(e) => setAgentId(e.target.value)} />
        <Button type="submit" size="sm" disabled={loading}>Discover</Button>
      </form>
      <p className={muted}>Discovery shows whether the agent already holds the authority to use each capability. It never grants access.</p>
      <ul className="space-y-1.5" aria-busy={loading}>
        {data?.capabilities.length === 0 ? <li className="text-[13px] text-(--muted-foreground)">Nothing matches — try a broader description, or register an MCP server under Bots.</li> : null}
        {data?.capabilities.map((c) => (
          <li key={c.key} className={cn(panel, "flex flex-wrap items-start justify-between gap-2 py-2.5")}>
            <div className="min-w-0">
              <div className="text-[13px] font-medium">{c.name} <span className="ml-1 font-mono text-[11px] text-(--muted-foreground)">{c.kind}</span></div>
              {c.description ? <p className="mt-0.5 text-[12px] text-(--muted-foreground)">{c.description}</p> : null}
              {c.missingAuthority ? <p className="mt-0.5 text-[11px] text-(--status-busy)">{c.missingAuthority}</p> : null}
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge variant="outline">{c.requiredAuthority}</Badge>
              <Badge variant={c.available ? "success" : "secondary"}>{c.available ? "available" : "unavailable"}</Badge>
              <Badge variant={c.authorized ? "success" : "warning"}>{c.authorized ? "authorized" : "needs authority"}</Badge>
              {c.reliability !== null ? <span className="font-mono text-[11px] text-(--muted-foreground)">{pct(c.reliability)} reliable</span> : null}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Prompts({ workspaceId, onError }: PanelProps) {
  const [agentId, setAgentId] = useState("");
  const { data, loading } = useLoader<{ compositions: Composition[] }>(`/api/autonomy/prompts?workspaceId=${encodeURIComponent(workspaceId)}${agentId ? `&agentId=${encodeURIComponent(agentId)}` : ""}`, onError);
  const [open, setOpen] = useState<string | null>(null);
  const [pair, setPair] = useState<string[]>([]);
  const [diff, setDiff] = useState<LayerDiffEntry[] | null>(null);
  const togglePair = (id: string) => setPair((current) => current.includes(id) ? current.filter((x) => x !== id) : [...current.slice(-1), id]);
  const compare = async () => {
    try { setDiff((await call<{ diff: LayerDiffEntry[] }>(`/api/autonomy/prompts?workspaceId=${encodeURIComponent(workspaceId)}&compare=${pair.join(",")}`)).diff); } catch (e) { onError(e instanceof Error ? e.message : "Compare failed"); }
  };
  return (
    <section className="mt-4 space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <label className="block space-y-1 text-[12px] text-(--muted-foreground)">Agent<input className={cn(field, "w-48")} value={agentId} onChange={(e) => setAgentId(e.target.value.trim())} placeholder="all agents" /></label>
        <Button size="sm" variant="secondary" disabled={pair.length !== 2} onClick={() => void compare()}>Compare selected ({pair.length}/2)</Button>
      </div>
      <p className={muted}>Exactly what Sentinel contributed to each agent prompt, per surface. Agent identity and task content are listed as layers but not stored.</p>
      {diff ? (
        <div className={panel}>
          <h3 className="mb-1.5 text-[13px] font-semibold">Layer comparison</h3>
          <ul className="space-y-0.5 font-mono text-[12px]">
            {diff.map((d) => <li key={d.id} className={d.change === "unchanged" ? "text-(--muted-foreground)" : ""}>{d.change.padEnd(9)} {d.id} {d.before?.version ?? ""}{d.after && d.before?.version !== d.after.version ? ` → ${d.after.version ?? ""}` : ""} ({d.before?.chars ?? 0} → {d.after?.chars ?? 0} chars)</li>)}
          </ul>
        </div>
      ) : null}
      <ul className="space-y-1.5" aria-busy={loading}>
        {data?.compositions.length === 0 ? <li className="text-[13px] text-(--muted-foreground)">No agent turns recorded yet in this workspace.</li> : null}
        {data?.compositions.map((c) => (
          <li key={c.id} className={panel}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label className="flex items-center gap-2 text-[13px]">
                <input type="checkbox" checked={pair.includes(c.id)} onChange={() => togglePair(c.id)} aria-label={`Select ${c.agentId} ${c.surface} for comparison`} />
                <span className="font-medium">{c.agentId}</span><span className="font-mono text-[11px] text-(--muted-foreground)">{c.surface}</span>
              </label>
              <div className="flex items-center gap-2 font-mono text-[11px] text-(--muted-foreground)">
                {c.sentinelRestrictionFindings.length ? <Badge variant="destructive">{c.sentinelRestrictionFindings.length} restriction findings</Badge> : null}
                <span>{c.sentinelChars}/{c.totalChars} chars Sentinel</span><span>×{c.useCount}</span>
                <Button size="sm" variant="ghost" onClick={() => setOpen(open === c.id ? null : c.id)} aria-expanded={open === c.id}>{open === c.id ? "Hide" : "Inspect"}</Button>
              </div>
            </div>
            <div className="mt-1.5 flex flex-wrap gap-1">
              {c.layers.map((l, i) => <Badge key={`${l.id}-${i}`} variant={l.status === "included" ? (l.source === "sentinel" ? "default" : "secondary") : "outline"}>{l.id}{l.version ? `@${l.version}` : ""} · {l.source}{l.status !== "included" ? ` · ${l.status.replace(/_/g, " ")}` : ""}</Badge>)}
            </div>
            {open === c.id ? <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap rounded-md bg-(--muted) p-3 font-mono text-[12px]">{c.sentinelText || "(no Sentinel layers in this composition)"}</pre> : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
