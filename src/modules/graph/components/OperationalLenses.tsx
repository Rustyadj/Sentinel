"use client";
import { useEffect, useState, useSyncExternalStore } from "react";
import { OPERATIONAL_LENSES, operationalMetadata, type OperationalLens } from "@/lib/knowledge/operational-types";
import type { KnowledgeEdge, KnowledgeNode } from "@/lib/knowledge/types";
import type { ScopedGraph } from "./useGraphData";

const subscribeHydration = () => () => {};

export interface OperationalView extends ScopedGraph {
  nodes: ScopedGraph["nodes"];
  notices: string[];
  teams: { id: string; title: string; incidents: number; incidentsPerCapacityHour: number | null; capacityTrend?: { from: string; to: string; incidentsPerCapacityHour: number }[]; trendPartial?: boolean }[];
  alertAnalytics: { total: number; actionable: number; falsePositives: number; duplicates: number };
}
export function OperationalNodeDetails({ node }: { node: KnowledgeNode }) {
  const meta = operationalMetadata(node.metadata);
  if (!meta) return null;
  const impact = node.metadata.impact as { status: string; confidence: number | null; reasons: string[]; evidence: string[] } | undefined;
  return <div className="space-y-2 text-xs">
    <p>{node.title} · {meta.facts.severity ?? meta.facts.status ?? node.type}{meta.facts.critical ? " · critical service" : ""}</p>
    {meta.facts.classification ? <p>Alert classification: {meta.facts.classification.replace(/_/g, " ")}</p> : null}
    <p>Observed {new Date(meta.eventTime).toLocaleString()} · {meta.source}</p>
    {meta.facts.startedAt ? <p>Started {new Date(meta.facts.startedAt).toLocaleString()}</p> : null}
    {meta.facts.resolvedAt ? <p>Resolved {new Date(meta.facts.resolvedAt).toLocaleString()}</p> : null}
    {meta.facts.rootCause ? <p>Root cause ({meta.facts.rootCauseConfirmed ? "confirmed" : "unconfirmed"}): {meta.facts.rootCause}</p> : null}
    {impact ? <p>Impact: {impact.status} · {impact.confidence === null ? "confidence unknown" : `${Math.round(impact.confidence * 100)}%`}<br />{impact.reasons.join("; ")}</p> : null}
    {[...new Set([...meta.evidence, ...(impact?.evidence ?? [])])].slice(0, 10).filter(link => /^https?:\/\//i.test(link)).map((link, index) => <a className="block truncate underline" key={link} href={link} target="_blank" rel="noreferrer">Evidence {index + 1}</a>)}
  </div>;
}

/** Contextual controls over the current canvas; no separate operational dashboard. */
export function OperationalLenses({ onGraph, selectedId, className = "", projectId }: { onGraph: (graph: OperationalView | null) => void; selectedId?: string | null; className?: string; projectId?: string }) {
  const hydrated = useSyncExternalStore(subscribeHydration, () => true, () => false);
  const [workspaces, setWorkspaces] = useState<{ id: string; name: string }[]>([]);
  const [workspaceId, setWorkspaceId] = useState("");
  const [lens, setLens] = useState<OperationalLens | "global">("global");
  const [view, setView] = useState<OperationalView | null>(null);
  const [failure, setFailure] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const [history, setHistory] = useState<{ id: string; eventTime: string; source: string; relationships: { type: string; confidence: number; validFrom: string; validTo?: string | null }[] }[]>([]);
  const [cursor, setCursor] = useState<string | undefined>();
  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/workspaces", { signal: controller.signal }).then(response => response.ok ? response.json() : { workspaces: [] }).then(body => { if (!controller.signal.aborted) setWorkspaces(body.workspaces ?? []); }).catch(() => {});
    return () => controller.abort();
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    if (lens === "global") { onGraph(null); return; }
    if (!workspaceId) { onGraph({ nodes: [], edges: [], focusId: null, totalVisible: 0, partial: false, notices: [], teams: [], alertAnalytics: { total: 0, actionable: 0, falsePositives: 0, duplicates: 0 } }); return; }
    void (async () => {
      setBusy(true); setError(null); onGraph({ nodes: [], edges: [], focusId: null, totalVisible: 0, partial: false, notices: [], teams: [], alertAnalytics: { total: 0, actionable: 0, falsePositives: 0, duplicates: 0 } });
      try {
        const params = new URLSearchParams({ workspaceId, lens });
        if (failure && lens === "blast-radius") params.set("serviceId", failure);
        const response = await fetch(`/api/graph/operations?${params}`, { signal: controller.signal });
        const body = await response.json();
        if (controller.signal.aborted) return;
        if (!response.ok) throw new Error(body.error ?? "Operational graph unavailable");
        setView(body); onGraph(body);
      } catch (caught) { if (!controller.signal.aborted) { setError(caught instanceof Error ? caught.message : "Operational graph unavailable"); setView(null); } }
      finally { if (!controller.signal.aborted) setBusy(false); }
    })();
    return () => controller.abort();
  }, [workspaceId, lens, failure, revision, onGraph, projectId]);
  useEffect(() => {
    const controller = new AbortController();
    if (!selectedId || !workspaceId || lens === "global") return;
    void fetch(`/api/graph/operations?${new URLSearchParams({ workspaceId, historyFor: selectedId })}`, { signal: controller.signal }).then(response => response.ok ? response.json() : { revisions: [] }).then(body => { if (!controller.signal.aborted) setHistory(body.revisions ?? []); }).catch(() => {});
    return () => controller.abort();
  }, [selectedId, workspaceId, lens, revision]);
  async function mutate(action: string, extra: Record<string, unknown> = {}) {
    setBusy(true); setError(null);
    try {
      const response = await fetch("/api/graph/operations", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ workspaceId, action, ...extra }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Action failed");
      if (action === "backfill") setCursor(body.partial ? body.nextCursor : undefined);
      setRevision(value => value + 1);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Action failed"); }
    finally { setBusy(false); }
  }
  const selected = view?.nodes.find(node => node.id === selectedId);
  const proposed = view?.edges.filter(edge => edge.type === "SERVICE_CORRELATED_WITH_SERVICE" && edge.metadata.status === "proposed") ?? [];
  const titleFor = (id: string) => view?.nodes.find(node => node.id === id)?.title ?? "Service";
  const control = "rounded border border-current/20 bg-(--card) px-2 py-1 text-xs text-(--foreground)";
  return <div className={`pointer-events-auto z-30 max-h-[55vh] w-72 overflow-auto rounded-xl border border-white/10 bg-(--card)/95 p-3 text-(--foreground) shadow-lg ${className}`}>
    <label className="block text-xs">Operational lens<select disabled={!hydrated} aria-label="Operational lens" className={`${control} ml-2`} value={lens} onChange={event => setLens(event.target.value as OperationalLens | "global")}><option value="global">Global graph</option>{OPERATIONAL_LENSES.map(item => <option key={item} value={item}>{item.replace(/-/g, " ")}</option>)}</select></label>
    {lens !== "global" ? <div className="mt-2 space-y-2">
      <select aria-label="Operational workspace" className={`${control} w-full`} value={workspaceId} onChange={event => { setWorkspaceId(event.target.value); setFailure(""); setCursor(undefined); setView(null); }}><option value="">Select workspace</option>{workspaces.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
      {lens === "blast-radius" ? <select aria-label="Failed service" className={`${control} w-full`} value={failure} onChange={event => setFailure(event.target.value)}><option value="">Select failed service</option>{view?.nodes.filter(node => node.type === "Service").map(node => <option value={node.id} key={node.id}>{node.title}</option>)}</select> : null}
      {workspaceId ? <div className="flex gap-2"><button className={control} disabled={busy} onClick={() => void mutate("backfill", cursor ? { cursor } : {})}>{cursor ? "Continue backfill" : "Import recorded events"}</button><button className={control} disabled={busy} onClick={() => void mutate("discover")}>Discover</button></div> : null}
      {busy ? <p role="status" className="text-xs">Loading operational evidence…</p> : null}
      {error ? <p role="alert" className="text-xs">{error}</p> : null}
      {view?.notices.map(notice => <p className="text-xs" key={notice}>{notice}</p>)}
      {view?.partial ? <p className="text-xs">Partial history · bounded sample</p> : null}
      {view && !busy && !view.nodes.length ? <p className="text-xs">No operational evidence recorded in this workspace.</p> : null}
      {lens === "blast-radius" ? <p className="text-xs">Confirmed: observed failure · Predicted: possible impact · Unknown: insufficient evidence</p> : null}
      {lens === "team" ? view?.teams.map(team => <p className="text-xs" key={team.id}>{team.title}: {team.incidents} incidents · {team.incidentsPerCapacityHour === null ? "capacity unavailable" : `${team.incidentsPerCapacityHour.toFixed(3)} / capacity hour`}{team.capacityTrend?.map(interval => <span className="block" key={interval.from}>{interval.from.slice(0, 10)}–{interval.to.slice(0, 10)}: {interval.incidentsPerCapacityHour.toFixed(3)} / capacity hour</span>)}{team.trendPartial ? " · partial trend history" : ""}</p>) : null}
      {lens === "alert" && view ? <p className="text-xs">{view.alertAnalytics.actionable} actionable · {view.alertAnalytics.falsePositives} false positives · {view.alertAnalytics.duplicates} duplicates. Review grouping and routing before tuning.</p> : null}
      {selected ? <><OperationalNodeDetails node={selected} /><details className="text-xs"><summary>Relationship timeline</summary>{history.slice(0, 10).map(item => <div key={item.id} className="mt-1"><p>{new Date(item.eventTime).toLocaleString()} · {item.source}</p>{item.relationships.map((edge, index) => <p key={index}>{edge.type.replace(/_/g, " ")} · {Math.round(edge.confidence * 100)}% · {edge.validFrom} → {edge.validTo ?? "open"}</p>)}</div>)}</details></> : null}
      {proposed.slice(0, 5).map((edge: KnowledgeEdge) => <div key={edge.id} className="space-y-1 border-t border-current/10 pt-2 text-xs"><p>{titleFor(edge.fromObjectId)} ↔ {titleFor(edge.toObjectId)} · proposed correlation · {Math.round(edge.weight * 100)}% lower bound</p>{Array.isArray(edge.metadata.evidence) ? edge.metadata.evidence.filter((value): value is string => typeof value === "string" && /^https?:\/\//i.test(value)).slice(0, 3).map((link, index) => <a className="block truncate underline" href={link} rel="noreferrer" target="_blank" key={link}>Supporting evidence {index + 1}</a>) : null}<div className="flex gap-2"><button disabled={busy} className={control} onClick={() => void mutate("review", { edgeId: edge.id, verdict: "confirmed" })}>Confirm association</button><button disabled={busy} className={control} onClick={() => void mutate("review", { edgeId: edge.id, verdict: "rejected" })}>Reject</button></div></div>)}
    </div> : null}
  </div>;
}
