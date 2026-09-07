"use client";
import { useEffect, useState } from "react";
import { LensOverview } from "@/components/neural-lens/LensOverview";
export function AiSecurityPanel() {
  const [runs, setRuns] = useState<Array<{ id: string; attackType: string; outcome: string }>>([]);
  const [decisions, setDecisions] = useState<Array<{ id: string; guardianDecision: string; action: string }>>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    Promise.all(["adversarial", "guardian"].map(async name => {
      const response = await fetch(`/api/learning/${name}`, { signal: controller.signal });
      if (!response.ok) throw new Error("AI Security evidence unavailable");
      return response.json();
    })).then(([a, g]) => { setRuns(a); setDecisions(g); }).catch(e => { if (!controller.signal.aborted) setError(String(e)); });
    return () => controller.abort();
  }, []);
  return <div className="h-full overflow-y-auto p-4">
    <h2 className="text-lg font-semibold">AI Security / Agent Security</h2>
    <p className="my-2 text-sm text-[--muted-foreground]">Adversarial runs, prompt injection, memory poisoning, tool-boundary tests, Guardian interventions, and regression suites on Sentinel’s canonical graph.</p>
    <div className="h-[700px]"><LensOverview lens="cybersecurity" stats={null} initialDemoMode={false} /></div>
    {error && <p role="alert">{error}</p>}
    <div className="mt-4 grid gap-4 md:grid-cols-2">
      <section><h3>Adversarial runs</h3>{runs.length ? runs.map(run => <p key={run.id} className="my-2 text-xs">{run.attackType} · {run.outcome}</p>) : <p className="text-xs">No accessible runs.</p>}</section>
      <section><h3>Guardian interventions</h3>{decisions.length ? decisions.map(d => <p key={d.id} className="my-2 text-xs">{d.guardianDecision} · {d.action}</p>) : <p className="text-xs">No accessible decisions.</p>}</section>
    </div>
    <a href="/learning?tab=evaluations" className="mt-4 inline-block text-sm underline">Regression suites</a>
  </div>;
}
