"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { ArrowLeft, ChevronDown, ChevronRight, Plus, RefreshCw, Trash2 } from "lucide-react";
import { BotAvatar, AVATARS, Button, Empty, Field, Notice, Pill, Select, TextArea, TextInput, lines, statusTone } from "./bits";
import { api, errorMessage, MEMORY_SCOPE_LABEL, TERMINAL } from "./client";
import { TaskView, type TaskData } from "./TaskView";
import type { BotRecord } from "@/lib/bots/service";

type Bot = BotRecord;
interface Detail { bot: Bot; grants: { serverId: string; toolName: string; permission: string }[]; skills: { id: string; name: string; description: string; status: string; enabled: boolean; requiredTools: string[] }[] }
interface CatalogServer { id: string; slug: string; name: string; kind: string; description: string; enabled: boolean; status: string; lastError: string | null; lastDiscoveredAt: string | null; url?: string; capabilityTags: string[]; tools: { name: string; description?: string; readOnly: boolean | null; risk?: string }[] }
interface Meta { hosts: { agentId: string; executionVerified: boolean; health: { ready: boolean } | null }[]; models: { choices: string[]; inherited: { model: string }; unsupported: string[] } | null; memoryScopes: string[]; callers: { agents: string[]; clients: { key: string; name: string }[] } }

const TABS = [["overview", "Overview"], ["model", "Model and limits"], ["skills", "Skills"], ["tools", "Tools"], ["memory", "Memory"], ["delegation", "Delegation"], ["test", "Test"], ["activity", "Activity"]] as const;
type TabId = (typeof TABS)[number][0];

const PERMS = [["disabled", "Off"], ["read", "Read only"], ["execute", "Execute"], ["approval", "Needs approval"]] as const;

function useSaver(reload: () => Promise<void>) {
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ tone: "good" | "bad"; text: string } | null>(null);
  const save = async (fn: () => Promise<unknown>, ok = "Saved.") => {
    setSaving(true); setMsg(null);
    try { await fn(); await reload(); setMsg({ tone: "good", text: ok }); } catch (e) { setMsg({ tone: "bad", text: errorMessage(e) }); } finally { setSaving(false); }
  };
  return { saving, msg, save, setMsg };
}
const SaveBar = ({ saving, msg, onSave, label = "Save changes" }: { saving: boolean; msg: { tone: "good" | "bad"; text: string } | null; onSave: () => void; label?: string }) => (
  <div className="flex items-center gap-3 pt-2"><Button variant="primary" busy={saving} onClick={onSave}>{label}</Button>{msg ? <span role={msg.tone === "bad" ? "alert" : "status"} className={`text-[13px] ${msg.tone === "bad" ? "text-red-400" : "text-emerald-400"}`}>{msg.text}</span> : null}</div>
);

export function BotDetail({ botId, initialTab }: { botId: string; initialTab?: string }) {
  const [tab, setTab] = useState<TabId>((TABS.find(([id]) => id === initialTab)?.[0] ?? "overview") as TabId);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [catalog, setCatalog] = useState<CatalogServer[]>([]);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    const d = await api<Detail>(`/api/bots/${botId}`);
    setDetail(d);
    const [c, m] = await Promise.all([api<{ servers: CatalogServer[] }>(`/api/bots/catalog?workspaceId=${d.bot.workspaceId}`), api<Meta>(`/api/bots/meta?workspaceId=${d.bot.workspaceId}&runtimeAgentId=${d.bot.runtimeAgentId}&health=1`)]);
    setCatalog(c.servers); setMeta(m);
  }, [botId]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { reload().catch((e) => setError(errorMessage(e))); }, [reload]);

  const toggle = async (action: "enable" | "disable") => {
    setBusy(true);
    try { await api(`/api/bots/${botId}/actions`, { method: "POST", body: { action } }); await reload(); setError(null); } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  };

  if (error && !detail) return <div className="mx-auto max-w-[900px] p-6"><Notice action={<Button onClick={() => { setError(null); reload().catch((e) => setError(errorMessage(e))); }}>Retry</Button>}>{error}</Notice><Link href="/bots" className="mt-3 inline-block text-[13px] text-[--primary]">Back to bots</Link></div>;
  if (!detail || !meta) return <div className="mx-auto max-w-[900px] space-y-3 p-6" aria-busy="true"><div className="h-10 w-64 animate-pulse rounded bg-[--card]" /><div className="h-64 animate-pulse rounded-lg bg-[--card]" /></div>;
  const bot = detail.bot;

  return (
    <div className="mx-auto w-full max-w-[980px] px-4 py-6 sm:px-6">
      <Link href="/bots" className="inline-flex items-center gap-1 text-[12px] text-[--muted-foreground] hover:text-[--foreground]"><ArrowLeft className="h-3.5 w-3.5" aria-hidden />Bots</Link>
      <header className="mt-2 flex flex-wrap items-center gap-3">
        <BotAvatar icon={bot.avatar} color={bot.color} size={44} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2"><h1 className="truncate text-[20px] font-semibold tracking-tight">{bot.name}</h1><Pill tone={statusTone(bot.status)}>{bot.status === "active" ? "Enabled" : bot.status === "draft" ? "Draft" : "Disabled"}</Pill></div>
          <p className="text-[13px] text-[--muted-foreground]">{bot.role}</p>
        </div>
        <Button busy={busy} variant={bot.status === "active" ? "secondary" : "primary"} onClick={() => toggle(bot.status === "active" ? "disable" : "enable")}>{bot.status === "active" ? "Disable" : "Enable"}</Button>
      </header>
      {error ? <div className="mt-3"><Notice>{error}</Notice></div> : null}

      <div role="tablist" aria-label="Bot settings" className="mt-5 flex gap-1 overflow-x-auto border-b border-[--border]">
        {TABS.map(([id, label]) => (
          <button key={id} role="tab" id={`tab-${id}`} aria-selected={tab === id} aria-controls={`panel-${id}`} onClick={() => setTab(id)} className={`-mb-px shrink-0 border-b-2 px-3 py-2 text-[13px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[--ring] ${tab === id ? "border-[--primary] text-[--foreground]" : "border-transparent text-[--muted-foreground] hover:text-[--foreground]"}`}>{label}</button>
        ))}
      </div>
      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} className="pt-5">
        {tab === "overview" ? <OverviewTab bot={bot} reload={reload} /> : null}
        {tab === "model" ? <ModelTab bot={bot} meta={meta} reload={reload} /> : null}
        {tab === "skills" ? <SkillsTab bot={bot} detail={detail} reload={reload} /> : null}
        {tab === "tools" ? <ToolsTab bot={bot} detail={detail} catalog={catalog} reload={reload} /> : null}
        {tab === "memory" ? <MemoryTab bot={bot} meta={meta} reload={reload} /> : null}
        {tab === "delegation" ? <DelegationTab bot={bot} meta={meta} reload={reload} /> : null}
        {tab === "test" ? <TestTab bot={bot} detail={detail} /> : null}
        {tab === "activity" ? <ActivityTab bot={bot} /> : null}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- overview --
function OverviewTab({ bot, reload }: { bot: Bot; reload: () => Promise<void> }) {
  const [f, setF] = useState({ name: bot.name, role: bot.role, description: bot.description, avatar: bot.avatar, tags: bot.tags.join(", "), systemPrompt: bot.systemPrompt, mission: bot.mission, responsibilities: bot.responsibilities.join("\n"), constraints: bot.constraints.join("\n"), outputPreferences: bot.outputPreferences, capabilities: bot.capabilities.join(", ") });
  const [workflow, setWorkflow] = useState<{ id: string; label: string; kind: string; note?: string }[]>(bot.workflow);
  const { saving, msg, save } = useSaver(reload);
  const csv = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);
  return (
    <div className="max-w-[720px] space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name"><TextInput value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Role"><TextInput value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })} /></Field>
      </div>
      <Field label="Description" hint="Other agents read this when choosing who to ask."><TextArea value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Icon"><Select value={f.avatar} onChange={(e) => setF({ ...f, avatar: e.target.value })}>{Object.keys(AVATARS).map((k) => <option key={k}>{k}</option>)}</Select></Field>
        <Field label="Tags" hint="Comma separated."><TextInput value={f.tags} onChange={(e) => setF({ ...f, tags: e.target.value })} /></Field>
      </div>
      <Field label="Capabilities" hint="What it can be asked to do. The registry matches jobs against these. Comma separated, lowercase."><TextInput value={f.capabilities} onChange={(e) => setF({ ...f, capabilities: e.target.value })} /></Field>
      <Field label="System prompt"><TextArea rows={7} value={f.systemPrompt} onChange={(e) => setF({ ...f, systemPrompt: e.target.value })} /></Field>
      <Field label="Mission"><TextInput value={f.mission} onChange={(e) => setF({ ...f, mission: e.target.value })} /></Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Responsibilities" hint="One per line."><TextArea rows={6} value={f.responsibilities} onChange={(e) => setF({ ...f, responsibilities: e.target.value })} /></Field>
        <Field label="Constraints" hint="One per line."><TextArea rows={6} value={f.constraints} onChange={(e) => setF({ ...f, constraints: e.target.value })} /></Field>
      </div>
      <Field label="Output preferences"><TextArea rows={2} value={f.outputPreferences} onChange={(e) => setF({ ...f, outputPreferences: e.target.value })} /></Field>
      <fieldset className="space-y-2"><legend className="text-[12px] font-medium">Working method</legend>
        <p className="text-[11px] text-[--muted-foreground]">Told to the bot as its steps. Mark a step deterministic when code or a tool should do it instead of the model.</p>
        {workflow.map((s, i) => (
          <div key={i} className="flex gap-2"><TextInput aria-label={`Step ${i + 1}`} value={s.label} onChange={(e) => setWorkflow(workflow.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} /><Select aria-label="Step type" className="w-[150px]" value={s.kind} onChange={(e) => setWorkflow(workflow.map((x, j) => (j === i ? { ...x, kind: e.target.value } : x)))}><option value="llm">Model</option><option value="tool">Tool</option><option value="deterministic">Deterministic</option></Select><Button variant="ghost" aria-label={`Remove step ${i + 1}`} onClick={() => setWorkflow(workflow.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></Button></div>
        ))}
        <Button variant="ghost" onClick={() => setWorkflow([...workflow, { id: `step${workflow.length + 1}`, label: "", kind: "llm" }])}><Plus className="h-4 w-4" aria-hidden />Add step</Button>
      </fieldset>
      <SaveBar saving={saving} msg={msg} onSave={() => save(() => api(`/api/bots/${bot.id}`, { method: "PUT", body: { name: f.name, role: f.role, description: f.description, avatar: f.avatar, tags: csv(f.tags), capabilities: csv(f.capabilities), systemPrompt: f.systemPrompt, mission: f.mission, responsibilities: lines(f.responsibilities), constraints: lines(f.constraints), outputPreferences: f.outputPreferences, workflow: workflow.filter((s) => s.label.trim()).map((s, i) => ({ ...s, id: s.id || `step${i + 1}` })) } }))} />
    </div>
  );
}

// ------------------------------------------------------------------- model --
function ModelTab({ bot, meta, reload }: { bot: Bot; meta: Meta; reload: () => Promise<void> }) {
  const mc = bot.modelConfig, lim = bot.limits;
  const [host, setHost] = useState(bot.runtimeAgentId);
  const [m, setM] = useState({ primary: mc.primary ?? "", fast: mc.fast ?? "", reasoning: mc.reasoning ?? "", vision: mc.vision ?? "", fallback: mc.fallback ?? "", effort: mc.effort ?? "", maxContextTokens: mc.maxContextTokens ?? "" });
  const [l, setL] = useState({ maxConcurrentTasks: lim.maxConcurrentTasks, maxTokensPerTask: lim.maxTokensPerTask ?? "", maxTokensPerDay: lim.maxTokensPerDay ?? "", maxCostPerDay: lim.maxCostPerDay ?? "" });
  const { saving, msg, save } = useSaver(reload);
  const choices = meta.models?.choices ?? [];
  const num = (v: string | number) => (v === "" ? null : Number(v));
  const sel = (key: keyof typeof m, label: string, hint?: string) => (
    <Field label={label} hint={hint}><Select value={m[key] as string} onChange={(e) => setM({ ...m, [key]: e.target.value })}><option value="">{key === "primary" ? `Host default (${meta.models?.inherited.model ?? "unknown"})` : "Same as primary"}</option>{choices.map((c) => <option key={c}>{c}</option>)}</Select></Field>
  );
  return (
    <div className="max-w-[720px] space-y-4">
      <Field label="Hermes host" hint="The runtime that runs this bot's sessions."><Select value={host} onChange={(e) => setHost(e.target.value)}>{meta.hosts.map((h) => <option key={h.agentId} value={h.agentId}>{h.agentId}{!h.executionVerified ? " (not verified)" : h.health && !h.health.ready ? " (not ready)" : " (ready)"}</option>)}</Select></Field>
      <div className="grid gap-3 sm:grid-cols-2">{sel("primary", "Primary model")}{sel("fast", "Fast model", "Used when a task asks for speed.")}{sel("reasoning", "Reasoning model", "Used when a task asks for deeper reasoning.")}{sel("vision", "Vision model")}</div>
      <Field label="Fallback model" hint="Used only if the requested model is refused when a session starts. The task records that it was used."><Select value={m.fallback} onChange={(e) => setM({ ...m, fallback: e.target.value })}><option value="">No fallback</option>{choices.map((c) => <option key={c}>{c}</option>)}</Select></Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Reasoning effort"><Select value={m.effort} onChange={(e) => setM({ ...m, effort: e.target.value })}><option value="">Host default</option>{["none", "low", "medium", "high", "xhigh", "max"].map((x) => <option key={x}>{x}</option>)}</Select></Field>
        <Field label="Memory context budget (tokens)" hint="Caps the memory block placed in front of the bot."><TextInput type="number" min={500} value={m.maxContextTokens} onChange={(e) => setM({ ...m, maxContextTokens: e.target.value })} /></Field>
      </div>
      {meta.models?.unsupported.length ? <p className="text-[12px] text-[--muted-foreground]">Not offered because Hermes cannot apply it per session: {meta.models.unsupported.join(", ")}.</p> : null}
      <h3 className="pt-2 text-[14px] font-medium">Limits</h3>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Tasks at once"><TextInput type="number" min={1} max={20} value={l.maxConcurrentTasks} onChange={(e) => setL({ ...l, maxConcurrentTasks: e.target.value as never })} /></Field>
        <Field label="Tokens per task" hint="Checked after the task. Hermes reports usage only at the end."><TextInput type="number" value={l.maxTokensPerTask} onChange={(e) => setL({ ...l, maxTokensPerTask: e.target.value as never })} placeholder="No limit" /></Field>
        <Field label="Tokens per day" hint="New tasks are refused once reached."><TextInput type="number" value={l.maxTokensPerDay} onChange={(e) => setL({ ...l, maxTokensPerDay: e.target.value as never })} placeholder="No limit" /></Field>
        <Field label="Cost per day (USD)" hint="Counts only models Sentinel can price."><TextInput type="number" step="0.01" value={l.maxCostPerDay} onChange={(e) => setL({ ...l, maxCostPerDay: e.target.value as never })} placeholder="No limit" /></Field>
      </div>
      <SaveBar saving={saving} msg={msg} onSave={() => save(() => api(`/api/bots/${bot.id}`, { method: "PUT", body: {
        runtimeAgentId: host,
        modelConfig: Object.fromEntries(Object.entries({ primary: m.primary, fast: m.fast, reasoning: m.reasoning, vision: m.vision, fallback: m.fallback, effort: m.effort, maxContextTokens: m.maxContextTokens }).filter(([, v]) => v !== "").map(([k, v]) => [k, k === "maxContextTokens" ? Number(v) : v])),
        limits: { maxConcurrentTasks: Number(l.maxConcurrentTasks), maxTokensPerTask: num(l.maxTokensPerTask as string), maxTokensPerDay: num(l.maxTokensPerDay as string), maxCostPerDay: num(l.maxCostPerDay as string) } } }))} />
    </div>
  );
}

// ------------------------------------------------------------------ skills --
function SkillsTab({ bot, detail, reload }: { bot: Bot; detail: Detail; reload: () => Promise<void> }) {
  const [library, setLibrary] = useState<{ id: string; name: string; description: string; version: string; status: string; requiredTools: string[]; assignedBotIds: string[] }[]>([]);
  const [review, setReview] = useState<{ skillId: string; name: string; description: string; requiredTools: string[]; body: string; sha256: string; source: Record<string, unknown> } | null>(null);
  const [src, setSrc] = useState({ url: "", content: "" });
  const [msg, setMsg] = useState<{ tone: "good" | "bad" | "info"; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const loadLib = useCallback(() => api<{ skills: typeof library }>(`/api/bots/skills?workspaceId=${bot.workspaceId}`).then((d) => setLibrary(d.skills)).catch((e) => setMsg({ tone: "bad", text: errorMessage(e) })), [bot.workspaceId]);
  useEffect(() => { void loadLib(); }, [loadLib]);
  const run = async (key: string, fn: () => Promise<unknown>, ok?: string) => { setBusy(key); setMsg(null); try { await fn(); if (ok) setMsg({ tone: "good", text: ok }); await Promise.all([reload(), loadLib()]); } catch (e) { setMsg({ tone: "bad", text: errorMessage(e) }); } finally { setBusy(null); } };
  const assigned = new Set(detail.skills.map((s) => s.id));
  return (
    <div className="max-w-[820px] space-y-6">
      {msg ? <Notice tone={msg.tone === "good" ? "good" : msg.tone === "info" ? "info" : "bad"}>{msg.text}</Notice> : null}
      <section>
        <h3 className="mb-2 text-[14px] font-medium">Installed on this bot</h3>
        {detail.skills.length ? <ul className="space-y-1">{detail.skills.map((s) => (
          <li key={s.id} className="flex items-center gap-3 rounded-md border border-[--border] px-3 py-2 text-[13px]">
            <label className="flex flex-1 items-center gap-2"><input type="checkbox" className="h-4 w-4 accent-[--primary]" checked={s.enabled} onChange={(e) => run("t" + s.id, () => api(`/api/bots/${bot.id}/skills`, { method: "PATCH", body: { skillId: s.id, enabled: e.target.checked } }))} /><span className="font-medium">{s.name}</span><span className="text-[--muted-foreground]">{s.description}</span></label>
            <Button variant="ghost" aria-label={`Remove ${s.name}`} onClick={() => run("r" + s.id, () => api(`/api/bots/${bot.id}/skills?skillId=${s.id}`, { method: "DELETE" }), "Removed.")}><Trash2 className="h-4 w-4" /></Button>
          </li>))}</ul> : <Empty title="No skills installed">Skills are instructions the bot follows. Assign an approved one below, or install one from a Hermes skill file.</Empty>}
      </section>
      <section>
        <h3 className="mb-2 text-[14px] font-medium">Workspace skills</h3>
        {library.filter((s) => !assigned.has(s.id)).length ? <ul className="space-y-1">{library.filter((s) => !assigned.has(s.id)).map((s) => (
          <li key={s.id} className="flex items-center gap-3 rounded-md border border-[--border] px-3 py-2 text-[13px]">
            <span className="min-w-0 flex-1"><span className="font-medium">{s.name}</span> <span className="text-[--muted-foreground]">v{s.version}. {s.description}</span>{s.requiredTools.length ? <span className="block text-[11px] text-[--muted-foreground]">Wants tools: {s.requiredTools.join(", ")}</span> : null}</span>
            {s.status === "active" ? <Button busy={busy === "a" + s.id} onClick={() => run("a" + s.id, async () => { const r = await api<{ unmetTools: string[] }>(`/api/bots/${bot.id}/skills`, { method: "POST", body: { skillId: s.id } }); setMsg({ tone: r.unmetTools.length ? "info" : "good", text: r.unmetTools.length ? `Assigned. It wants tools this bot has no access to: ${r.unmetTools.join(", ")}. Grant them on the Tools tab if you want it to use them.` : "Assigned." }); })}>Assign</Button>
              : <Button onClick={() => api<{ review: NonNullable<typeof review> }>(`/api/bots/skills/${s.id}`).then((d) => setReview(d.review)).catch((e) => setMsg({ tone: "bad", text: errorMessage(e) }))}>Review</Button>}
            <Pill tone={s.status === "active" ? "good" : "warn"}>{s.status === "active" ? "Approved" : "Awaiting review"}</Pill>
          </li>))}</ul> : <p className="text-[13px] text-[--muted-foreground]">Nothing else in this workspace yet.</p>}
      </section>
      <section className="space-y-2">
        <h3 className="text-[14px] font-medium">Install a skill</h3>
        <p className="max-w-[70ch] text-[12px] leading-5 text-[--muted-foreground]">Hermes SKILL.md files. Sentinel stores the text only, never runs anything from it, and nothing can be assigned until an admin has read it and approved that exact text.</p>
        <Field label="From a URL"><TextInput value={src.url} onChange={(e) => setSrc({ ...src, url: e.target.value })} placeholder="https://github.com/org/repo/blob/main/skills/hook-writer/SKILL.md" /></Field>
        <Field label="Or paste the file"><TextArea rows={4} value={src.content} onChange={(e) => setSrc({ ...src, content: e.target.value })} /></Field>
        <Button busy={busy === "propose"} disabled={!src.url.trim() && !src.content.trim()} onClick={() => run("propose", async () => { const d = await api<{ review: NonNullable<typeof review> }>("/api/bots/skills", { method: "POST", body: { workspaceId: bot.workspaceId, ...(src.url.trim() ? { url: src.url.trim() } : { content: src.content }) } }); setReview(d.review); setSrc({ url: "", content: "" }); })}>Fetch for review</Button>
      </section>
      {review ? (
        <section aria-label="Skill review" className="space-y-3 rounded-lg border border-amber-500/40 bg-[--card] p-4">
          <h3 className="text-[14px] font-medium">Review {review.name}</h3>
          <p className="text-[13px] text-[--muted-foreground]">{review.description}</p>
          {review.requiredTools.length ? <p className="text-[12px]">Asks for tools: {review.requiredTools.join(", ")}. Approving does not grant them.</p> : null}
          <p className="text-[12px] text-[--muted-foreground]">Source: {String(review.source.url ?? review.source.kind)}. SHA-256 <code>{review.sha256.slice(0, 16)}…</code></p>
          <pre className="max-h-[320px] overflow-auto whitespace-pre-wrap break-words rounded-md border border-[--border] bg-[--background] p-3 text-[12px] leading-5">{review.body}</pre>
          <div className="flex gap-2">
            <Button variant="primary" busy={busy === "approve"} onClick={() => run("approve", async () => { await api(`/api/bots/skills/${review.skillId}`, { method: "POST", body: { action: "approve", sha256: review.sha256 } }); setReview(null); }, "Approved. You can assign it now.")}>Approve this text</Button>
            <Button variant="danger" busy={busy === "reject"} onClick={() => run("reject", async () => { await api(`/api/bots/skills/${review.skillId}`, { method: "POST", body: { action: "reject" } }); setReview(null); }, "Rejected.")}>Reject</Button>
            <Button variant="ghost" onClick={() => setReview(null)}>Decide later</Button>
          </div>
        </section>
      ) : null}
    </div>
  );
}

// ------------------------------------------------------------------- tools --
function ToolsTab({ bot, detail, catalog, reload }: { bot: Bot; detail: Detail; catalog: CatalogServer[]; reload: () => Promise<void> }) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [msg, setMsg] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", url: "", authMode: "none", secretEnvVar: "", tags: "", description: "" });
  const [busy, setBusy] = useState<string | null>(null);
  const grant = (serverId: string, toolName: string) => detail.grants.find((g) => g.serverId === serverId && g.toolName === toolName)?.permission ?? "";
  const set = async (serverId: string, toolName: string, permission: string) => {
    setMsg(null);
    try { if (permission) await api(`/api/bots/${bot.id}/tools`, { method: "PUT", body: { serverId, toolName, permission } }); else await api(`/api/bots/${bot.id}/tools?serverId=${encodeURIComponent(serverId)}&toolName=${encodeURIComponent(toolName)}`, { method: "DELETE" }); await reload(); } catch (e) { setMsg(errorMessage(e)); }
  };
  const server = async (id: string, action: string) => { setBusy(id + action); setMsg(null); try { if (action === "delete") await api(`/api/bots/catalog/${id}`, { method: "DELETE" }); else await api(`/api/bots/catalog/${id}`, { method: "POST", body: { action } }); await reload(); } catch (e) { setMsg(errorMessage(e)); } finally { setBusy(null); } };
  const register = async () => {
    setBusy("register"); setMsg(null);
    try { const r = await api<{ server: { status: string; lastError: string | null; tools: number } }>("/api/bots/catalog", { method: "POST", body: { workspaceId: bot.workspaceId, name: form.name, url: form.url, description: form.description, authMode: form.authMode, secretEnvVar: form.authMode === "bearer-env" ? form.secretEnvVar : undefined, capabilityTags: form.tags.split(",").map((t) => t.trim()).filter(Boolean) } }); setMsg(r.server.status === "connected" ? `Connected. Found ${r.server.tools} tools.` : `Registered, but discovery failed: ${r.server.lastError}`); setForm({ name: "", url: "", authMode: "none", secretEnvVar: "", tags: "", description: "" }); await reload(); }
    catch (e) { setMsg(errorMessage(e)); } finally { setBusy(null); }
  };
  return (
    <div className="max-w-[820px] space-y-5">
      <p className="max-w-[70ch] text-[12px] leading-5 text-[--muted-foreground]">A bot starts with no tools. Set access per server, then override per tool. Read only covers tools the server itself marks read-only. Sentinel checks each tool call as Hermes reports it; a call outside these grants stops the task. It cannot block a call before Hermes makes it.</p>
      {msg ? <Notice tone="info">{msg}</Notice> : null}
      <ul className="space-y-2">
        {catalog.map((s) => {
          const perms = grant(s.id, "*");
          const isOpen = open[s.id];
          return (
            <li key={s.id} className="rounded-lg border border-[--border] bg-[--card]">
              <div className="flex flex-wrap items-center gap-3 px-3 py-2.5">
                <button className="flex min-w-0 flex-1 items-center gap-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[--ring]" aria-expanded={!!isOpen} onClick={() => setOpen({ ...open, [s.id]: !isOpen })}>{isOpen ? <ChevronDown className="h-4 w-4 shrink-0" aria-hidden /> : <ChevronRight className="h-4 w-4 shrink-0" aria-hidden />}<span className="truncate text-[14px] font-medium">{s.name}</span><span className="text-[12px] text-[--muted-foreground]">{s.tools.length} tools</span>{s.kind === "registered" ? <Pill tone={s.status === "connected" ? "good" : s.status === "error" ? "bad" : "neutral"}>{s.status}</Pill> : null}{!s.enabled ? <Pill tone="warn">Disabled</Pill> : null}</button>
                <Select aria-label={`Access to ${s.name}`} className="h-8 w-[160px] py-0" value={perms} onChange={(e) => set(s.id, "*", e.target.value)}><option value="">No access</option>{PERMS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select>
              </div>
              {isOpen ? (
                <div className="border-t border-[--border] px-3 py-2">
                  {s.description ? <p className="mb-2 text-[12px] text-[--muted-foreground]">{s.description}</p> : null}
                  {s.kind === "registered" ? <div className="mb-2 flex flex-wrap items-center gap-2 text-[12px]"><span className="text-[--muted-foreground]">{s.url}</span>{s.lastDiscoveredAt ? <span className="text-[--muted-foreground]">Checked {formatDistanceToNow(new Date(s.lastDiscoveredAt), { addSuffix: true })}</span> : null}{s.lastError ? <span className="text-red-400">{s.lastError}</span> : null}<Button variant="ghost" className="h-7" busy={busy === s.id + "refresh"} onClick={() => server(s.id, "refresh")}><RefreshCw className="h-3.5 w-3.5" aria-hidden />Refresh tools</Button><Button variant="ghost" className="h-7" onClick={() => server(s.id, s.enabled ? "disable" : "enable")}>{s.enabled ? "Disable server" : "Enable server"}</Button><Button variant="ghost" className="h-7 text-red-400" onClick={() => server(s.id, "delete")}>Remove</Button></div> : null}
                  {s.tools.length ? <ul className="divide-y divide-[--border]">{s.tools.map((t) => (
                    <li key={t.name} className="flex flex-wrap items-center gap-2 py-1.5 text-[13px]">
                      <code className="text-[12px]">{t.name}</code>
                      <Pill>{t.readOnly === true ? "Read only" : t.readOnly === false ? "Changes state" : "Unlabelled"}</Pill>
                      {t.risk === "high" ? <Pill tone="bad">Bypasses Sentinel</Pill> : null}
                      <span className="min-w-0 flex-1 truncate text-[12px] text-[--muted-foreground]">{t.description}</span>
                      <Select aria-label={`Access to ${t.name}`} className="h-7 w-[140px] py-0 text-[12px]" value={grant(s.id, t.name)} onChange={(e) => set(s.id, t.name, e.target.value)}><option value="">Follow server</option>{PERMS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select>
                    </li>))}</ul> : <p className="text-[13px] text-[--muted-foreground]">No tools discovered yet. Refresh to ask the server what it offers.</p>}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
      <section className="space-y-2 rounded-lg border border-[--border] p-4">
        <h3 className="text-[14px] font-medium">Connect an MCP server</h3>
        <p className="text-[12px] text-[--muted-foreground]">For example an image or video generation provider. Sentinel asks it for its tool list. Secrets stay in server environment variables; only the variable name is stored.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Name"><TextInput value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          <Field label="URL"><TextInput value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} placeholder="https://example.com/mcp" /></Field>
          <Field label="Authentication"><Select value={form.authMode} onChange={(e) => setForm({ ...form, authMode: e.target.value })}><option value="none">None</option><option value="bearer-env">Bearer token from environment variable</option></Select></Field>
          {form.authMode === "bearer-env" ? <Field label="Variable name" hint="UPPER_SNAKE_CASE, set on the Sentinel server."><TextInput value={form.secretEnvVar} onChange={(e) => setForm({ ...form, secretEnvVar: e.target.value })} placeholder="PROVIDER_API_KEY" /></Field> : null}
          <Field label="Capability tags" hint="Comma separated, e.g. image-generation, video-generation."><TextInput value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} /></Field>
          <Field label="Description"><TextInput value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
        </div>
        <Button busy={busy === "register"} disabled={!form.name.trim() || !form.url.trim()} onClick={register}>Connect and discover tools</Button>
      </section>
    </div>
  );
}

// ------------------------------------------------------------------ memory --
function MemoryTab({ bot, meta, reload }: { bot: Bot; meta: Meta; reload: () => Promise<void> }) {
  const [p, setP] = useState({ ...bot.memoryPolicy, retentionDays: bot.memoryPolicy.retentionDays ?? "" });
  const { saving, msg, save } = useSaver(reload);
  const flip = (key: "readScopes" | "writeScopes", scope: string, on: boolean) => setP({ ...p, [key]: on ? [...p[key], scope] : p[key].filter((s: string) => s !== scope) });
  const grid = (key: "readScopes" | "writeScopes", title: string, hint: string) => (
    <fieldset disabled={!p.enabled} className="disabled:opacity-50"><legend className="text-[13px] font-medium">{title}</legend><p className="mb-1 text-[11px] text-[--muted-foreground]">{hint}</p>
      <div className="flex flex-wrap gap-x-4 gap-y-1">{meta.memoryScopes.map((s) => <label key={s} className="flex items-center gap-1.5 text-[13px]"><input type="checkbox" className="h-4 w-4 accent-[--primary]" checked={(p[key] as string[]).includes(s)} onChange={(e) => flip(key, s, e.target.checked)} />{MEMORY_SCOPE_LABEL[s]}</label>)}</div></fieldset>
  );
  return (
    <div className="max-w-[720px] space-y-5">
      <p className="max-w-[70ch] text-[12px] leading-5 text-[--muted-foreground]">Bots use the one memory system Sentinel has. Reads and writes follow your existing permissions; this only narrows what this bot may touch. What it writes carries its name, even at shared scopes.</p>
      <label className="flex items-center gap-2 text-[14px] font-medium"><input type="checkbox" className="h-4 w-4 accent-[--primary]" checked={p.enabled} onChange={(e) => setP({ ...p, enabled: e.target.checked })} />Memory on</label>
      {grid("readScopes", "Can read", "Where it may retrieve from. Private means only this bot's own notes, for you.")}
      {grid("writeScopes", "Can write", "Where it may store what it learns. After each task it offers a summary to Sentinel's memory gate, which may decline it. Session scope is unavailable to bot tasks.")}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Memories per task"><TextInput type="number" min={1} max={50} value={p.maxItems} onChange={(e) => setP({ ...p, maxItems: Number(e.target.value) })} /></Field>
        <Field label="Relevance threshold (0 to 1)" hint="Fraction of the best possible ranking score. Higher shows fewer, closer matches."><TextInput type="number" min={0} max={1} step={0.05} value={p.minRelevance} onChange={(e) => setP({ ...p, minRelevance: Number(e.target.value) })} /></Field>
        <Field label="Consolidation" hint="Standard checks new memories against what Sentinel already believes."><Select value={p.consolidation} onChange={(e) => setP({ ...p, consolidation: e.target.value as "standard" | "off" })}><option value="standard">Standard</option><option value="off">Store as observed</option></Select></Field>
        <Field label="Keep for (days)" hint="Blank uses Sentinel's normal decay."><TextInput type="number" min={1} value={p.retentionDays} onChange={(e) => setP({ ...p, retentionDays: e.target.value })} placeholder="Normal decay" /></Field>
      </div>
      <SaveBar saving={saving} msg={msg} onSave={() => save(() => api(`/api/bots/${bot.id}/memory`, { method: "PUT", body: { ...p, retentionDays: p.retentionDays === "" ? null : Number(p.retentionDays) } }))} />
    </div>
  );
}

// -------------------------------------------------------------- delegation --
function DelegationTab({ bot, meta, reload }: { bot: Bot; meta: Meta; reload: () => Promise<void> }) {
  const [p, setP] = useState(bot.delegationPolicy);
  const [others, setOthers] = useState<{ id: string; name: string }[]>([]);
  const { saving, msg, save } = useSaver(reload);
  useEffect(() => { api<{ bots: { bot: { id: string; name: string } }[] }>(`/api/bots?workspaceId=${bot.workspaceId}`).then((d) => setOthers(d.bots.map((b) => b.bot).filter((b) => b.id !== bot.id))).catch(() => undefined); }, [bot.id, bot.workspaceId]);
  const flip = (key: "allowedCallers" | "allowedChildBots", value: string, on: boolean) => setP({ ...p, [key]: on ? [...p[key], value] : p[key].filter((v: string) => v !== value) });
  const callers = [["user", "People in this workspace (Test and manual runs)"], ...meta.callers.agents.map((a) => [a, `Agent ${a.replace("agent:", "")}`]), ...meta.callers.clients.map((c) => [c.key, `Connected client: ${c.name}`])];
  return (
    <div className="max-w-[720px] space-y-5">
      <fieldset><legend className="text-[13px] font-medium">Who can hand this bot work</legend><p className="mb-2 text-[11px] text-[--muted-foreground]">Nobody outside this list can see or use it. Agents connect through a client, so pick the client their Sentinel connection uses.</p>
        <ul className="space-y-1">{callers.map(([value, label]) => <li key={value}><label className="flex items-center gap-2 text-[13px]"><input type="checkbox" className="h-4 w-4 accent-[--primary]" checked={p.allowedCallers.includes(value)} onChange={(e) => flip("allowedCallers", value, e.target.checked)} />{label}</label></li>)}</ul>
      </fieldset>
      <fieldset><legend className="text-[13px] font-medium">Can it hand work to other bots</legend>
        <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" className="h-4 w-4 accent-[--primary]" checked={p.canDelegate} onChange={(e) => setP({ ...p, canDelegate: e.target.checked })} />Allow this bot to delegate</label>
        <fieldset disabled={!p.canDelegate} className="mt-2 space-y-1 disabled:opacity-50"><legend className="text-[11px] text-[--muted-foreground]">Only to these bots. Each must also list this bot as a caller.</legend>
          {others.length ? others.map((o) => <label key={o.id} className="flex items-center gap-2 text-[13px]"><input type="checkbox" className="h-4 w-4 accent-[--primary]" checked={p.allowedChildBots.includes(o.id)} onChange={(e) => flip("allowedChildBots", o.id, e.target.checked)} />{o.name}</label>) : <p className="text-[13px] text-[--muted-foreground]">No other bots yet.</p>}
          <Field label="Chain depth"><Select value={p.maxDepth} onChange={(e) => setP({ ...p, maxDepth: Number(e.target.value) })} className="w-[120px]">{[1, 2, 3].map((n) => <option key={n}>{n}</option>)}</Select></Field>
        </fieldset>
      </fieldset>
      <p className="text-[12px] text-[--muted-foreground]">Bots can never create or change bots. That stays an admin action on this screen.</p>
      <SaveBar saving={saving} msg={msg} onSave={() => save(() => api(`/api/bots/${bot.id}`, { method: "PUT", body: { delegationPolicy: p } }))} />
    </div>
  );
}

// -------------------------------------------------------------------- test --
function usePolledTask(taskId: string | null) {
  const [task, setTask] = useState<TaskData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refresh = useCallback(async () => {
    if (!taskId) return;
    try { const d = await api<{ task: TaskData }>(`/api/bots/tasks/${taskId}`); setTask(d.task); setError(null); return d.task; } catch (e) { setError(errorMessage(e)); }
  }, [taskId]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTask(null);
    if (!taskId) return;
    let stopped = false;
    const tick = async () => { const t = await refresh(); if (!stopped && (!t || !TERMINAL.includes(t.status))) timer.current = setTimeout(tick, 1500); };
    void tick();
    return () => { stopped = true; if (timer.current) clearTimeout(timer.current); };
  }, [taskId, refresh]);
  return { task, error, refresh };
}

function TestTab({ bot, detail }: { bot: Bot; detail: Detail }) {
  const [prompt, setPrompt] = useState("Create three concepts for a 15-second ICF construction ad.");
  const [role, setRole] = useState("primary");
  const [taskId, setTaskId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const { task, error: pollError, refresh } = usePolledTask(taskId);
  const start = async () => {
    setStarting(true); setError(null);
    try { const d = await api<{ task: { id: string } }>(`/api/bots/${bot.id}/test`, { method: "POST", body: { prompt, modelRole: role } }); setTaskId(d.task.id); } catch (e) { setError(errorMessage(e)); } finally { setStarting(false); }
  };
  return (
    <div className="max-w-[820px] space-y-4">
      <p className="max-w-[70ch] text-[12px] leading-5 text-[--muted-foreground]">Runs the bot for real, on {bot.runtimeAgentId}, with its actual tools and memory. It goes through the same queue as delegated work, so it waits for a worker and can be cancelled. {detail.grants.length === 0 ? "This bot has no tool grants, so any tool call will stop it." : ""}</p>
      <Field label="Prompt"><TextArea rows={3} value={prompt} onChange={(e) => setPrompt(e.target.value)} /></Field>
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Model role"><Select value={role} onChange={(e) => setRole(e.target.value)} className="w-[160px]">{["primary", "fast", "reasoning", "vision"].map((r) => <option key={r}>{r}</option>)}</Select></Field>
        <Button variant="primary" busy={starting} disabled={!prompt.trim()} onClick={start}>Run test</Button>
      </div>
      {error ? <Notice>{error}</Notice> : null}
      {pollError ? <Notice tone="warn">Could not read the task: {pollError}</Notice> : null}
      {taskId && !task && !pollError ? <p className="text-[13px] text-[--muted-foreground]" aria-busy="true">Waiting for the task…</p> : null}
      {task ? <><TaskView task={task} onChanged={() => void refresh()} />{task.status === "QUEUED" ? <p className="text-[12px] text-[--muted-foreground]">Queued. It starts when the orchestration worker picks it up.</p> : null}</> : null}
    </div>
  );
}

// ---------------------------------------------------------------- activity --
function ActivityTab({ bot }: { bot: Bot }) {
  const [data, setData] = useState<{ tasks: { id: string; status: string; mode: string; origin: string | null; task: string | null; createdAt: string; model: string | null; totalTokens: number | null; costUsd: number | null; latencyMs: number | null; error: string | null }[]; usageToday: { tokens: number; costUsd: number; pricedTasks: number; tasks: number } } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const load = useCallback(() => api<NonNullable<typeof data>>(`/api/bots/${bot.id}/tasks?limit=30`).then((d) => { setData(d); setError(null); }).catch((e) => setError(errorMessage(e))), [bot.id]);
  useEffect(() => { void load(); const t = setInterval(() => void load(), 5000); return () => clearInterval(t); }, [load]);
  const { task, refresh } = usePolledTask(selected);
  if (error && !data) return <Notice action={<Button onClick={() => void load()}>Retry</Button>}>{error}</Notice>;
  if (!data) return <p className="text-[13px] text-[--muted-foreground]" aria-busy="true">Loading activity…</p>;
  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,340px)_1fr]">
      <div className="space-y-3">
        <p className="text-[13px]">Today: {data.usageToday.tasks} task(s), {data.usageToday.tokens.toLocaleString()} tokens{data.usageToday.pricedTasks ? `, $${data.usageToday.costUsd.toFixed(2)}` : ", cost not priced"}.</p>
        {data.tasks.length === 0 ? <Empty title="No tasks yet">Run a test, or wait for an agent to delegate something.</Empty> : (
          <ul className="space-y-1">{data.tasks.map((t) => (
            <li key={t.id}><button onClick={() => setSelected(t.id)} aria-current={selected === t.id} className={`w-full rounded-md border px-3 py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[--ring] ${selected === t.id ? "border-[--primary]/60 bg-[--accent]" : "border-[--border] hover:bg-[--accent]"}`}>
              <span className="flex items-center gap-2"><Pill tone={statusTone(t.status)}>{t.status}</Pill>{t.mode === "test" ? <Pill>Test</Pill> : null}<span className="text-[11px] text-[--muted-foreground]">{formatDistanceToNow(new Date(t.createdAt), { addSuffix: true })}</span></span>
              <span className="mt-1 line-clamp-2 block text-[13px]">{t.task}</span>
              <span className="mt-0.5 block text-[11px] text-[--muted-foreground]">{t.origin ?? "unknown caller"}{t.model ? `, ${t.model}` : ""}{t.totalTokens ? `, ${t.totalTokens.toLocaleString()} tokens` : ""}{t.latencyMs ? `, ${(t.latencyMs / 1000).toFixed(1)}s` : ""}</span>
            </button></li>))}</ul>)}
      </div>
      <div className="min-w-0">{task ? <TaskView task={task} onChanged={() => { void refresh(); void load(); }} /> : <Empty title="Pick a task">Its tools, memory use, model, tokens and events appear here.</Empty>}</div>
    </div>
  );
}
