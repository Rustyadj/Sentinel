"use client";

import type { KnowledgeNode } from "@/lib/knowledge/types";

interface KnowledgeNodeDrawerProps {
  node: KnowledgeNode | null;
  onClose: () => void;
  immersive?: boolean;
}

const TYPE_COLORS: Record<string, string> = {
  Conversation: "#6366f1",
  Message: "#8b5cf6",
  Memory: "#10b981",
  Note: "#f59e0b",
  Decision: "#ef4444",
  Task: "#3b82f6",
  Agent: "#ec4899",
  Project: "#6366f1",
  Workspace: "#0891b2",
  Artifact: "#84cc16",
  File: "#64748b",
  default: "#6b7280",
};

export function KnowledgeNodeDrawer({ node, onClose, immersive = false }: KnowledgeNodeDrawerProps) {
  const isOpen = node !== null;

  return (
    <div
      className={immersive ? "absolute bottom-4 right-4 top-16 z-30 w-64 overflow-y-auto rounded-lg border border-white/10 bg-[#07101c]/90 shadow-2xl backdrop-blur-xl" : "absolute top-0 right-0 bottom-0 w-64 bg-[--card] border-l border-[--border] z-10 overflow-y-auto"}
      style={{
        transform: isOpen ? "translateX(0)" : "translateX(100%)",
        transition: "transform 0.2s ease",
        pointerEvents: isOpen ? "auto" : "none",
      }}
    >
      {node && (
        <div className="flex flex-col h-full">
          {/* Header */}
          <div className="flex items-start gap-2 p-3 border-b border-[--border]">
            <div className="flex-1 min-w-0">
              <span
                className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium mb-1"
                style={{
                  backgroundColor: (TYPE_COLORS[node.type] ?? TYPE_COLORS.default) + "22",
                  color: TYPE_COLORS[node.type] ?? TYPE_COLORS.default,
                }}
              >
                {node.type}
              </span>
              <div className="text-xs font-medium text-[--foreground] truncate">
                {node.title}
              </div>
            </div>
            <button
              onClick={onClose}
              className="shrink-0 text-[--muted-foreground] hover:text-[--foreground] transition-colors text-sm leading-none"
            >
              ✕
            </button>
          </div>

          {/* Body */}
          <div className="flex-1 p-3 space-y-3 overflow-y-auto">
            {/* Summary */}
            {node.summary && (
              <div>
                <div className="text-[10px] font-medium text-[--muted-foreground] uppercase tracking-wider mb-1">
                  Summary
                </div>
                <p className="text-xs text-[--foreground] leading-relaxed">
                  {node.summary}
                </p>
              </div>
            )}

            {/* Metadata */}
            <div>
              <div className="text-[10px] font-medium text-[--muted-foreground] uppercase tracking-wider mb-1.5">
                Details
              </div>
              <div className="space-y-1.5">
                <div className="flex justify-between gap-2">
                  <span className="text-[10px] text-[--muted-foreground]">Scope</span>
                  <span className="text-[10px] text-[--foreground] font-mono">{node.scope}</span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-[10px] text-[--muted-foreground]">Created</span>
                  <span className="text-[10px] text-[--foreground]">
                    {new Date(node.createdAt).toLocaleDateString()}
                  </span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-[10px] text-[--muted-foreground]">Type</span>
                  <span className="text-[10px] text-[--foreground]">{node.type}</span>
                </div>
              </div>
            </div>

            {/* Type-specific fields */}
            {node.type === "Decision" && node.metadata.status != null && (
              <div>
                <div className="text-[10px] font-medium text-[--muted-foreground] uppercase tracking-wider mb-1">
                  Status
                </div>
                {(() => {
                  const status = String(node.metadata.status);
                  return (
                    <span
                      className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium"
                      style={{
                        backgroundColor:
                          status === "approved"
                            ? "#10b98122"
                            : status === "rejected"
                            ? "#ef444422"
                            : "#f59e0b22",
                        color:
                          status === "approved"
                            ? "#10b981"
                            : status === "rejected"
                            ? "#ef4444"
                            : "#f59e0b",
                      }}
                    >
                      {status}
                    </span>
                  );
                })()}
              </div>
            )}

            {node.type === "Memory" && node.metadata.content != null && (
              <div>
                <div className="text-[10px] font-medium text-[--muted-foreground] uppercase tracking-wider mb-1">
                  Content
                </div>
                <p className="text-[11px] text-[--muted-foreground] leading-relaxed line-clamp-5">
                  {String(node.metadata.content)}
                </p>
              </div>
            )}

            {node.type === "Agent" && node.metadata.role != null && (
              <div>
                <div className="text-[10px] font-medium text-[--muted-foreground] uppercase tracking-wider mb-1">
                  Role
                </div>
                <p className="text-xs text-[--foreground] leading-relaxed">
                  {String(node.metadata.role)}
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
