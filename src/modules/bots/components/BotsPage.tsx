"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { Copy, Plus, Power, Trash2, FlaskConical, Activity as ActivityIcon, Pencil } from "lucide-react";
import { BotAvatar, Button, Empty, Notice, Pill, Select, statusTone } from "./bits";
import { api, errorMessage, MEMORY_SCOPE_LABEL } from "./client";
import { CreateBotWizard } from "./CreateBotWizard";

interface Summary {
  bot: { id: string; name: string; role: string; description: string; avatar: string; color: string; status: string; modelConfig: { primary?: string }; runtimeAgentId: string; tags: string[] };
  host: { agentId: string; enabled: boolean; executionVerified: boolean };
  skills: { id: string; name: string; enabled: boolean }[];
  servers: { id: string; name: string; tools: number | "all" }[];
  memory: { enabled: boolean; read: string[]; write: string[] };
  lastActiveAt: string | null;
  currentTask: { id: string; task: string; status: string } | null;
  usageToday: { tokens: number; costUsd: number; pricedTasks: number; tasks: number };
}

export function BotsPage({ workspaces }: { workspaces: { id: string; name: string }[] }) {
  const [workspaceId, setWorkspaceId] = useState(workspaces[0]?.id ?? "");
  const [bots, setBots] = useState<Summary[] | null>(null);
  const [health, setHealth] = useState<Record<string, { ready: boolean } | null>>({});
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!workspaceId) return;
    setError(null);
    try {
      const data = await api<{ bots: Summary[] }>(`/api/bots?workspaceId=${workspaceId}`);
      setBots(data.bots);
      const meta = await api<{ hosts: { agentId: string; health: { ready: boolean } | null }[] }>(`/api/bots/meta?workspaceId=${workspaceId}&health=1`).catch(() => null);
      if (meta) setHealth(Object.fromEntries(meta.hosts.map((host) => [host.agentId, host.health])));
    } catch (e) { setBots(null); setError(errorMessage(e)); }
  }, [workspaceId]);

  // Fetch on mount and on workspace change.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);

  const act = async (id: string, action: "enable" | "disable" | "duplicate") => {
    setBusy(id + action); setNotice(null);
    try { await api(`/api/bots/${id}/actions`, { method: "POST", body: { action } }); setNotice(action === "duplicate" ? "Duplicated as a draft. Callers reset to you only." : action === "enable" ? "Enabled. Agents can now find it." : "Disabled. Running tasks continue; no new ones start."); await load(); }
    catch (e) { setNotice(errorMessage(e)); } finally { setBusy(null); }
  };
  const remove = async (id: string) => {
    setBusy(id + "delete");
    try { await api(`/api/bots/${id}`, { method: "DELETE" }); setConfirmDelete(null); setNotice("Deleted."); await load(); }
    catch (e) { setNotice(errorMessage(e)); setConfirmDelete(null); } finally { setBusy(null); }
  };

  return (
    <div className="mx-auto w-full max-w-[1180px] px-4 py-6 sm:px-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight">Bots</h1>
          <p className="mt-1 max-w-[60ch] text-[13px] leading-5 text-[--muted-foreground]">Specialised Hermes agents with their own instructions, tools and memory. Other agents find them here and hand them work.</p>
        </div>
        <div className="flex items-center gap-2">
          {workspaces.length > 1 ? <Select aria-label="Workspace" value={workspaceId} onChange={(e) => setWorkspaceId(e.target.value)} className="h-8 w-[180px] py-0">{workspaces.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</Select> : null}
          <Button variant="primary" onClick={() => setCreating(true)} disabled={!workspaceId}><Plus className="h-4 w-4" aria-hidden />Create bot</Button>
        </div>
      </header>

      <div className="mt-4 space-y-3" aria-live="polite">
        {notice ? <Notice tone="info" action={<button className="text-[12px] underline" onClick={() => setNotice(null)}>Dismiss</button>}>{notice}</Notice> : null}
        {error ? <Notice action={<Button onClick={() => void load()}>Retry</Button>}>Could not load bots: {error}</Notice> : null}
      </div>

      {!workspaceId ? <div className="mt-6"><Empty title="No workspace">You are not a member of any workspace, so there is nowhere to create a bot.</Empty></div> : null}
      {workspaceId && bots === null && !error ? (
        <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true" aria-label="Loading bots">
          {[0, 1, 2].map((i) => <div key={i} className="h-[230px] animate-pulse rounded-lg border border-[--border] bg-[--card]" />)}
        </div>
      ) : null}
      {bots && bots.length === 0 ? <div className="mt-6"><Empty title="No bots in this workspace yet" action={<Button variant="primary" onClick={() => setCreating(true)}>Create the first bot</Button>}>Describe what you want one to do, or start from a template. A new bot can use no tools until you grant them.</Empty></div> : null}

      {bots?.length ? (
        <ul className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {bots.map((s) => {
            const host = health[s.host.agentId];
            const hostLabel = !s.host.enabled ? "Host disabled" : !s.host.executionVerified ? "Host not verified" : host === undefined ? "Checking host" : host?.ready ? "Hermes ready" : "Hermes not ready";
            const hostTone = hostLabel === "Hermes ready" ? "good" : hostLabel === "Checking host" ? "neutral" : "warn";
            return (
              <li key={s.bot.id} className="group relative flex flex-col rounded-lg border border-[--border] bg-[--card] p-4 transition-colors hover:border-[--primary]/40 focus-within:border-[--primary]/40">
                <div className="flex items-start gap-3">
                  <BotAvatar icon={s.bot.avatar} color={s.bot.color} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <h2 className="truncate text-[15px] font-semibold"><Link href={`/bots/${s.bot.id}`} className="after:absolute after:inset-0 focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-[--ring]">{s.bot.name}</Link></h2>
                      <Pill tone={statusTone(s.bot.status)}>{s.bot.status === "active" ? "Enabled" : s.bot.status === "draft" ? "Draft" : "Disabled"}</Pill>
                    </div>
                    <p className="text-[12px] text-[--muted-foreground]">{s.bot.role}</p>
                  </div>
                </div>
                <p className="mt-3 line-clamp-2 min-h-[40px] text-[13px] leading-5 text-[--muted-foreground]">{s.bot.description || "No description yet."}</p>
                <dl className="mt-3 space-y-1 text-[12px]">
                  <div className="flex justify-between gap-3"><dt className="text-[--muted-foreground]">Model</dt><dd className="truncate">{s.bot.modelConfig.primary ?? "Host default"}</dd></div>
                  <div className="flex justify-between gap-3"><dt className="text-[--muted-foreground]">Host</dt><dd><Pill tone={hostTone}>{hostLabel}</Pill></dd></div>
                  <div className="flex justify-between gap-3"><dt className="text-[--muted-foreground]">Skills</dt><dd className="truncate">{s.skills.filter((k) => k.enabled).map((k) => k.name).join(", ") || "None"}</dd></div>
                  <div className="flex justify-between gap-3"><dt className="text-[--muted-foreground]">Tools</dt><dd className="truncate">{s.servers.map((v) => `${v.name} (${v.tools === "all" ? "all" : v.tools})`).join(", ") || "None granted"}</dd></div>
                  <div className="flex justify-between gap-3"><dt className="text-[--muted-foreground]">Memory</dt><dd className="truncate">{s.memory.enabled ? `Reads ${s.memory.read.map((x) => MEMORY_SCOPE_LABEL[x] ?? x).join(", ") || "nothing"}` : "Off"}</dd></div>
                  <div className="flex justify-between gap-3"><dt className="text-[--muted-foreground]">Last active</dt><dd>{s.lastActiveAt ? formatDistanceToNow(new Date(s.lastActiveAt), { addSuffix: true }) : "Never"}</dd></div>
                  <div className="flex justify-between gap-3"><dt className="text-[--muted-foreground]">Today</dt><dd>{s.usageToday.tasks ? `${s.usageToday.tokens.toLocaleString()} tokens${s.usageToday.pricedTasks ? `, $${s.usageToday.costUsd.toFixed(2)}` : ", not priced"}` : "No tasks"}</dd></div>
                </dl>
                {s.currentTask ? <p className="mt-3 truncate rounded-md bg-sky-500/10 px-2 py-1 text-[12px] text-sky-300">Working: {s.currentTask.task}</p> : null}
                <div className="relative z-10 mt-3 flex flex-wrap gap-1 opacity-100 transition-opacity [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-focus-within:opacity-100 [@media(hover:hover)]:group-hover:opacity-100">
                  <Link href={`/bots/${s.bot.id}?tab=test`} className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-[12px] text-[--muted-foreground] hover:bg-[--accent] hover:text-[--foreground] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[--ring]"><FlaskConical className="h-3.5 w-3.5" aria-hidden />Test</Link>
                  <Link href={`/bots/${s.bot.id}`} className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-[12px] text-[--muted-foreground] hover:bg-[--accent] hover:text-[--foreground] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[--ring]"><Pencil className="h-3.5 w-3.5" aria-hidden />Edit</Link>
                  <Link href={`/bots/${s.bot.id}?tab=activity`} className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-[12px] text-[--muted-foreground] hover:bg-[--accent] hover:text-[--foreground] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[--ring]"><ActivityIcon className="h-3.5 w-3.5" aria-hidden />Activity</Link>
                  <button className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-[12px] text-[--muted-foreground] hover:bg-[--accent] hover:text-[--foreground] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[--ring]" disabled={busy === s.bot.id + "duplicate"} onClick={() => act(s.bot.id, "duplicate")}><Copy className="h-3.5 w-3.5" aria-hidden />Duplicate</button>
                  <button className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-[12px] text-[--muted-foreground] hover:bg-[--accent] hover:text-[--foreground] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[--ring]" disabled={busy === s.bot.id + "enable" || busy === s.bot.id + "disable"} onClick={() => act(s.bot.id, s.bot.status === "active" ? "disable" : "enable")}><Power className="h-3.5 w-3.5" aria-hidden />{s.bot.status === "active" ? "Disable" : "Enable"}</button>
                  {confirmDelete === s.bot.id ? (
                    <span className="inline-flex items-center gap-1"><Button variant="danger" className="h-7 px-2 text-[12px]" busy={busy === s.bot.id + "delete"} onClick={() => remove(s.bot.id)}>Delete {s.bot.name}</Button><Button variant="ghost" className="h-7 px-2 text-[12px]" onClick={() => setConfirmDelete(null)}>Keep</Button></span>
                  ) : (
                    <button className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-[12px] text-red-400 hover:bg-red-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[--ring]" onClick={() => setConfirmDelete(s.bot.id)}><Trash2 className="h-3.5 w-3.5" aria-hidden />Delete</button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}

      {creating ? <CreateBotWizard workspaceId={workspaceId} onClose={() => setCreating(false)} onCreated={() => void load()} /> : null}
    </div>
  );
}
