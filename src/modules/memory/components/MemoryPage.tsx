"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Brain, Pin, Archive, Trash2, Search, Filter,
  Loader2, Sparkles, Check,
  Clock, X, RefreshCw,
  Eye, EyeOff, Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";
import { AGENT_TEMPLATES } from "@/lib/constants";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Memory {
  id: string;
  type: string;
  scope: string;
  owner: string;
  content: string;
  tags: string[];
  confidence: number;
  importanceScore: number;
  source: string;
  pinned: boolean;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
}

interface Stats {
  total: number;
  pinned: number;
  archived: number;
  byScope: { scope: string; _count: { id: number } }[];
  byType: { type: string; _count: { id: number } }[];
}

const SCOPES = ["session", "project", "workspace", "org", "user", "public"] as const;
const TYPES = ["decision", "preference", "fact", "workflow", "pattern", "instruction", "observation"] as const;

const SCOPE_COLORS: Record<string, string> = {
  session: "#f59e0b",
  project: "#6366f1",
  workspace: "#06b6d4",
  org: "#8b5cf6",
  user: "#10b981",
  public: "#64748b",
};

const TYPE_COLORS: Record<string, string> = {
  decision: "#ef4444",
  preference: "#f97316",
  fact: "#3b82f6",
  workflow: "#8b5cf6",
  pattern: "#10b981",
  instruction: "#06b6d4",
  observation: "#84cc16",
};

// ─── Confidence bar ───────────────────────────────────────────────────────────

function ConfidenceBar({ value, className }: { value: number; className?: string }) {
  const color = value >= 0.8 ? "#10b981" : value >= 0.5 ? "#f59e0b" : "#ef4444";
  return (
    <div className={cn("h-1 bg-[#e8eaf0] rounded-full overflow-hidden", className)}>
      <div className="h-full rounded-full transition-all duration-300" style={{ width: `${value * 100}%`, backgroundColor: color }} />
    </div>
  );
}

// ─── Memory card ─────────────────────────────────────────────────────────────

function MemoryCard({
  memory, selected, onSelect, onPin, onArchive, onDelete,
}: {
  memory: Memory;
  selected: boolean;
  onSelect: () => void;
  onPin: () => void;
  onArchive: () => void;
  onDelete: () => void;
}) {
  const agent = AGENT_TEMPLATES.find((a) => a.id === memory.owner);

  return (
    <div
      onClick={onSelect}
      className={cn(
        "group relative bg-white border rounded-xl p-3 cursor-pointer transition-all hover:shadow-sm",
        selected ? "border-indigo-400 ring-1 ring-indigo-400/30" : "border-[#e0e3ea] hover:border-[#c8cdd8]"
      )}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span
            className="text-[9px] font-semibold px-1.5 py-0.5 rounded-md uppercase tracking-wider"
            style={{ backgroundColor: (TYPE_COLORS[memory.type] ?? "#6366f1") + "20", color: TYPE_COLORS[memory.type] ?? "#6366f1" }}
          >
            {memory.type}
          </span>
          <span
            className="text-[9px] px-1.5 py-0.5 rounded-md uppercase tracking-wider"
            style={{ backgroundColor: (SCOPE_COLORS[memory.scope] ?? "#6366f1") + "20", color: SCOPE_COLORS[memory.scope] ?? "#6366f1" }}
          >
            {memory.scope}
          </span>
          {memory.pinned && <Pin className="w-3 h-3 text-amber-500" />}
        </div>
        {/* Actions on hover */}
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={(e) => { e.stopPropagation(); onPin(); }}
            className={cn("p-1 rounded hover:bg-[#f5f6f9] transition-colors", memory.pinned ? "text-amber-500" : "text-[#aab0c0]")}
            title={memory.pinned ? "Unpin" : "Pin"}
          >
            <Pin className="w-3 h-3" />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onArchive(); }}
            className="p-1 rounded hover:bg-[#f5f6f9] text-[#aab0c0] hover:text-[#7a8099] transition-colors"
            title="Archive"
          >
            <Archive className="w-3 h-3" />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
            className="p-1 rounded hover:bg-red-500/10 text-[#aab0c0] hover:text-red-500 transition-colors"
            title="Delete"
          >
            <Trash2 className="w-3 h-3" />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="text-xs text-[#1a1d26] leading-relaxed line-clamp-3 mb-2">
        {memory.content}
      </div>

      {/* Confidence + importance */}
      <div className="flex items-center gap-3 mb-2">
        <div className="flex-1">
          <div className="flex items-center justify-between mb-0.5">
            <span className="text-[9px] text-[#aab0c0]">Confidence</span>
            <span className="text-[9px] font-mono text-[#7a8099]">{Math.round(memory.confidence * 100)}%</span>
          </div>
          <ConfidenceBar value={memory.confidence} />
        </div>
        <div className="flex-1">
          <div className="flex items-center justify-between mb-0.5">
            <span className="text-[9px] text-[#aab0c0]">Importance</span>
            <span className="text-[9px] font-mono text-[#7a8099]">{Math.round(memory.importanceScore * 100)}%</span>
          </div>
          <div className="h-1 bg-[#e8eaf0] rounded-full overflow-hidden">
            <div className="h-full bg-indigo-400 rounded-full" style={{ width: `${memory.importanceScore * 100}%` }} />
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center gap-2">
        {agent && (
          <span className="text-[9px] text-[#7a8099] flex items-center gap-1">
            <span>{agent.avatar}</span>{agent.name}
          </span>
        )}
        <span className="text-[9px] text-[#aab0c0] ml-auto">
          {formatDistanceToNow(new Date(memory.updatedAt), { addSuffix: true })}
        </span>
      </div>

      {/* Tags */}
      {memory.tags.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-1.5">
          {memory.tags.slice(0, 4).map((t) => (
            <span key={t} className="text-[9px] bg-[#f5f6f9] text-[#7a8099] px-1.5 py-0.5 rounded-full">#{t}</span>
          ))}
          {memory.tags.length > 4 && <span className="text-[9px] text-[#aab0c0]">+{memory.tags.length - 4}</span>}
        </div>
      )}
    </div>
  );
}

// ─── Left filter panel ────────────────────────────────────────────────────────

function FilterPanel({
  scope, setScope, type, setType, owner, setOwner,
  showArchived, setShowArchived, stats,
}: {
  scope: string; setScope: (s: string) => void;
  type: string; setType: (t: string) => void;
  owner: string; setOwner: (o: string) => void;
  showArchived: boolean; setShowArchived: (v: boolean) => void;
  stats: Stats | null;
}) {
  return (
    <div className="w-52 flex flex-col h-full bg-[--sidebar] border-r border-[#181b22] overflow-hidden shrink-0">
      <div className="px-3 py-3 border-b border-[#181b22]">
        <div className="flex items-center gap-2 text-xs font-semibold text-[#5a5f6e] uppercase tracking-wider">
          <Filter className="w-3.5 h-3.5" />
          Filters
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        {/* Stats */}
        {stats && (
          <div className="grid grid-cols-2 gap-2">
            {[
              { label: "Total", value: stats.total, icon: Brain, color: "#6366f1" },
              { label: "Pinned", value: stats.pinned, icon: Pin, color: "#f59e0b" },
              { label: "Archived", value: stats.archived, icon: Archive, color: "#7a8099" },
            ].map(({ label, value, icon: Icon, color }) => (
              <div key={label} className="bg-[#0f1013] rounded-lg p-2 border border-[#1e2130]">
                <Icon className="w-3 h-3 mb-1" style={{ color }} />
                <div className="text-sm font-bold text-[#c8cdd8]">{value}</div>
                <div className="text-[9px] text-[#3a3f50]">{label}</div>
              </div>
            ))}
          </div>
        )}

        {/* Scope */}
        <div>
          <div className="text-[9px] uppercase tracking-widest text-[#3a3f50] font-medium mb-2">Scope</div>
          <div className="space-y-0.5">
            {["all", ...SCOPES].map((s) => {
              const count = s === "all" ? stats?.total : stats?.byScope.find((b) => b.scope === s)?._count.id;
              return (
                <button
                  key={s}
                  onClick={() => setScope(s)}
                  className={cn(
                    "w-full flex items-center justify-between px-2 py-1.5 rounded-lg text-xs transition-colors",
                    scope === s ? "bg-indigo-500/20 text-indigo-400" : "text-[#5a5f6e] hover:bg-white/5 hover:text-[#c8cdd8]"
                  )}
                >
                  <div className="flex items-center gap-2">
                    {s !== "all" && (
                      <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: SCOPE_COLORS[s] ?? "#6366f1" }} />
                    )}
                    <span className="capitalize">{s}</span>
                  </div>
                  {count != null && <span className="text-[10px] opacity-60">{count}</span>}
                </button>
              );
            })}
          </div>
        </div>

        {/* Type */}
        <div>
          <div className="text-[9px] uppercase tracking-widest text-[#3a3f50] font-medium mb-2">Type</div>
          <div className="space-y-0.5">
            {["all", ...TYPES].map((t) => {
              const count = t === "all" ? stats?.total : stats?.byType.find((b) => b.type === t)?._count.id;
              return (
                <button
                  key={t}
                  onClick={() => setType(t)}
                  className={cn(
                    "w-full flex items-center justify-between px-2 py-1.5 rounded-lg text-xs transition-colors",
                    type === t ? "bg-indigo-500/20 text-indigo-400" : "text-[#5a5f6e] hover:bg-white/5 hover:text-[#c8cdd8]"
                  )}
                >
                  <div className="flex items-center gap-2">
                    {t !== "all" && (
                      <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: TYPE_COLORS[t] ?? "#6366f1" }} />
                    )}
                    <span className="capitalize">{t}</span>
                  </div>
                  {count != null && <span className="text-[10px] opacity-60">{count}</span>}
                </button>
              );
            })}
          </div>
        </div>

        {/* Owner */}
        <div>
          <div className="text-[9px] uppercase tracking-widest text-[#3a3f50] font-medium mb-2">Agent</div>
          <div className="space-y-0.5">
            {["all", ...AGENT_TEMPLATES.map((a) => a.id)].map((o) => {
              const agent = AGENT_TEMPLATES.find((a) => a.id === o);
              return (
                <button
                  key={o}
                  onClick={() => setOwner(o)}
                  className={cn(
                    "w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs transition-colors",
                    owner === o ? "bg-indigo-500/20 text-indigo-400" : "text-[#5a5f6e] hover:bg-white/5 hover:text-[#c8cdd8]"
                  )}
                >
                  {agent ? (
                    <>
                      <span className="text-sm">{agent.avatar}</span>
                      <span className="truncate">{agent.name}</span>
                    </>
                  ) : (
                    <span>All Agents</span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Archived toggle */}
        <div>
          <button
            onClick={() => setShowArchived(!showArchived)}
            className={cn(
              "w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs transition-colors",
              showArchived ? "bg-[#7a8099]/20 text-[#7a8099]" : "text-[#3a3f50] hover:bg-white/5 hover:text-[#5a5f6e]"
            )}
          >
            {showArchived ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
            {showArchived ? "Showing archived" : "Show archived"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Right detail panel ───────────────────────────────────────────────────────

function DetailPanel({
  memory, onPin, onArchive, onDelete, onUpdate,
}: {
  memory: Memory;
  onPin: () => void;
  onArchive: () => void;
  onDelete: () => void;
  onUpdate: (updates: Partial<Memory>) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [editContent, setEditContent] = useState(memory.content);
  const agent = AGENT_TEMPLATES.find((a) => a.id === memory.owner);

  async function save() {
    await fetch(`/api/memories/${memory.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: editContent }),
    });
    onUpdate({ content: editContent });
    setEditing(false);
  }

  return (
    <div className="w-72 flex flex-col h-full bg-[#f5f6f9] border-l border-[#e0e3ea] overflow-hidden shrink-0">
      {/* Header */}
      <div className="px-3 py-3 border-b border-[#e0e3ea] flex items-center justify-between">
        <div className="text-[9px] uppercase tracking-widest text-[#aab0c0] font-medium">Memory Detail</div>
        <div className="flex items-center gap-1">
          <button
            onClick={onPin}
            className={cn("p-1.5 rounded-lg transition-colors", memory.pinned ? "text-amber-500 bg-amber-500/10" : "text-[#aab0c0] hover:bg-[#e8eaf0]")}
            title={memory.pinned ? "Unpin" : "Pin"}
          >
            <Pin className="w-3.5 h-3.5" />
          </button>
          <button onClick={onArchive} className="p-1.5 rounded-lg text-[#aab0c0] hover:bg-[#e8eaf0] transition-colors" title="Archive">
            <Archive className="w-3.5 h-3.5" />
          </button>
          <button onClick={onDelete} className="p-1.5 rounded-lg text-[#aab0c0] hover:text-red-500 hover:bg-red-500/10 transition-colors" title="Delete">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        {/* Badges */}
        <div className="flex flex-wrap gap-1.5">
          <span className="text-[10px] font-semibold px-2 py-1 rounded-lg" style={{ backgroundColor: (TYPE_COLORS[memory.type] ?? "#6366f1") + "20", color: TYPE_COLORS[memory.type] ?? "#6366f1" }}>
            {memory.type}
          </span>
          <span className="text-[10px] px-2 py-1 rounded-lg" style={{ backgroundColor: (SCOPE_COLORS[memory.scope] ?? "#6366f1") + "20", color: SCOPE_COLORS[memory.scope] ?? "#6366f1" }}>
            {memory.scope}
          </span>
        </div>

        {/* Content */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <div className="text-[9px] uppercase tracking-widest text-[#aab0c0] font-medium">Content</div>
            <button
              onClick={() => { setEditing(!editing); setEditContent(memory.content); }}
              className="text-[10px] text-indigo-500 hover:underline"
            >
              {editing ? "Cancel" : "Edit"}
            </button>
          </div>
          {editing ? (
            <div className="space-y-2">
              <textarea
                value={editContent}
                onChange={(e) => setEditContent(e.target.value)}
                className="w-full text-xs text-[#1a1d26] bg-white border border-[#e0e3ea] rounded-lg p-2 resize-none outline-none focus:border-indigo-400 min-h-[100px]"
              />
              <button onClick={save} className="w-full bg-indigo-600 hover:bg-indigo-700 text-white text-xs rounded-lg py-1.5 transition-colors">
                Save
              </button>
            </div>
          ) : (
            <div className="text-xs text-[#1a1d26] leading-relaxed bg-white rounded-lg p-2.5 border border-[#e0e3ea]">
              {memory.content}
            </div>
          )}
        </div>

        {/* Metrics */}
        <div className="space-y-3">
          <div>
            <div className="flex items-center justify-between mb-1">
              <div className="text-[9px] uppercase tracking-widest text-[#aab0c0] font-medium">Confidence</div>
              <div className="text-[10px] font-mono text-[#1a1d26]">{Math.round(memory.confidence * 100)}%</div>
            </div>
            <ConfidenceBar value={memory.confidence} />
          </div>
          <div>
            <div className="flex items-center justify-between mb-1">
              <div className="text-[9px] uppercase tracking-widest text-[#aab0c0] font-medium">Importance</div>
              <div className="text-[10px] font-mono text-[#1a1d26]">{Math.round(memory.importanceScore * 100)}%</div>
            </div>
            <div className="h-1.5 bg-[#e8eaf0] rounded-full overflow-hidden">
              <div className="h-full bg-indigo-400 rounded-full" style={{ width: `${memory.importanceScore * 100}%` }} />
            </div>
          </div>
        </div>

        {/* Source + Agent */}
        <div className="space-y-2">
          <div className="bg-white rounded-lg p-2.5 border border-[#e0e3ea] space-y-1.5">
            <div className="flex items-center gap-2">
              <Zap className="w-3 h-3 text-[#aab0c0] shrink-0" />
              <span className="text-[10px] text-[#7a8099]">Source: <span className="text-[#1a1d26]">{memory.source}</span></span>
            </div>
            {agent && (
              <div className="flex items-center gap-2">
                <span className="text-sm">{agent.avatar}</span>
                <span className="text-[10px] text-[#7a8099]">Owner: <span className="text-[#1a1d26]">{agent.name}</span></span>
              </div>
            )}
            <div className="flex items-center gap-2">
              <Clock className="w-3 h-3 text-[#aab0c0] shrink-0" />
              <span className="text-[10px] text-[#7a8099]">{formatDistanceToNow(new Date(memory.createdAt), { addSuffix: true })}</span>
            </div>
          </div>
        </div>

        {/* Tags */}
        <div>
          <div className="text-[9px] uppercase tracking-widest text-[#aab0c0] font-medium mb-1.5">Tags</div>
          <div className="flex flex-wrap gap-1">
            {memory.tags.map((t) => (
              <span key={t} className="text-[10px] bg-indigo-500/10 text-indigo-600 px-2 py-0.5 rounded-full">#{t}</span>
            ))}
            {memory.tags.length === 0 && <span className="text-[10px] text-[#aab0c0]">No tags</span>}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Main MemoryPage ──────────────────────────────────────────────────────────

export function MemoryPage() {
  const [memories, setMemories] = useState<Memory[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [selectedMemory, setSelectedMemory] = useState<Memory | null>(null);
  const [search, setSearch] = useState("");
  const [scope, setScope] = useState("all");
  const [type, setType] = useState("all");
  const [owner, setOwner] = useState("all");
  const [showArchived, setShowArchived] = useState(false);
  const [loading, setLoading] = useState(true);
  const [reflecting, setReflecting] = useState(false);
  const [reflectResult, setReflectResult] = useState<{ duplicatesArchived: number } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (scope !== "all") params.set("scope", scope);
    if (type !== "all") params.set("type", type);
    if (owner !== "all") params.set("owner", owner);
    if (search) params.set("q", search);
    if (showArchived) params.set("archived", "true");

    const [mems, st] = await Promise.all([
      fetch(`/api/memories?${params.toString()}`).then((r) => r.json()).catch(() => []),
      fetch("/api/memories/stats").then((r) => r.json()).catch(() => null),
    ]);
    setMemories(mems as Memory[]);
    setStats(st as Stats | null);
    setLoading(false);
  }, [scope, type, owner, search, showArchived]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);

  async function runReflection() {
    setReflecting(true);
    try {
      const res = await fetch("/api/memories/reflect", { method: "POST" });
      const data = await res.json() as { duplicatesArchived: number };
      setReflectResult(data);
      setTimeout(() => setReflectResult(null), 4000);
      await load();
    } finally {
      setReflecting(false);
    }
  }

  async function handlePin(memory: Memory) {
    const updated = { ...memory, pinned: !memory.pinned };
    setMemories((prev) => prev.map((m) => m.id === memory.id ? updated : m));
    if (selectedMemory?.id === memory.id) setSelectedMemory(updated);
    await fetch(`/api/memories/${memory.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pinned: !memory.pinned }),
    });
  }

  async function handleArchive(memory: Memory) {
    setMemories((prev) => prev.filter((m) => m.id !== memory.id));
    if (selectedMemory?.id === memory.id) setSelectedMemory(null);
    await fetch(`/api/memories/${memory.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ archived: true }),
    });
    await load();
  }

  async function handleDelete(memory: Memory) {
    setMemories((prev) => prev.filter((m) => m.id !== memory.id));
    if (selectedMemory?.id === memory.id) setSelectedMemory(null);
    await fetch(`/api/memories/${memory.id}`, { method: "DELETE" });
    await load();
  }

  function handleUpdate(id: string, updates: Partial<Memory>) {
    const mem = memories.find((m) => m.id === id);
    if (!mem) return;
    const updated = { ...mem, ...updates };
    setMemories((prev) => prev.map((m) => m.id === id ? updated : m));
    if (selectedMemory?.id === id) setSelectedMemory(updated);
  }

  return (
    <div className="h-full flex overflow-hidden">
      {/* Left filter panel */}
      <FilterPanel
        scope={scope} setScope={setScope}
        type={type} setType={setType}
        owner={owner} setOwner={setOwner}
        showArchived={showArchived} setShowArchived={setShowArchived}
        stats={stats}
      />

      {/* Center: Memory list */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-[#e0e3ea] bg-white shrink-0">
          <div className="flex items-center gap-2 bg-[#f5f6f9] border border-[#e0e3ea] rounded-xl px-3 py-2 flex-1 max-w-md focus-within:border-indigo-400 focus-within:ring-1 focus-within:ring-indigo-400/20 transition-all">
            <Search className="w-3.5 h-3.5 text-[#aab0c0] shrink-0" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search memories…"
              className="flex-1 bg-transparent text-sm text-[#1a1d26] placeholder:text-[#aab0c0] outline-none"
            />
            {search && (
              <button onClick={() => setSearch("")}>
                <X className="w-3.5 h-3.5 text-[#aab0c0] hover:text-[#7a8099]" />
              </button>
            )}
          </div>

          <div className="flex items-center gap-2 ml-auto">
            {reflectResult && (
              <div className="flex items-center gap-1.5 text-xs text-emerald-600 bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-1.5 rounded-lg">
                <Check className="w-3.5 h-3.5" />
                {reflectResult.duplicatesArchived} duplicates archived
              </div>
            )}
            <button
              onClick={runReflection}
              disabled={reflecting}
              className="flex items-center gap-1.5 text-xs text-[#7a8099] hover:text-[#1a1d26] bg-[#f5f6f9] hover:bg-[#eceef5] border border-[#e0e3ea] rounded-lg px-2.5 py-1.5 transition-colors disabled:opacity-50"
            >
              {reflecting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
              Reflect
            </button>
            <button
              onClick={load}
              className="p-2 rounded-lg text-[#aab0c0] hover:bg-[#f5f6f9] hover:text-[#7a8099] transition-colors"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Memory list */}
        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="flex items-center justify-center h-full">
              <Loader2 className="w-6 h-6 text-[#aab0c0] animate-spin" />
            </div>
          ) : memories.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center">
              <Brain className="w-12 h-12 text-[#c8cdd8] mb-3" />
              <div className="text-sm font-semibold text-[#1a1d26] mb-1">No memories yet</div>
              <div className="text-xs text-[#aab0c0]">Memories are created as agents work</div>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-2 max-w-2xl">
              {memories.map((mem) => (
                <MemoryCard
                  key={mem.id}
                  memory={mem}
                  selected={selectedMemory?.id === mem.id}
                  onSelect={() => setSelectedMemory(mem)}
                  onPin={() => handlePin(mem)}
                  onArchive={() => handleArchive(mem)}
                  onDelete={() => handleDelete(mem)}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Right: Detail panel */}
      {selectedMemory ? (
        <DetailPanel
          memory={selectedMemory}
          onPin={() => handlePin(selectedMemory)}
          onArchive={() => handleArchive(selectedMemory)}
          onDelete={() => handleDelete(selectedMemory)}
          onUpdate={(updates) => handleUpdate(selectedMemory.id, updates)}
        />
      ) : (
        <div className="w-72 flex items-center justify-center bg-[#f5f6f9] border-l border-[#e0e3ea] shrink-0">
          <div className="text-center px-6">
            <Brain className="w-10 h-10 text-[#c8cdd8] mx-auto mb-2" />
            <div className="text-xs text-[#aab0c0]">Select a memory to inspect</div>
          </div>
        </div>
      )}
    </div>
  );
}
