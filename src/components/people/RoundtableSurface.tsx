"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ArrowUp, Plus, Square, Trash2 } from "lucide-react";
import { AppShell } from "@/components/shell/AppShell";
import { EmptyState } from "@/components/shell/primitives";
import { useMe } from "@/lib/people/useMe";
import { useAgentStore } from "@/store/useAgentStore";
import { cn } from "@/lib/utils";
import { Field, Initial, Notice, PrimaryButton, QuietButton, fieldClass, readError } from "./ui";

interface Seat { id: string; name: string }
interface Summary {
  id: string; title: string; status: string; agentIds: string[]; rounds: number; createdAt: string;
  projectName: string | null; startedBy: string; mine: boolean; turns: number;
}
interface Turn {
  id: string; sequence: number; round: number; kind: "opening" | "response" | "synthesis" | "human"; status: "speaking" | "done" | "failed";
  error: string | null; agentId: string | null; content: string; position: string | null; speaker: string; mine: boolean;
}
interface Discussion {
  id: string; title: string; topic: string; status: "running" | "completed" | "failed" | "cancelled"; error: string | null;
  rounds: number; projectName: string | null; startedBy: string; mine: boolean; agents: Seat[]; turns: Turn[];
}
interface Listing { agents: Array<Seat & { kind: string }>; limits: { minAgents: number; maxAgents: number; maxRounds: number }; discussions: Summary[] }

const POLL_MS = 1_500;
const STATUS_COPY: Record<string, string> = { running: "In progress", completed: "Finished", failed: "Stopped early", cancelled: "Stopped" };

/**
 * Agents discussing a question with each other. The list and the form on the
 * left; on the right the discussion itself, written as it happens.
 */
export function RoundtableSurface() {
  const router = useRouter();
  const params = useSearchParams();
  const activeId = params.get("id");
  const me = useMe();
  const palette = useAgentStore((state) => state.agents);
  const colorOf = useCallback((agentId: string | null) => palette.find((a) => a.id === agentId)?.color ?? "var(--entity-agent)", [palette]);

  const [listing, setListing] = useState<Listing | null>(null);
  const [discussion, setDiscussion] = useState<Discussion | null>(null);
  const [composing, setComposing] = useState(false);
  const [error, setError] = useState("");

  const loadList = useCallback(async () => {
    try {
      const res = await fetch("/api/discussions", { cache: "no-store" });
      if (!res.ok) throw new Error(await readError(res, "Roundtables could not be loaded."));
      setListing((await res.json()) as Listing);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Roundtables could not be loaded.");
    }
  }, []);
  useEffect(() => {
    // Loading on mount: every setState in here runs after an await, never during the effect itself.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadList();
  }, [loadList]);

  // Follow the open discussion while agents are speaking; stop asking once it has settled.
  useEffect(() => {
    if (!activeId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const read = async () => {
      try {
        const res = await fetch(`/api/discussions/${activeId}`, { cache: "no-store" });
        if (cancelled) return;
        if (!res.ok) { setError(await readError(res, "That roundtable could not be opened.")); return; }
        const next = (await res.json()) as Discussion;
        if (cancelled) return;
        setDiscussion(next);
        if (next.status === "running") timer = setTimeout(() => void read(), POLL_MS);
        else void loadList();
      } catch {
        if (!cancelled) timer = setTimeout(() => void read(), POLL_MS * 2);
      }
    };
    void read();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [activeId, loadList]);

  const open = (id: string | null) => { setComposing(false); setError(""); router.replace(id ? `/roundtable?id=${id}` : "/roundtable"); };
  const refresh = useCallback(async () => {
    if (!activeId) return;
    const res = await fetch(`/api/discussions/${activeId}`, { cache: "no-store" });
    if (res.ok) setDiscussion((await res.json()) as Discussion);
  }, [activeId]);

  // The discussion on screen is the one the address names; a previous one is never shown under a new id.
  const shown = activeId && discussion?.id === activeId ? discussion : null;
  const showForm = composing || (!activeId && listing !== null);

  return (
    <AppShell title="Roundtable">
      <div className="flex h-full flex-col lg:flex-row">
        <aside aria-label="Roundtables" className={cn("flex shrink-0 flex-col border-b border-(--border) bg-(--panel) lg:w-[300px] lg:border-b-0 lg:border-r", activeId && !composing ? "max-lg:hidden" : "max-lg:max-h-[38%]")}>
          <div className="p-3">
            <PrimaryButton className="w-full" onClick={() => { setComposing(true); router.replace("/roundtable"); }}>
              <Plus className="h-4 w-4" /> New roundtable
            </PrimaryButton>
          </div>
          <ul className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 pb-3">
            {listing?.discussions.length === 0 ? <li className="px-3 py-4 text-[13px] text-(--muted-foreground)">Nothing discussed yet.</li> : null}
            {listing?.discussions.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => open(item.id)}
                  aria-current={item.id === activeId ? "true" : undefined}
                  className={cn("w-full rounded-(--radius-md) px-3 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--ring)",
                    item.id === activeId ? "bg-(--muted)" : "hover:bg-(--muted)")}
                >
                  <p className="line-clamp-2 text-[13.5px] font-medium leading-snug text-(--foreground)">{item.title}</p>
                  <p className="mt-1 flex items-center gap-2 text-[12px] text-(--muted-foreground)">
                    <span className="flex -space-x-1">{item.agentIds.map((id) => <i key={id} aria-hidden className="h-2.5 w-2.5 rounded-full ring-2 ring-(--panel)" style={{ background: colorOf(id) }} />)}</span>
                    <span className={cn(item.status === "running" && "text-(--primary)")}>{STATUS_COPY[item.status] ?? item.status}</span>
                    {item.projectName ? <span className="truncate text-(--entity-project)">{item.projectName}</span> : null}
                  </p>
                </button>
              </li>
            ))}
          </ul>
        </aside>

        <main className="min-h-0 min-w-0 flex-1 overflow-hidden bg-(--background)">
          {error && !shown ? <div className="p-6"><Notice>{error}</Notice></div> : null}
          {showForm && listing ? (
            <StartForm listing={listing} canRun={me ? me.canRunAgents : true} colorOf={colorOf} onStarted={(id) => { void loadList(); open(id); }} />
          ) : shown ? (
            <Transcript discussion={shown} colorOf={colorOf} canRun={me ? me.canRunAgents : true} onChanged={refresh} onBack={() => open(null)} onDeleted={() => { void loadList(); open(null); }} />
          ) : !error ? (
            <div className="space-y-3 p-8" aria-label="Loading">{[60, 82, 70].map((w) => <div key={w} className="h-4 animate-pulse rounded-full bg-(--panel) motion-reduce:animate-none" style={{ width: `${w}%` }} />)}</div>
          ) : null}
        </main>
      </div>
    </AppShell>
  );
}

function StartForm({ listing, canRun, colorOf, onStarted }: { listing: Listing; canRun: boolean; colorOf: (id: string | null) => string; onStarted: (id: string) => void }) {
  const [topic, setTopic] = useState("");
  const [seated, setSeated] = useState<string[]>(() => listing.agents.slice(0, 3).map((a) => a.id));
  const [rounds, setRounds] = useState(2);
  const [projectId, setProjectId] = useState("");
  const [projects, setProjects] = useState<Array<{ id: string; name: string }>>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const { minAgents, maxAgents, maxRounds } = listing.limits;

  useEffect(() => {
    fetch("/api/projects", { cache: "no-store" })
      .then(async (res) => (res.ok ? ((await res.json()) as { projects: Array<{ id: string; name: string }> }).projects : []))
      .then(setProjects).catch(() => undefined);
  }, []);

  const toggle = (id: string) => setSeated((current) => (current.includes(id) ? current.filter((x) => x !== id) : current.length >= maxAgents ? current : [...current, id]));
  const ready = topic.trim().length >= 8 && seated.length >= minAgents && canRun;

  async function start() {
    setBusy(true); setError("");
    try {
      const res = await fetch("/api/discussions", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic, agentIds: seated, rounds, projectId: projectId || undefined }),
      });
      if (!res.ok) throw new Error(await readError(res, "The roundtable did not start."));
      onStarted(((await res.json()) as { id: string }).id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The roundtable did not start.");
      setBusy(false);
    }
  }

  return (
    <div className="h-full overflow-y-auto">
      <form className="mx-auto w-full max-w-[680px] space-y-7 px-4 py-8 sm:px-8 sm:py-12" onSubmit={(e) => { e.preventDefault(); if (ready) void start(); }}>
        <header>
          <h2 className="font-display text-[34px] font-semibold leading-[1.05] tracking-tight">Put a question to your agents</h2>
          <p className="mt-3 max-w-[58ch] text-[14.5px] leading-relaxed text-(--muted-foreground)">
            Each one gives its own view, then they answer each other by name. They are asked to take a position and to say where they disagree, not to agree politely. One of them closes with what is settled and what is not.
          </p>
        </header>

        <Field label="The question">
          <textarea
            value={topic} onChange={(e) => setTopic(e.target.value)} rows={4} maxLength={2000} required
            placeholder="Should we rewrite the scheduler now, or patch it until the next release?"
            className={cn(fieldClass, "h-auto resize-y py-2.5 leading-relaxed")}
          />
        </Field>

        <fieldset>
          <legend className="mb-1.5 text-[13px] font-medium">At the table <span className="font-normal text-(--muted-foreground)">({minAgents} to {maxAgents})</span></legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {listing.agents.map((agent) => {
              const on = seated.includes(agent.id);
              return (
                <label key={agent.id} className={cn("flex cursor-pointer items-center gap-3 rounded-(--radius-md) border px-3.5 py-3 transition-colors focus-within:ring-2 focus-within:ring-(--ring)",
                  on ? "border-(--border-strong) bg-(--card)" : "border-(--border) opacity-70 hover:opacity-100")}>
                  <input type="checkbox" checked={on} onChange={() => toggle(agent.id)} className="sr-only" />
                  <i aria-hidden className={cn("h-3.5 w-3.5 shrink-0 rounded-full", !on && "opacity-40")} style={{ background: colorOf(agent.id) }} />
                  <span className="min-w-0 flex-1 truncate text-[14px] font-medium">{agent.name}</span>
                  <span className="text-[12px] text-(--muted-foreground)">{on ? "Seated" : "Not seated"}</span>
                </label>
              );
            })}
          </div>
        </fieldset>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Rounds" hint="Round one is each agent's own view. Later rounds are replies to each other.">
            <select value={rounds} onChange={(e) => setRounds(Number(e.target.value))} className={fieldClass}>
              {Array.from({ length: maxRounds }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n === 1 ? "1 round, views only" : `${n} rounds`}</option>)}
            </select>
          </Field>
          <Field label="Share with a project (optional)" hint="Everyone on that project can read it and speak in it.">
            <select value={projectId} onChange={(e) => setProjectId(e.target.value)} className={fieldClass}>
              <option value="">Only me</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </Field>
        </div>

        {!canRun ? <Notice tone="info">Your role does not run agents, so you cannot start a roundtable. You can read and speak in ones shared with your projects.</Notice> : null}
        {error ? <Notice>{error}</Notice> : null}
        <PrimaryButton type="submit" disabled={!ready || busy}>{busy ? "Starting…" : "Start the roundtable"}</PrimaryButton>
      </form>
    </div>
  );
}

const KIND_HEADING: Record<string, string> = { opening: "Own views", response: "Replies", synthesis: "Closing note" };

function Transcript({ discussion, colorOf, canRun, onChanged, onBack, onDeleted }: {
  discussion: Discussion; colorOf: (id: string | null) => string; canRun: boolean; onChanged: () => Promise<void>; onBack: () => void; onDeleted: () => void;
}) {
  const [say, setSay] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const running = discussion.status === "running";
  const speaking = discussion.turns.find((turn) => turn.status === "speaking");
  const turnCount = discussion.turns.length;

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [turnCount, speaking?.content.length]);

  // Turns grouped where the round or the kind of turn changes, so each group can be named for what it is.
  const groups = useMemo(() => {
    const out: Array<{ key: string; label: string; turns: Turn[] }> = [];
    for (const turn of discussion.turns) {
      const kind = turn.kind === "human" ? null : turn.kind;
      const last = out[out.length - 1];
      const label = kind === "synthesis" ? KIND_HEADING.synthesis : kind ? `Round ${turn.round}: ${KIND_HEADING[kind].toLowerCase()}` : last?.label ?? `Round ${turn.round}`;
      if (!last || (kind && last.label !== label)) out.push({ key: `${turn.sequence}`, label, turns: [turn] });
      else last.turns.push(turn);
    }
    return out;
  }, [discussion.turns]);

  async function post(key: string, url: string, body: unknown, failure: string, method = "POST") {
    setBusy(key); setError("");
    try {
      const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
      if (!res.ok) throw new Error(await readError(res, failure));
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : failure);
      return false;
    } finally {
      setBusy("");
    }
  }

  const base = `/api/discussions/${discussion.id}`;
  const speak = async () => { const text = say.trim(); if (!text) return; if (await post("say", `${base}/turns`, { content: text }, "That was not added.")) { setSay(""); await onChanged(); } };

  return (
    <div className="flex h-full flex-col">
      <header className="border-b border-(--border) px-4 py-4 sm:px-8">
        <button type="button" onClick={onBack} className="mb-2 text-[12.5px] text-(--muted-foreground) underline-offset-2 hover:text-(--foreground) hover:underline lg:hidden">All roundtables</button>
        <h2 className="max-w-[60ch] font-display text-[22px] font-semibold leading-snug tracking-tight">{discussion.topic}</h2>
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
          <ul aria-label="At the table" className="flex flex-wrap gap-1.5">
            {discussion.agents.map((agent) => {
              const live = speaking?.agentId === agent.id;
              return (
                <li key={agent.id} className={cn("flex items-center gap-2 rounded-full border px-3 py-1 text-[12.5px]", live ? "border-(--border-strong) bg-(--card) text-(--foreground)" : "border-(--border) text-(--muted-foreground)")}>
                  <i aria-hidden className={cn("h-2.5 w-2.5 rounded-full", live && "animate-pulse-dot")} style={{ background: colorOf(agent.id) }} />
                  {agent.name}{live ? <span className="text-(--foreground)">is speaking</span> : null}
                </li>
              );
            })}
          </ul>
          <span className={cn("text-[12.5px]", running ? "text-(--primary)" : "text-(--muted-foreground)")}>{STATUS_COPY[discussion.status]}</span>
          {discussion.projectName ? <span className="text-[12.5px] text-(--entity-project)">Shared with {discussion.projectName}</span> : null}
          {!discussion.mine ? <span className="text-[12.5px] text-(--muted-foreground)">Started by {discussion.startedBy}</span> : null}
          <div className="ml-auto flex gap-2">
            {running ? (
              <QuietButton disabled={busy === "cancel"} onClick={async () => { if (await post("cancel", base, { action: "cancel" }, "It did not stop.")) await onChanged(); }}>
                <Square className="h-3 w-3" /> Stop
              </QuietButton>
            ) : discussion.mine ? (
              <QuietButton danger disabled={busy === "delete"} aria-label="Delete this roundtable" onClick={async () => { if (window.confirm("Delete this roundtable and everything said in it?") && (await post("delete", base, undefined, "It was not deleted.", "DELETE"))) onDeleted(); }}>
                <Trash2 className="h-3.5 w-3.5" /> Delete
              </QuietButton>
            ) : null}
          </div>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto" aria-live="polite">
        <div className="mx-auto w-full max-w-[720px] px-4 py-6 sm:px-8">
          {discussion.turns.length === 0 ? (
            <EmptyState title={running ? "Waiting for the first agent" : "Nothing was said"} hint={running ? "Each agent answers through its own runtime, so the first words can take a moment." : discussion.error ?? undefined} />
          ) : null}
          {groups.map((group) => (
            <section key={group.key} className="mb-9">
              <h3 className="mb-4 flex items-center gap-3 text-[12.5px] font-medium text-(--text-faint)">
                {group.label}<span aria-hidden className="h-px flex-1 bg-(--border)" />
              </h3>
              <div className="space-y-7">
                {group.turns.map((turn) => <TurnView key={turn.id} turn={turn} color={colorOf(turn.agentId)} />)}
              </div>
            </section>
          ))}
          {discussion.status === "failed" && discussion.error ? <Notice>{discussion.error}</Notice> : null}
          <div ref={bottomRef} />
        </div>
      </div>

      <footer className="border-t border-(--border) bg-(--panel) px-4 py-3 sm:px-8">
        <div className="mx-auto w-full max-w-[720px] space-y-2">
          {error ? <Notice>{error}</Notice> : null}
          <form className="flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); void speak(); }}>
            <textarea
              value={say} onChange={(e) => setSay(e.target.value)} rows={1} maxLength={2000} aria-label="Say something to the table"
              placeholder={running ? "Say something. The agents answer it on their next turn." : "Add something, then ask for another round."}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void speak(); } }}
              className={cn(fieldClass, "h-auto min-h-10 flex-1 resize-none py-2.5")}
            />
            <button type="submit" aria-label="Add to the discussion" disabled={!say.trim() || busy === "say"} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-(--primary) text-(--primary-foreground) transition-colors hover:bg-(--primary-soft) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--ring) disabled:bg-(--muted) disabled:text-(--muted-foreground)">
              <ArrowUp className="h-[18px] w-[18px]" />
            </button>
            {!running && canRun ? (
              <QuietButton className="h-10 shrink-0" disabled={busy === "continue"} onClick={async () => { if (await post("continue", base, { action: "continue" }, "Another round did not start.")) await onChanged(); }}>
                Another round
              </QuietButton>
            ) : null}
          </form>
        </div>
      </footer>
    </div>
  );
}

function TurnView({ turn, color }: { turn: Turn; color: string }) {
  if (turn.kind === "human") {
    return (
      <article className={cn("flex gap-3", turn.mine && "flex-row-reverse")}>
        <Initial name={turn.speaker} className="h-7 w-7 text-[11px]" />
        <div className={cn("max-w-[85%]", turn.mine && "text-right")}>
          <p className="mb-1 text-[12.5px] font-semibold">{turn.mine ? "You" : turn.speaker}</p>
          <p className={cn("inline-block whitespace-pre-wrap rounded-(--radius-lg) border px-3.5 py-2.5 text-left text-[14.5px] leading-[1.55]",
            turn.mine ? "border-(--border-strong) bg-(--accent) shadow-[inset_-3px_0_0_var(--primary)]" : "border-(--border) bg-(--card)")}>{turn.content}</p>
        </div>
      </article>
    );
  }
  const closing = turn.kind === "synthesis";
  return (
    <article className={cn(closing && "rounded-(--radius-lg) border border-(--border-strong) bg-(--panel) p-5")}>
      <p className="mb-2 flex items-center gap-2 text-[13px] font-semibold">
        <i aria-hidden className={cn("h-2.5 w-2.5 rounded-full", turn.status === "speaking" && "animate-pulse-dot")} style={{ background: color }} />
        {turn.speaker}
        {turn.status === "speaking" && !turn.content ? <span className="font-normal text-(--muted-foreground)">is thinking…</span> : null}
      </p>
      {turn.content ? (
        <div className={cn("prose-sentinel border-l-2 pl-4 text-[14.5px] leading-[1.65]",
          turn.status === "speaking" && "after:ml-0.5 after:inline-block after:h-4 after:w-[2px] after:translate-y-0.5 after:animate-pulse after:bg-(--primary) after:align-middle after:content-[''] motion-reduce:after:animate-none")}
          style={{ borderColor: color }}>
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{turn.content}</ReactMarkdown>
        </div>
      ) : null}
      {turn.position ? (
        <p className="mt-3 ml-4 rounded-(--radius-md) bg-(--card) px-3.5 py-2.5 text-[13.5px] leading-snug">
          <span className="text-(--muted-foreground)">Where {turn.speaker} stands: </span>{turn.position}
        </p>
      ) : null}
      {turn.status === "failed" ? (
        <p className="mt-2 ml-4 text-[13px] text-(--destructive)">{turn.speaker} could not answer: {turn.error ?? "the runtime failed"}.</p>
      ) : null}
    </article>
  );
}
