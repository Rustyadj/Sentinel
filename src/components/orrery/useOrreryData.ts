"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { buildLensGraphFromApi } from "@/components/neural-lens/fromApiGraph";
import type { OrreryActivity, OrreryEvent } from "@/lib/orrery/types";
import { toGlobeModel, type GlobeModel } from "./globe-model";

const GRAPH_LIMIT = 400;
const GRAPH_REFRESH_MS = 45_000;
const ACTIVITY_POLL_MS = 3_000;
const FEED_LIMIT = 60;

interface ApiNode { id: string; type: string; title: string; workspaceId?: string | null }
interface ApiEdge { id?: string; fromObjectId: string; toObjectId: string; weight?: number; type?: string }
interface ScopedPayload { nodes: ApiNode[]; edges: ApiEdge[]; partial?: boolean; totalVisible?: number }

export type OrreryStatus = "loading" | "ready" | "error";

export interface OrreryData {
  status: OrreryStatus;
  error: string | null;
  model: GlobeModel | null;
  /** Newest first. Includes events from before the page opened. */
  feed: OrreryEvent[];
  activity: OrreryActivity | null;
  /** True when the scoped graph read was truncated at its limit. */
  partial: boolean;
  /** Re-read activity now (e.g. after approving something). */
  refresh: () => void;
}

const edgeKey = (e: ApiEdge) => e.id ?? `${e.fromObjectId}>${e.toObjectId}:${e.type ?? ""}`;

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(res.status === 401 ? "Sign in to see the graph." : `Request failed (${res.status})`);
  return (await res.json()) as T;
}

/**
 * Loads the user's real knowledge graph and follows real agent activity.
 * `onEvents` receives only events that arrive after the first poll, so opening
 * the page never replays history as movement — history goes to the feed only.
 */
export function useOrreryData(onEvents: (events: OrreryEvent[]) => void): OrreryData {
  const [status, setStatus] = useState<OrreryStatus>("loading");
  const [error, setError] = useState<string | null>(null);
  const [model, setModel] = useState<GlobeModel | null>(null);
  const [partial, setPartial] = useState(false);
  const [feed, setFeed] = useState<OrreryEvent[]>([]);
  const [activity, setActivity] = useState<OrreryActivity | null>(null);

  const nodes = useRef(new Map<string, ApiNode>());
  const edges = useRef(new Map<string, ApiEdge>());
  const attempted = useRef(new Set<string>());
  const seen = useRef(new Set<string>());
  const cursor = useRef<string | undefined>(undefined);
  const onEventsRef = useRef(onEvents);
  const pollNow = useRef<() => void>(() => undefined);

  useEffect(() => { onEventsRef.current = onEvents; }, [onEvents]);

  const merge = useCallback((payload: ScopedPayload) => {
    let changed = false;
    for (const n of payload.nodes) if (!nodes.current.has(n.id)) { nodes.current.set(n.id, n); changed = true; }
    for (const e of payload.edges) { const k = edgeKey(e); if (!edges.current.has(k)) { edges.current.set(k, e); changed = true; } }
    if (changed) {
      const lens = buildLensGraphFromApi({ nodes: [...nodes.current.values()], edges: [...edges.current.values()] });
      setModel(toGlobeModel(lens));
    }
  }, []);

  // Base graph, refreshed on an interval so new objects appear.
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const payload = await getJson<ScopedPayload>(`/api/graph/scoped?limit=${GRAPH_LIMIT}`);
        if (cancelled) return;
        merge(payload);
        setPartial(Boolean(payload.partial));
        setStatus("ready");
        setError(null);
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Graph unavailable");
        setStatus((s) => (s === "ready" ? s : "error"));
      }
    };
    void load();
    const timer = setInterval(() => void load(), GRAPH_REFRESH_MS);
    return () => { cancelled = true; clearInterval(timer); };
  }, [merge]);

  // Pull in any node an agent or event points at that the base read missed.
  const ensureNodes = useCallback(async (ids: string[]) => {
    const missing = ids.filter((id) => !nodes.current.has(id) && !attempted.current.has(id)).slice(0, 8);
    await Promise.all(missing.map(async (id) => {
      attempted.current.add(id);
      try { merge(await getJson<ScopedPayload>(`/api/graph/scoped?focus=${encodeURIComponent(id)}&depth=1`)); } catch { /* node not readable */ }
    }));
  }, [merge]);

  // Activity poll.
  useEffect(() => {
    let cancelled = false;
    let first = true;
    const poll = async () => {
      if (document.hidden) return;
      try {
        const url = cursor.current ? `/api/orrery/activity?since=${encodeURIComponent(cursor.current)}` : "/api/orrery/activity";
        const next = await getJson<OrreryActivity>(url);
        if (cancelled) return;
        cursor.current = next.cursor;
        setActivity(next);
        const fresh = next.events.filter((e) => !seen.current.has(e.id));
        fresh.forEach((e) => seen.current.add(e.id));
        await ensureNodes([...next.agents.flatMap((a) => (a.nodeId ? [a.nodeId] : [])), ...fresh.flatMap((e) => e.nodeIds)]);
        if (cancelled) return;
        if (fresh.length) setFeed((prev) => [...fresh.slice().reverse(), ...prev].slice(0, FEED_LIMIT));
        if (!first && fresh.length) onEventsRef.current(fresh);
        first = false;
      } catch { /* transient: keep the last good state and try again */ }
    };
    pollNow.current = () => void poll();
    void poll();
    const timer = setInterval(() => void poll(), ACTIVITY_POLL_MS);
    return () => { cancelled = true; clearInterval(timer); };
  }, [ensureNodes]);

  const refresh = useCallback(() => pollNow.current(), []);

  return { status, error, model, feed, activity, partial, refresh };
}
