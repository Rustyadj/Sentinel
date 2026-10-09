"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { buildLensGraphFromApi } from "@/components/neural-lens/fromApiGraph";
import type { OrreryActivity, OrreryEvent } from "@/lib/orrery/types";
import { toGlobeModel, type GlobeModel } from "./globe-model";
import { applyBaseRead, applyFocusRead, composeGraph, dropFocus, emptyStore, graphSignature, type ScopedPayload } from "./reconcile-graph";

const GRAPH_LIMIT = 400;
export const GRAPH_REFRESH_MS = 45_000;
export const ACTIVITY_POLL_MS = 3_000;
const FEED_LIMIT = 60;
const SEEN_LIMIT = 600;
const FOCUS_RECHECK_LIMIT = 20;

export type OrreryStatus = "loading" | "ready" | "error";

/** How one data source is doing. A source that has failed since its last good read is `stale`, and says so. */
export interface SourceHealth {
  error: string | null;
  /** Epoch ms of the last successful read, or null if there has not been one. */
  lastOkAt: number | null;
  /** Consecutive failures since the last success. */
  failures: number;
}

const HEALTHY: SourceHealth = { error: null, lastOkAt: null, failures: 0 };

export interface OrreryData {
  status: OrreryStatus;
  error: string | null;
  model: GlobeModel | null;
  /** Newest first. Includes events from before the page opened. */
  feed: OrreryEvent[];
  activity: OrreryActivity | null;
  /** True when the scoped graph read was truncated at its limit. */
  partial: boolean;
  /** The graph read: what the globe draws. If this is failing the globe is showing the last good graph. */
  graphHealth: SourceHealth;
  /** The activity poll: agent state, the feed, run and approval cards. If failing, those are the last good values. */
  activityHealth: SourceHealth;
  /** True when the activity source reported that it had more than it could return in one page. */
  activityTruncated: boolean;
  /** Re-read activity now (e.g. after approving something). */
  refresh: () => void;
  /** Re-read everything now, graph included (the "retry" action). */
  retry: () => void;
}

class HttpError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new HttpError(res.status === 401 ? "Sign in to see the graph." : `Request failed (${res.status})`, res.status);
  return (await res.json()) as T;
}

const messageOf = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);
const failed = (prev: SourceHealth, message: string): SourceHealth => ({ error: message, lastOkAt: prev.lastOkAt, failures: prev.failures + 1 });
const ok = (): SourceHealth => ({ error: null, lastOkAt: Date.now(), failures: 0 });

/**
 * Loads the user's real knowledge graph and follows real agent activity.
 * `onEvents` receives only events that arrive after the first poll, so opening
 * the page never replays history as movement — history goes to the feed only.
 *
 * The graph is reconciled, not accumulated: a refresh replaces what was read
 * before, so renamed objects update and deleted, superseded or no-longer-readable
 * objects and edges leave the globe. Failures never blank what is on screen, but
 * they are never silent either: each source reports its own health.
 */
export function useOrreryData(onEvents: (events: OrreryEvent[]) => void): OrreryData {
  const [status, setStatus] = useState<OrreryStatus>("loading");
  const [model, setModel] = useState<GlobeModel | null>(null);
  const [partial, setPartial] = useState(false);
  const [feed, setFeed] = useState<OrreryEvent[]>([]);
  const [activity, setActivity] = useState<OrreryActivity | null>(null);
  const [activityTruncated, setActivityTruncated] = useState(false);
  const [graphHealth, setGraphHealth] = useState<SourceHealth>(HEALTHY);
  const [activityHealth, setActivityHealth] = useState<SourceHealth>(HEALTHY);

  const store = useRef(emptyStore());
  const signature = useRef<string | null>(null);
  const attempted = useRef(new Set<string>());
  const seen = useRef(new Set<string>());
  const cursor = useRef<string | undefined>(undefined);
  const onEventsRef = useRef(onEvents);
  const pollNow = useRef<() => void>(() => undefined);
  const loadNow = useRef<() => void>(() => undefined);

  useEffect(() => { onEventsRef.current = onEvents; }, [onEvents]);

  /** Rebuild the globe model, but only if what it would draw has changed. */
  const rebuild = useCallback(() => {
    const composed = composeGraph(store.current);
    const next = graphSignature(composed);
    if (next === signature.current) return;
    signature.current = next;
    setModel(toGlobeModel(buildLensGraphFromApi({ nodes: composed.nodes, edges: composed.edges })));
  }, []);

  /** Fetch a node's neighbourhood. Returns false only when the server says the node is gone or unreadable. */
  const readFocus = useCallback(async (id: string): Promise<boolean> => {
    try {
      applyFocusRead(store.current, id, await getJson<ScopedPayload>(`/api/graph/scoped?focus=${encodeURIComponent(id)}&depth=1`));
      return true;
    } catch (e) {
      if (e instanceof HttpError && (e.status === 404 || e.status === 403)) { dropFocus(store.current, id); return false; }
      return true; // transient: keep what we have
    }
  }, []);

  // Base graph, refreshed on an interval.
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const payload = await getJson<ScopedPayload>(`/api/graph/scoped?limit=${GRAPH_LIMIT}`);
        if (cancelled) return;
        applyBaseRead(store.current, payload);
        attempted.current.clear();
        // A partial read cannot prove a focus node is gone, so ask about each one.
        if (payload.partial) {
          await Promise.all([...store.current.focus.keys()].slice(0, FOCUS_RECHECK_LIMIT).map((id) => readFocus(id)));
          if (cancelled) return;
        }
        rebuild();
        setPartial(Boolean(payload.partial));
        setStatus("ready");
        setGraphHealth(ok());
      } catch (e) {
        if (cancelled) return;
        setGraphHealth((prev) => failed(prev, messageOf(e, "Graph unavailable")));
        setStatus((s) => (s === "ready" ? s : "error"));
      }
    };
    loadNow.current = () => void load();
    void load();
    const timer = setInterval(() => void load(), GRAPH_REFRESH_MS);
    return () => { cancelled = true; clearInterval(timer); };
  }, [rebuild, readFocus]);

  // Pull in any node an agent or event points at that the base read missed.
  const ensureNodes = useCallback(async (ids: string[]) => {
    const known = new Set(composeGraph(store.current).nodes.map((n) => n.id));
    const missing = [...new Set(ids)].filter((id) => !known.has(id) && !attempted.current.has(id)).slice(0, 8);
    if (!missing.length) return;
    await Promise.all(missing.map(async (id) => { attempted.current.add(id); await readFocus(id); }));
    rebuild();
  }, [readFocus, rebuild]);

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
        setActivityTruncated(Boolean(next.truncated));
        setActivityHealth(ok());
        // The server re-offers rows at the cursor boundary; the id is what makes that safe.
        const fresh = next.events.filter((e) => !seen.current.has(e.id));
        for (const e of fresh) seen.current.add(e.id);
        if (seen.current.size > SEEN_LIMIT) seen.current = new Set([...seen.current].slice(-SEEN_LIMIT));
        await ensureNodes([...next.agents.flatMap((a) => (a.nodeId ? [a.nodeId] : [])), ...fresh.flatMap((e) => e.nodeIds)]);
        if (cancelled) return;
        if (fresh.length) setFeed((prev) => [...fresh.slice().reverse(), ...prev].slice(0, FEED_LIMIT));
        if (!first && fresh.length) onEventsRef.current(fresh);
        first = false;
      } catch (e) {
        // Keep the last good state on screen, but record that it is now stale.
        if (!cancelled) setActivityHealth((prev) => failed(prev, messageOf(e, "Activity unavailable")));
      }
    };
    pollNow.current = () => void poll();
    void poll();
    const timer = setInterval(() => void poll(), ACTIVITY_POLL_MS);
    // A hidden tab skips its polls; catch up the moment it is visible again rather than on the next tick.
    const onVisible = () => { if (!document.hidden) { void poll(); loadNow.current(); } };
    document.addEventListener("visibilitychange", onVisible);
    return () => { cancelled = true; clearInterval(timer); document.removeEventListener("visibilitychange", onVisible); };
  }, [ensureNodes]);

  const refresh = useCallback(() => pollNow.current(), []);
  const retry = useCallback(() => { pollNow.current(); loadNow.current(); }, []);

  return {
    status, error: status === "error" ? graphHealth.error : null, model, feed, activity, partial,
    graphHealth, activityHealth, activityTruncated, refresh, retry,
  };
}
