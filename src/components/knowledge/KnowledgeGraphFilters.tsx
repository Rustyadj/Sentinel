"use client";

const NODE_COLORS: Record<string, string> = {
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

interface KnowledgeGraphFiltersProps {
  search: string;
  onSearchChange: (v: string) => void;
  activeTypes: Set<string>;
  onToggleType: (type: string) => void;
  nodeTypes: string[];
}

export function KnowledgeGraphFilters({
  search,
  onSearchChange,
  activeTypes,
  onToggleType,
  nodeTypes,
}: KnowledgeGraphFiltersProps) {
  return (
    <div className="space-y-2">
      <input
        type="text"
        value={search}
        onChange={(e) => onSearchChange(e.target.value)}
        placeholder="Search nodes…"
        className="w-full h-7 px-2.5 text-xs rounded-md bg-[--muted] border border-[--border] text-[--foreground] placeholder:text-[--muted-foreground] outline-none focus:border-[--primary] transition-colors"
      />
      {nodeTypes.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {nodeTypes.map((type) => {
            const isActive = activeTypes.has(type);
            const color = NODE_COLORS[type] ?? NODE_COLORS.default;
            return (
              <button
                key={type}
                onClick={() => onToggleType(type)}
                className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] border transition-colors"
                style={{
                  borderColor: isActive ? color : "var(--border)",
                  backgroundColor: isActive ? color + "22" : "transparent",
                  color: isActive ? color : "var(--muted-foreground)",
                }}
              >
                <span
                  className="w-1.5 h-1.5 rounded-full shrink-0"
                  style={{ backgroundColor: color }}
                />
                {type}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
