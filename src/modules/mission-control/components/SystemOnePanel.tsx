"use client";
import { useEffect, useState } from "react";
import { MissionPanel, PanelLink } from "./MissionPanel";
import type { SystemOneSummary } from "@/lib/system-one/telemetry";

type Snapshot = { config: { mode: string; provider: string; model: string; keyConfigured: boolean; timeoutMs: number; breaker: string; fallbackPolicy: string }; summary: SystemOneSummary; recent: Array<{ id: string; createdAt: string; agentId: string; surface: string; outcome: string; route: string | null; s1LatencyMs: number | null; system2Model: string | null; system2Invoked: boolean }> };
export function SystemOnePanel() {
  const [data, setData] = useState<Snapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/system-one/metrics", { signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error("Routing metrics unavailable");
      setData(await response.json()); setError(null);
    }).catch(e => { if (!controller.signal.aborted) setError(String(e.message)); });
    return () => controller.abort();
  }, [revision]);
  const percent = (n: number | null) => n === null ? "Unmeasured" : `${(n * 100).toFixed(1)}%`;
  return <div className="mx-auto max-w-6xl space-y-4 p-4 text-[--canvas-foreground]">
    <MissionPanel title="Jev System-1 routing" action={<div className="flex gap-2"><button className="rounded border px-3 py-1" onClick={() => setRevision(n => n + 1)}>Refresh</button><PanelLink href="/">Mission Control</PanelLink></div>}>
      {error && <p role="alert" className="p-4">{error}</p>}
      {!data && !error && <p className="p-4">Loading routing decisions…</p>}
      {data && <div className="space-y-3 p-4 text-sm">
        <p>Default router: {data.config.provider} · {data.config.model} · {data.config.mode}. Key {data.config.keyConfigured ? "configured" : "missing"}; breaker {data.config.breaker}; timeout {data.config.timeoutMs} ms.</p>
        <p>Last successful decision: {data.summary.lastSuccessAt ? new Date(data.summary.lastSuccessAt).toLocaleString() : "None recorded; availability unverified"}.</p>
        <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <div><dt>System-1 latency p50 / p95</dt><dd>{data.summary.s1.p50 ?? "–"} / {data.summary.s1.p95 ?? "–"} ms</dd></div>
          <div><dt>System-2 dispatch</dt><dd>{percent(data.summary.system2DispatchRate)}</dd></div>
          <div><dt>Fallback rate</dt><dd>{percent(data.summary.fallbackRate)}</dd></div>
          <div><dt>Estimated net savings</dt><dd>{data.summary.netSavingsUsd === null ? "Unpriced" : `$${data.summary.netSavingsUsd.toFixed(4)}`}</dd></div>
        </dl>
        <p>{data.summary.s1.inputTokens} System-1 input tokens; ${data.summary.s1.costUsd.toFixed(4)} reported cost. {data.summary.unpricedDecisions} decisions have no provider-reported price. {data.summary.system2CallsAvoided} System-2 calls avoided.</p>
        <p>Shadow tool agreement: {percent(data.summary.shadowToolAgreement.rate)} ({data.summary.shadowToolAgreement.comparable} comparable decisions). This is a proxy; routing accuracy requires labeled evaluation.</p>
        <p className="text-xs opacity-75">Fallback: {data.config.fallbackPolicy}</p>
      </div>}
    </MissionPanel>
    {data && <MissionPanel title="Recent routing decisions"><div className="overflow-x-auto"><table className="w-full text-left text-xs"><thead><tr>{["Time", "Assigned agent", "Surface", "Route", "Outcome", "Latency", "System-2 model"].map(label => <th className="p-3" key={label}>{label}</th>)}</tr></thead><tbody>{data.recent.map(row => <tr key={row.id} className="border-t border-white/10"><td className="p-3">{new Date(row.createdAt).toLocaleString()}</td><td className="p-3">{row.agentId}</td><td className="p-3">{row.surface}</td><td className="p-3">{row.route ?? "Fallback"}</td><td className="p-3">{row.outcome}</td><td className="p-3">{row.s1LatencyMs ?? "–"} ms</td><td className="p-3">{row.system2Invoked ? row.system2Model ?? "Runtime default" : "Not dispatched"}</td></tr>)}</tbody></table>{data.recent.length === 0 && <p className="p-4">No decisions recorded.</p>}</div></MissionPanel>}
  </div>;
}
