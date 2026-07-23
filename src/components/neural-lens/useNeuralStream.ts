"use client";

import { useEffect, useRef, useState } from "react";

export interface NeuralStreamEvent {
  id: string;
  type: string;
  payload: unknown;
  projectId: string | null;
  createdAt: string;
}

export interface NeuralStreamState {
  connected: boolean;
  /** Most-recent events, newest first, capped. */
  events: NeuralStreamEvent[];
  lastEventAt: number | null;
}

const MAX_BUFFERED = 40;

/**
 * Subscribe to /api/neural/stream via EventSource. Merges incoming
 * KnowledgeEvents into a small rolling buffer the graph consumes to pulse
 * affected nodes. Polling is not the client's concern — it just reacts to
 * pushed events. Gracefully degrades: if the stream errors, `connected` flips
 * false and the caller falls back to its own refresh cadence.
 */
export function useNeuralStream(opts: { projectId?: string; enabled?: boolean } = {}): NeuralStreamState {
  const { projectId, enabled = true } = opts;
  const [connected, setConnected] = useState(false);
  const [events, setEvents] = useState<NeuralStreamEvent[]>([]);
  const [lastEventAt, setLastEventAt] = useState<number | null>(null);
  const sourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;

    const url = projectId
      ? `/api/neural/stream?projectId=${encodeURIComponent(projectId)}`
      : "/api/neural/stream";

    let source: EventSource | null = null;
    try {
      source = new EventSource(url);
    } catch {
      // EventSource unsupported/unavailable — stay disconnected; the caller
      // falls back to its own refresh cadence. (Initial state is already
      // disconnected, so no synchronous setState needed here.)
      return;
    }
    sourceRef.current = source;

    source.addEventListener("ready", () => setConnected(true));
    source.addEventListener("heartbeat", () => setConnected(true));
    source.addEventListener("knowledge-event", (ev) => {
      try {
        const data = JSON.parse((ev as MessageEvent).data) as NeuralStreamEvent;
        setEvents((prev) => [data, ...prev].slice(0, MAX_BUFFERED));
        setLastEventAt(Date.now());
      } catch {
        /* ignore malformed frame */
      }
    });
    source.onerror = () => setConnected(false);

    return () => {
      source?.close();
      sourceRef.current = null;
      setConnected(false);
    };
  }, [projectId, enabled]);

  return { connected, events, lastEventAt };
}
