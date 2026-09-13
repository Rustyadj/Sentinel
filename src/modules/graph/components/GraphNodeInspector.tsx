"use client";

import { useEffect, useState } from "react";
import { ArrowRight, Crosshair, Loader2 } from "lucide-react";
import { clusterOf } from "@/lib/graph/semantics";
import type { KnowledgeEdge, KnowledgeNode } from "@/lib/knowledge/types";

interface NodeDetail {
  node: KnowledgeNode;
  connections: { edge: KnowledgeEdge; node: KnowledgeNode; direction: "in" | "out" }[];
  hiddenConnections: number;
}

/**
 * The inspector answers "what is this and what is it connected to?" from real
 * edges. Connections the caller cannot read are counted, never invented.
 */
export function GraphNodeInspector({ nodeId, onFocus }: { nodeId: string; onFocus: (nodeId: string) => void }) {
  const [detail, setDetail] = useState<NodeDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      try {
        const response = await fetch(`/api/graph/node/${encodeURIComponent(nodeId)}`);
        const body = await response.json();
        if (cancelled) return;
        if (!response.ok) { setError(body.error ?? "This node could not be loaded."); setDetail(null); }
        else { setError(null); setDetail(body as NodeDetail); }
      } catch {
        if (!cancelled) setError("This node could not be loaded.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [nodeId]);

  if (loading) {
    return <p className="flex items-center gap-2 py-4 text-[13px] text-[--muted-foreground]"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…</p>;
  }
  if (error || !detail) {
    return <p className="py-4 text-[13px] text-[--destructive]">{error ?? "Unavailable."}</p>;
  }

  const grouped = detail.connections.reduce<Record<string, typeof detail.connections>>((accumulator, connection) => {
    (accumulator[connection.edge.type] ??= []).push(connection);
    return accumulator;
  }, {});

  return (
    <div className="space-y-4 py-2">
      {detail.node.summary ? (
        <p className="text-[13px] leading-relaxed text-[--foreground]">{detail.node.summary}</p>
      ) : null}

      <dl className="space-y-1 text-[12px]">
        <div className="flex justify-between gap-3">
          <dt className="text-[--muted-foreground]">Type</dt>
          <dd>{detail.node.type}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-[--muted-foreground]">Cluster</dt>
          <dd className="capitalize">{clusterOf(detail.node.type)}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-[--muted-foreground]">Scope</dt>
          <dd>{detail.node.scope}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-[--muted-foreground]">Created</dt>
          <dd>{new Date(detail.node.createdAt).toLocaleString()}</dd>
        </div>
      </dl>

      <button
        onClick={() => onFocus(detail.node.id)}
        className="flex w-full items-center justify-center gap-2 rounded-lg bg-[--muted] py-2 text-[13px] transition-colors hover:bg-[--accent]"
      >
        <Crosshair className="h-3.5 w-3.5" /> Focus graph here
      </button>

      <div>
        <p className="mb-1 text-[12px] uppercase tracking-wide text-[--muted-foreground]">
          Connections ({detail.connections.length})
        </p>
        {detail.connections.length === 0 ? (
          <p className="text-[13px] text-[--muted-foreground]">No readable connections.</p>
        ) : (
          Object.entries(grouped).map(([type, connections]) => (
            <div key={type} className="mb-2">
              <p className="text-[11px] text-[--muted-foreground]">{type.replace(/_/g, " ")}</p>
              {connections.map((connection) => (
                <button
                  key={connection.edge.id}
                  onClick={() => onFocus(connection.node.id)}
                  className="flex w-full items-center gap-2 rounded-lg px-1.5 py-1 text-left hover:bg-[--muted]"
                >
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: `var(--entity-${clusterOf(connection.node.type)})` }} />
                  <span className="min-w-0 flex-1 truncate text-[13px]">{connection.node.title}</span>
                  {connection.direction === "out" ? <ArrowRight className="h-3 w-3 shrink-0 text-[--muted-foreground]" /> : null}
                </button>
              ))}
            </div>
          ))
        )}
        {detail.hiddenConnections > 0 ? (
          <p className="mt-1 text-[12px] text-[--muted-foreground]">
            {detail.hiddenConnections} connection{detail.hiddenConnections === 1 ? "" : "s"} to objects you cannot read.
          </p>
        ) : null}
      </div>
    </div>
  );
}
