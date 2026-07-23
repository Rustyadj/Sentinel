"use client";

import { useEffect, useMemo } from "react";
import { ArrowUpRight, Crosshair, MessageSquarePlus, X } from "lucide-react";
import { format } from "date-fns";
import { useGraphStore } from "@/store/useGraphStore";
import { nodeColor } from "@/lib/graph/theme";
import type { KnowledgeNode, KnowledgeEdge } from "@/lib/knowledge/types";

interface NodeInspectorProps {
  nodes: KnowledgeNode[];
  edges: KnowledgeEdge[];
  /** Push this node's context into the chat composer. */
  onSendToChat: (node: KnowledgeNode) => void;
}

/** Contextual inspector for the selected graph node. */
export function NodeInspector({ nodes, edges, onSendToChat }: NodeInspectorProps) {
  const { selectedNodeId, selectNode, requestFocus, setFocusMode } = useGraphStore();

  const node = useMemo(
    () => nodes.find((n) => n.id === selectedNodeId) ?? null,
    [nodes, selectedNodeId]
  );

  const connections = useMemo(() => {
    if (!node) return [];
    const list: Array<{ edge: KnowledgeEdge; neighbor: KnowledgeNode }> = [];
    for (const edge of edges) {
      const neighborId =
        edge.fromObjectId === node.id
          ? edge.toObjectId
          : edge.toObjectId === node.id
            ? edge.fromObjectId
            : null;
      if (!neighborId) continue;
      const neighbor = nodes.find((n) => n.id === neighborId);
      if (neighbor) list.push({ edge, neighbor });
    }
    return list.slice(0, 12);
  }, [node, nodes, edges]);

  // Esc closes the inspector
  useEffect(() => {
    if (!node) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") selectNode(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [node, selectNode]);

  if (!node) return null;

  const color = nodeColor(node);

  return (
    <aside
      aria-label={`Inspector: ${node.title}`}
      className="pointer-events-auto absolute bottom-12 right-4 top-16 z-30 flex w-[280px] flex-col overflow-hidden rounded-xl border border-white/[0.07] bg-[#0b0f17]/85 shadow-[0_24px_80px_rgba(0,0,0,0.55)] backdrop-blur-2xl animate-slide-in-right"
    >
      <header className="flex shrink-0 items-start gap-2.5 border-b border-white/[0.06] p-3">
        <span
          aria-hidden
          className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full"
          style={{ backgroundColor: color, boxShadow: `0 0 10px ${color}66` }}
        />
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-medium leading-snug text-[#e8eaed]">
            {node.title}
          </div>
          <div className="mt-0.5 flex items-center gap-1.5">
            <span className="rounded bg-white/[0.05] px-1 py-0.5 font-mono text-[8.5px] uppercase tracking-wide text-[#9aa1b4]">
              {node.type}
            </span>
            <span className="text-[9px] text-[#4a5065]">{node.scope}</span>
          </div>
        </div>
        <button
          type="button"
          onClick={() => selectNode(null)}
          aria-label="Close inspector"
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[#697084] outline-none transition-colors hover:bg-white/[0.06] hover:text-[#c8cdd8] focus-visible:ring-2 focus-visible:ring-indigo-400/60"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </header>

      <div className="flex-1 overflow-y-auto p-3">
        {node.summary && (
          <p className="mb-3 text-[11.5px] leading-relaxed text-[#9aa1b4]">{node.summary}</p>
        )}

        <dl className="mb-3 space-y-1 text-[10.5px]">
          <div className="flex justify-between">
            <dt className="text-[#4a5065]">Created</dt>
            <dd className="text-[#9aa1b4]">
              {format(new Date(node.createdAt), "MMM d, yyyy")}
            </dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-[#4a5065]">Connections</dt>
            <dd className="text-[#9aa1b4]">{connections.length}</dd>
          </div>
        </dl>

        {connections.length > 0 && (
          <>
            <div className="mb-1.5 text-[9px] font-semibold uppercase tracking-[0.12em] text-[#4a5065]">
              Linked
            </div>
            <ul className="space-y-0.5">
              {connections.map(({ edge, neighbor }) => (
                <li key={edge.id}>
                  <button
                    type="button"
                    onClick={() => requestFocus(neighbor.title)}
                    className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left outline-none transition-colors hover:bg-white/[0.04] focus-visible:ring-2 focus-visible:ring-indigo-400/60"
                  >
                    <span
                      aria-hidden
                      className="h-1.5 w-1.5 shrink-0 rounded-full"
                      style={{ backgroundColor: nodeColor(neighbor) }}
                    />
                    <span className="min-w-0 flex-1 truncate text-[11px] text-[#c8cdd8]">
                      {neighbor.title}
                    </span>
                    <span className="shrink-0 font-mono text-[8px] text-[#4a5065]">
                      {edge.type.replace(/_/g, " ")}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      <footer className="flex shrink-0 gap-1.5 border-t border-white/[0.06] p-2.5">
        <button
          type="button"
          onClick={() => onSendToChat(node)}
          className="flex h-7 flex-1 items-center justify-center gap-1.5 rounded-md bg-indigo-500/80 text-[11px] font-medium text-white outline-none transition-colors hover:bg-indigo-500 focus-visible:ring-2 focus-visible:ring-indigo-400/60"
        >
          <MessageSquarePlus className="h-3 w-3" />
          Send to chat
        </button>
        <button
          type="button"
          onClick={() => {
            setFocusMode(true);
            requestFocus(node.title);
          }}
          aria-label="Focus this node"
          title="Focus this node"
          className="flex h-7 w-7 items-center justify-center rounded-md border border-white/[0.07] text-[#9aa1b4] outline-none transition-colors hover:bg-white/[0.06] hover:text-[#e8eaed] focus-visible:ring-2 focus-visible:ring-indigo-400/60"
        >
          <Crosshair className="h-3 w-3" />
        </button>
        <button
          type="button"
          aria-label="Open source"
          title="Open source"
          className="flex h-7 w-7 items-center justify-center rounded-md border border-white/[0.07] text-[#9aa1b4] outline-none transition-colors hover:bg-white/[0.06] hover:text-[#e8eaed] focus-visible:ring-2 focus-visible:ring-indigo-400/60"
        >
          <ArrowUpRight className="h-3 w-3" />
        </button>
      </footer>
    </aside>
  );
}
