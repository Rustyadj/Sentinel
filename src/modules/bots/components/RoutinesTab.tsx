"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Empty, Field, Notice, Pill, Select, TextArea, TextInput } from "./bits";
import { api, errorMessage } from "./client";
import { TaskView, type TaskData } from "./TaskView";

interface Run {
  id: string; revision: number; skillVersionId: string; trigger: string; status: string;
  createdAt: string; scheduledFor: string | null; startedAt: string | null; completedAt: string | null;
  currentTaskId: string | null; resultSummary: string | null; errorSummary: string | null;
}
interface Routine {
  id: string; name: string; description: string; status: string; revision: number;
  routineTask: string; routineContext: string; intervalMinutes: number | null; nextRunAt: string | null;
  digest: string; reviewedAt: string | null; reviewedDigest: string | null; routineRuns: Run[];
  skill: { id: string; name: string; version: number; body: string; bodySha256: string; reviewedAt: string };
}
interface Skill { id: string; name: string; status: string }
interface Form { name: string; description: string; task: string; context: string; skillId: string; interval: string }
const blank: Form = { name: "", description: "", task: "", context: "", skillId: "", interval: "" };
const date = (v: string | null) => v ? new Date(v).toLocaleString() : "—";
const inFlight = (status: string) => ["pending", "queued", "running", "waiting", "cancelling"].includes(status);

export function RoutinesTab({ botId, workspaceId }: { botId: string; workspaceId: string }) {
  const [routines, setRoutines] = useState<Routine[] | null>(null);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingRevision, setEditingRevision] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [viewingRunId, setViewingRunId] = useState<string | null>(null);
  const [task, setTask] = useState<TaskData | null>(null);
  const requestKeys = useRef(new Map<string, string>());
  const base = `/api/bots/${botId}/routines`;
  const selected = routines?.find((r) => r.id === selectedId);
  const taskId = selected?.routineRuns.find((run) => run.id === viewingRunId)?.currentTaskId ?? null;

  const load = useCallback(async () => {
    const result = await api<{ routines: Routine[] }>(base);
    setRoutines(result.routines);
  }, [base]);
  const loadTask = async () => {
    if (!taskId) return;
    const result = await api<{ task: TaskData }>(`/api/bots/tasks/${taskId}`);
    setTask(result.task);
  };
  useEffect(() => {
    let cancelled = false;
    Promise.all([api<{ routines: Routine[] }>(base), api<{ skills: Skill[] }>(`/api/bots/skills?workspaceId=${workspaceId}`)])
      .then(([r, s]) => { if (!cancelled) { setRoutines(r.routines); setSkills(s.skills.filter((skill) => skill.status === "active")); } })
      .catch((e) => { if (!cancelled) setError(errorMessage(e)); });
    const timer = setInterval(() => { void load().catch((e) => setError(errorMessage(e))); }, 5000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [base, workspaceId, load]);
  useEffect(() => {
    if (!taskId) return;
    let cancelled = false;
    api<{ task: TaskData }>(`/api/bots/tasks/${taskId}`).then((result) => { if (!cancelled) setTask(result.task); }).catch((e) => { if (!cancelled) setError(errorMessage(e)); });
    const timer = setInterval(() => {
      api<{ task: TaskData }>(`/api/bots/tasks/${taskId}`).then((result) => { if (!cancelled) setTask(result.task); }).catch((e) => { if (!cancelled) setError(errorMessage(e)); });
    }, 5000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [taskId]);

  const act = async (routine: Routine, action: string) => {
    setBusy(true); setError(null); setMessage(null);
    const key = `${routine.id}:${action}`;
    if (!requestKeys.current.has(key)) requestKeys.current.set(key, crypto.randomUUID());
    try {
      const result = await api<{ run?: Run }>(`${base}/${routine.id}`, { method: "POST", body: { action, digest: routine.digest, idempotencyKey: requestKeys.current.get(key) } });
      requestKeys.current.delete(key);
      await load();
      if (result.run) { setTask(null); setViewingRunId(result.run.id); }
      setMessage(result.run?.status === "skipped" ? "Run skipped because a previous run is still in flight." : result.run?.status === "failed" ? `Run failed: ${result.run.errorSummary}` : action === "test" ? "Test requested. It uses normal bot delegation permissions and can perform real actions." : action === "run" ? "Run requested." : "Routine updated.");
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  };
  const edit = (routine: Routine) => {
    setEditingId(routine.id); setEditingRevision(routine.revision);
    setForm({ name: routine.name, description: routine.description ?? "", task: routine.routineTask, context: routine.routineContext ?? "", skillId: routine.skill.id, interval: routine.intervalMinutes?.toString() ?? "" });
  };
  const save = async () => {
    if (!form) return;
    setBusy(true); setError(null); setMessage(null);
    try {
      const { interval, ...input } = form;
      const result = await api<{ routine: Routine }>(editingId ? `${base}/${editingId}` : base, { method: editingId ? "PUT" : "POST", body: { ...input, intervalMinutes: interval ? Number(interval) : null, ...(editingId ? { revision: editingRevision } : {}) } });
      await load(); setSelectedId(result.routine.id); setForm(null);
      setMessage("Proposal saved. Review its pinned skill and task, approve, then test before enabling.");
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  };

  return <div className="space-y-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <p className="max-w-[65ch] text-[13px] leading-5 text-(--muted-foreground)">Routines pair a reviewed skill version with a task. Review and test each revision before enabling. A routine runs one task at a time, including while it waits for approval.</p>
      <Button onClick={() => { setEditingId(null); setEditingRevision(null); setForm({ ...blank, skillId: skills[0]?.id ?? "" }); }}>New routine</Button>
    </div>
    {error ? <Notice action={<Button onClick={() => { setError(null); void load().catch((e) => setError(errorMessage(e))); }}>Refresh</Button>}>{error}</Notice> : null}
    {message ? <Notice tone="info">{message}</Notice> : null}
    {form ? <form className="space-y-3 rounded-lg border border-(--border) bg-(--card) p-4" onSubmit={(e) => { e.preventDefault(); void save(); }}>
      <h2 className="text-[15px] font-medium">{editingId ? "Edit routine" : "Propose routine"}</h2>
      <Field label="Routine name"><TextInput required maxLength={120} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
      <Field label="Description"><TextInput maxLength={1000} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
      <Field label="Approved skill" hint="The approved version is pinned when you save. Approve new skills in the Skills tab."><Select required value={form.skillId} onChange={(e) => setForm({ ...form, skillId: e.target.value })}><option value="">Choose an approved skill</option>{skills.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field>
      <Field label="Routine task"><TextArea required rows={4} maxLength={6000} value={form.task} onChange={(e) => setForm({ ...form, task: e.target.value })} /></Field>
      <Field label="Context"><TextArea rows={3} maxLength={20000} value={form.context} onChange={(e) => setForm({ ...form, context: e.target.value })} /></Field>
      <Field label="Repeat every (minutes)" hint="Leave empty for manual runs. Minimum 5 minutes. Missed intervals are combined into one run."><TextInput type="number" min={5} max={525600} step={1} value={form.interval} onChange={(e) => setForm({ ...form, interval: e.target.value })} /></Field>
      <p className="text-[12px] text-(--muted-foreground)">Saving an edit pauses the routine and requires another review and successful test.</p>
      <div className="flex gap-2"><Button type="submit" variant="primary" busy={busy}>Save proposal</Button><Button type="button" disabled={busy} onClick={() => setForm(null)}>Cancel edit</Button></div>
    </form> : null}
    {!routines ? <p aria-busy="true">Loading routines…</p> : routines.length === 0 ? <Empty title="No routines yet">Create a routine from an approved skill to get started.</Empty> : <div className="flex flex-wrap gap-2" aria-label="Routines">{routines.map((routine) => <Button key={routine.id} variant={selectedId === routine.id ? "primary" : "secondary"} onClick={() => { setSelectedId(routine.id); setViewingRunId(null); setTask(null); }}>{routine.name} · {routine.status}</Button>)}</div>}
    {selected ? <section aria-label="Routine details" className="space-y-4">
      <header className="flex flex-wrap items-center gap-2"><h2 className="text-[16px] font-medium">{selected.name}</h2><Pill>{selected.status}</Pill><span className="text-[12px] text-(--muted-foreground)">Revision {selected.revision}</span></header>
      <p className="text-[13px]">{selected.description}</p>
      <dl className="grid gap-2 text-[13px] sm:grid-cols-2">
        <div><dt className="text-(--muted-foreground)">Schedule</dt><dd>{selected.intervalMinutes ? `Every ${selected.intervalMinutes} minutes` : "Manual only"}</dd></div>
        <div><dt className="text-(--muted-foreground)">Next due</dt><dd>{date(selected.nextRunAt)}</dd></div>
        <div><dt className="text-(--muted-foreground)">Pinned skill</dt><dd>{selected.skill.name} · version {selected.skill.version}</dd></div>
        <div><dt className="text-(--muted-foreground)">Routine reviewed</dt><dd>{date(selected.reviewedAt)}</dd></div>
      </dl>
      <div className="rounded-lg border border-(--border) p-3 text-[13px]"><h3 className="mb-2 font-medium">Task to review</h3><p className="whitespace-pre-wrap break-words">{selected.routineTask}</p>{selected.routineContext ? <><h3 className="mb-2 mt-3 font-medium">Context</h3><p className="whitespace-pre-wrap break-words">{selected.routineContext}</p></> : null}</div>
      <details className="rounded-lg border border-(--border) p-3 text-[13px]"><summary className="cursor-pointer font-medium">Read pinned skill instructions</summary><pre className="mt-3 max-h-96 overflow-y-auto whitespace-pre-wrap break-words font-sans">{selected.skill.body}</pre><p className="mt-3 break-all text-[11px] text-(--muted-foreground)">Content digest: {selected.skill.bodySha256} · Skill reviewed {date(selected.skill.reviewedAt)}</p></details>
      <div className="flex flex-wrap gap-2">
        <Button disabled={busy} onClick={() => edit(selected)}>Edit</Button>
        <Button disabled={busy || selected.reviewedDigest === selected.digest} onClick={() => void act(selected, "review")}>Approve reviewed revision</Button>
        <Button disabled={busy || !selected.reviewedAt || selected.routineRuns.some((r) => inFlight(r.status))} onClick={() => void act(selected, "test")}>Test routine</Button>
        <Button variant="primary" disabled={busy || !selected.reviewedAt || selected.status === "enabled"} onClick={() => void act(selected, "enable")}>Enable</Button>
        <Button disabled={busy || selected.status === "paused"} onClick={() => void act(selected, "pause")}>Pause</Button>
        <Button disabled={busy || !["enabled", "paused"].includes(selected.status) || !selected.reviewedAt || selected.routineRuns.some((r) => inFlight(r.status))} onClick={() => void act(selected, "run")}>Run now</Button>
        <Button variant="danger" disabled={busy || selected.status === "rejected"} onClick={() => void act(selected, "reject")}>Reject</Button>
      </div>
      <p className="text-[12px] text-(--muted-foreground)">Tests perform real work with normal bot permissions. Pausing stops future scheduled runs; use Cancel task below to stop work already admitted.</p>
      <h3 className="text-[14px] font-medium">Recent runs</h3>
      {selected.routineRuns.length ? <ul className="divide-y divide-(--border) rounded-lg border border-(--border)">{selected.routineRuns.map((run) => <li key={run.id} className="space-y-1 p-3 text-[12px]">
        <div className="flex flex-wrap items-center gap-2"><Pill tone={run.status === "succeeded" ? "good" : run.status === "failed" ? "bad" : "neutral"}>{run.status}</Pill><span>{run.trigger} · revision {run.revision} · {date(run.createdAt)}</span>{run.currentTaskId ? <Button className="ml-auto" onClick={() => { setTask(null); setViewingRunId(run.id); }}>View task</Button> : null}</div>
        <p className="text-(--muted-foreground)">Due: {date(run.scheduledFor)} · Started: {date(run.startedAt)} · Finished: {date(run.completedAt)}</p>
        <p className="break-all text-(--muted-foreground)">Skill version: {run.skillVersionId}</p>
        {run.errorSummary ? <p className="whitespace-pre-wrap break-words text-red-400">{run.errorSummary}</p> : run.resultSummary ? <p className="whitespace-pre-wrap break-words">{run.resultSummary}</p> : null}
      </li>)}</ul> : <Empty title="No runs yet">Approve this revision, then test it.</Empty>}
      {taskId ? <div className="rounded-lg border border-(--border) p-4">{task?.id === taskId ? <TaskView task={task} onChanged={() => { void loadTask().catch((e) => setError(errorMessage(e))); void load().catch((e) => setError(errorMessage(e))); }} /> : <p aria-busy="true">Loading task…</p>}</div> : null}
    </section> : null}
  </div>;
}
