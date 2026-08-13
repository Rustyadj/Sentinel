"use client";

import { useEffect, useState } from "react";
import { ShieldCheck } from "lucide-react";
import { buttonClass, EmptyState, ErrorBanner, inputClass, LoadingState, readApiError, SectionHeader } from "./LearningCoreViewShared";

interface AgentOption { id: string; name: string; avatar: string; color: string }
interface TrustScore { id: string; agentId: string; score: number; accuracy: number; rollbackCount: number; hallucinations: number; unsafeEvents: number; failedExperiments: number; overrides: number; approvedImprovements: number; benchmarkWins: number; agent: AgentOption }
interface TrustEventRow { id: string; agentId: string; delta: number; reason: string; category: string; createdAt: string; agent: AgentOption }
interface TrustPayload { scores: TrustScore[]; events: TrustEventRow[] }

const DELTAS = { benchmark_win: 3, approved_improvement: 5, accuracy: 1, failed_experiment: -1, user_override: -2, hallucination: -4, rollback: -8, unsafe_event: -15 };

export function TrustView() {
  const [payload, setPayload] = useState<TrustPayload>({ scores: [], events: [] });
  const [agents, setAgents] = useState<AgentOption[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const response = await fetch("/api/learning-core/trust");
    if (!response.ok) throw new Error(await readApiError(response));
    setPayload(await response.json());
  }

  useEffect(() => {
    Promise.all([fetch("/api/learning-core/trust"), fetch("/api/agents")])
      .then(async ([trustResponse, agentsResponse]) => {
        if (!trustResponse.ok) throw new Error(await readApiError(trustResponse));
        if (!agentsResponse.ok) throw new Error(await readApiError(agentsResponse));
        const [trustData, agentData] = await Promise.all([trustResponse.json(), agentsResponse.json()]);
        setPayload(trustData);
        setAgents(agentData);
      })
      .catch((cause) => setError(cause instanceof Error ? cause.message : "Unable to load trust center"))
      .finally(() => setLoaded(true));
  }, []);

  async function record(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const response = await fetch("/api/learning-core/trust", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agentId: data.get("agentId"), category: data.get("category"), reason: data.get("reason") }),
    });
    if (!response.ok) return setError(await readApiError(response));
    form.reset();
    await load();
  }

  return (
    <div className="max-w-6xl p-6">
      <SectionHeader icon={<ShieldCheck className="h-4 w-4 text-[--primary]" />} title="Trust Center" description="Trust starts at 50 and changes only through immutable events. Scores gate autonomy; Level 3 always stays human-controlled." />
      <ErrorBanner message={error} />
      <form onSubmit={record} className="mb-6 grid gap-2 rounded-lg border border-[--sidebar-border] bg-[--card] p-4 md:grid-cols-3">
        <select name="agentId" required className={inputClass} defaultValue=""><option value="" disabled>Select agent</option>{agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}</select>
        <select name="category" className={inputClass} defaultValue="accuracy">{Object.entries(DELTAS).map(([category, delta]) => <option key={category} value={category}>{category.replaceAll("_", " ")} ({delta > 0 ? "+" : ""}{delta})</option>)}</select>
        <input name="reason" required placeholder="Evidence / reason" className={inputClass} />
        <button className={`${buttonClass} md:col-span-3`}>Record trust event</button>
      </form>
      {!loaded ? <LoadingState /> : (
        <>
          {payload.scores.length === 0 ? <EmptyState>No trust events yet; agents begin at an implicit score of 50.</EmptyState> : <div className="mb-8 grid gap-3 md:grid-cols-2 xl:grid-cols-3">{payload.scores.map((score) => (
            <article key={score.id} className="rounded-lg border border-[--sidebar-border] bg-[--card] p-4">
              <div className="flex items-center gap-2"><span className="flex h-7 w-7 items-center justify-center rounded-full text-xs" style={{ backgroundColor: `${score.agent.color}22` }}>{score.agent.avatar}</span><div className="min-w-0"><h2 className="truncate text-xs font-medium text-[--foreground]">{score.agent.name}</h2><p className="text-[10px] text-[--muted-foreground]">Accuracy {(score.accuracy * 100).toFixed(0)}%</p></div><strong className="ml-auto text-2xl text-[--foreground]">{score.score}</strong></div>
              <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/5"><div className="h-full rounded-full bg-[--primary]" style={{ width: `${score.score}%` }} /></div>
              <div className="mt-3 grid grid-cols-3 gap-1 text-center text-[9px] text-[--muted-foreground]"><span>{score.benchmarkWins} wins</span><span>{score.failedExperiments} failed</span><span>{score.rollbackCount} rollbacks</span><span>{score.hallucinations} halluc.</span><span>{score.overrides} overrides</span><span>{score.unsafeEvents} unsafe</span></div>
            </article>
          ))}</div>}
          <h2 className="mb-2 text-xs font-semibold text-[--foreground]">Event log</h2>
          <div className="space-y-1.5">{payload.events.map((event) => <div key={event.id} className="flex items-start gap-3 rounded-lg border border-[--sidebar-border] bg-[--card] p-3 text-xs"><span className={`font-semibold ${event.delta >= 0 ? "text-emerald-400" : "text-red-400"}`}>{event.delta >= 0 ? "+" : ""}{event.delta}</span><div className="min-w-0 flex-1"><p className="text-[--foreground]">{event.reason}</p><p className="mt-0.5 text-[10px] text-[--muted-foreground]">{event.agent?.name ?? event.agentId} · {event.category.replaceAll("_", " ")} · {new Date(event.createdAt).toLocaleString()}</p></div></div>)}</div>
        </>
      )}
    </div>
  );
}
