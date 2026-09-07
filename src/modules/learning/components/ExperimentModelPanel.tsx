"use client";
import { useEffect, useState } from "react";

type Agent = { id: string; name: string; model: string; reasoningEffort: string | null };
type Runtime = { agentId: string; kind: string; workspaceId?: string };
const ROLES = ["generator", "evaluator", "adversary", "guardian"] as const;
export function ExperimentModelPanel({ candidates }: { candidates: { id: string; type: string }[] }) {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [runtimes, setRuntimes] = useState<Runtime[]>([]);
  const [candidateId, setCandidateId] = useState("");
  const [roles, setRoles] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const [running, setRunning] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    Promise.all(["/api/agents", "/api/agent-runtimes"].map(async url => {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) throw new Error("Could not load experiment agents");
      return response.json();
    })).then(([a, r]) => { setAgents(a); setRuntimes(r.runtimes.filter((runtime: Runtime) => runtime.kind !== "openclaw")); })
      .catch(error => { if (!controller.signal.aborted) setMessage(String(error)); });
    return () => controller.abort();
  }, []);
  const workspaceId = runtimes.find(runtime => runtime.agentId === roles.generator)?.workspaceId;
  const independent = roles.generator !== roles.evaluator && roles.generator !== roles.guardian && roles.evaluator !== roles.guardian;
  async function run() {
    setRunning(true); setMessage("");
    try {
      const response = await fetch("/api/learning/experiments", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ candidateId, workspaceId, models: roles }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      setMessage(`Experiment ${result.stage}${result.stopReason ? `: ${result.stopReason}` : ""}. ${result.results?.notes ?? "Evidence and session provenance recorded."}`);
    } catch (error) { setMessage(String(error)); } finally { setRunning(false); }
  }
  return <section className="mb-6 rounded-lg border border-[--sidebar-border] p-4">
    <h2 className="text-sm font-medium">Model experiment</h2>
    <p className="my-2 text-xs text-[--muted-foreground]">Use configured agents for generation and independent review. Every role uses a new runtime session. Promotion remains governed.</p>
    <label className="block text-xs">Candidate<select aria-label="Experiment candidate" value={candidateId} onChange={event => setCandidateId(event.target.value)} className="my-2 w-full rounded border border-[--sidebar-border] bg-[--card] p-2"><option value="">Choose a candidate</option>{candidates.map(candidate => <option key={candidate.id} value={candidate.id}>{candidate.type} · {candidate.id.slice(-8)}</option>)}</select></label>
    <div className="grid gap-3 sm:grid-cols-2">{ROLES.map(role => <label key={role} className="text-xs capitalize">{role}<select aria-label={`Experiment ${role}`} value={roles[role] ?? ""} onChange={event => setRoles(current => ({ ...current, [role]: event.target.value }))} className="my-2 w-full rounded border border-[--sidebar-border] bg-[--card] p-2"><option value="">Choose an agent</option>{agents.filter(agent => runtimes.some(runtime => runtime.agentId === agent.id && (role === "generator" || !workspaceId || runtime.workspaceId === workspaceId))).map(agent => <option key={agent.id} value={agent.id}>{agent.name} · {agent.model}{agent.reasoningEffort ? ` / ${agent.reasoningEffort}` : ""}</option>)}</select></label>)}</div>
    {!independent && <p className="my-2 text-xs">Generator, evaluator, and Guardian must be separate agents.</p>}
    <button onClick={() => void run()} disabled={running || !candidateId || !workspaceId || !independent || ROLES.some(role => !roles[role])} className="mt-2 rounded border border-[--sidebar-border] px-3 py-2 text-xs disabled:opacity-50">{running ? "Running experiment…" : "Run governed experiment"}</button>
    {message && <p role="status" className="mt-3 text-xs">{message}</p>}
  </section>;
}
