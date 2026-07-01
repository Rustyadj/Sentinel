"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  Search,
  LayoutDashboard,
  MessageSquare,
  Bot,
  BookOpen,
  Brain,
  Sparkles,
  Shield,
  GitBranch,
  Kanban,
  BarChart3,
  Settings,
  Network,
  Cpu,
  Zap,
  ArrowRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/store/useAppStore";
import { moduleRegistry } from "@/lib/modules";
import type { LucideIcon } from "lucide-react";

const ICON_MAP: Record<string, LucideIcon> = {
  LayoutDashboard, MessageSquare, Bot, BookOpen, Brain, Sparkles, Shield,
  GitBranch, Kanban, BarChart3, Settings, Network, Cpu,
};

interface CommandItem {
  id: string;
  label: string;
  description?: string;
  icon: LucideIcon;
  action: () => void;
  group: "navigation" | "actions" | "agents";
  keywords?: string[];
}

export function CommandPalette() {
  const router = useRouter();
  const { commandBarOpen, setCommandBarOpen } = useAppStore();
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const modules = moduleRegistry.getAll();

  const navCommands: CommandItem[] = modules.map((mod) => ({
    id: `nav-${mod.id}`,
    label: mod.label,
    description: mod.description,
    icon: ICON_MAP[mod.icon] ?? LayoutDashboard,
    action: () => { router.push(mod.href); setCommandBarOpen(false); },
    group: "navigation" as const,
    keywords: [mod.id, mod.href],
  }));

  const actionCommands: CommandItem[] = [
    {
      id: "action-new-chat",
      label: "New Chat",
      description: "Start a new conversation with an agent",
      icon: MessageSquare,
      action: () => { router.push("/chat"); setCommandBarOpen(false); },
      group: "actions",
      keywords: ["chat", "conversation", "message"],
    },
    {
      id: "action-new-agent",
      label: "New Agent",
      description: "Configure and deploy a new Hermes agent",
      icon: Bot,
      action: () => { router.push("/agents"); setCommandBarOpen(false); },
      group: "actions",
      keywords: ["agent", "hermes", "bot", "ai"],
    },
    {
      id: "action-build",
      label: "Build with AI",
      description: "Open AI Studio build engine",
      icon: Sparkles,
      action: () => { router.push("/builder"); setCommandBarOpen(false); },
      group: "actions",
      keywords: ["build", "studio", "create", "generate"],
    },
    {
      id: "action-settings",
      label: "Settings",
      description: "Manage API keys, profile, and preferences",
      icon: Settings,
      action: () => { router.push("/settings"); setCommandBarOpen(false); },
      group: "actions",
      keywords: ["settings", "preferences", "api", "keys"],
    },
  ];

  const allCommands = [...navCommands, ...actionCommands];

  const filtered = query.trim()
    ? allCommands.filter((cmd) => {
        const q = query.toLowerCase();
        return (
          cmd.label.toLowerCase().includes(q) ||
          cmd.description?.toLowerCase().includes(q) ||
          cmd.keywords?.some((k) => k.toLowerCase().includes(q))
        );
      })
    : allCommands;

  const grouped = {
    navigation: filtered.filter((c) => c.group === "navigation"),
    actions: filtered.filter((c) => c.group === "actions"),
  };

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (commandBarOpen) {
      setQuery("");
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [commandBarOpen]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);
  /* eslint-enable react-hooks/set-state-in-effect */

  /* eslint-disable react-hooks/preserve-manual-memoization */
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      setCommandBarOpen(false);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      filtered[selectedIndex]?.action();
    }
  }, [filtered, selectedIndex, setCommandBarOpen]);
  /* eslint-enable react-hooks/preserve-manual-memoization */

  // Global ⌘K listener
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setCommandBarOpen(!commandBarOpen);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [commandBarOpen, setCommandBarOpen]);

  if (!commandBarOpen) return null;

  let flatIndex = 0;
  function renderGroup(label: string, items: CommandItem[]) {
    if (items.length === 0) return null;
    return (
      <div key={label}>
        <div className="px-3 py-1.5">
          <span className="text-[9px] uppercase tracking-widest font-medium text-[#3a3f50]">{label}</span>
        </div>
        {items.map((cmd) => {
          const idx = flatIndex++;
          const isSelected = idx === selectedIndex;
          const Icon = cmd.icon;
          return (
            <button
              key={cmd.id}
              onClick={cmd.action}
              onMouseEnter={() => setSelectedIndex(idx)}
              className={cn(
                "w-full flex items-center gap-3 px-3 py-2 transition-colors text-left",
                isSelected ? "bg-indigo-500/15" : "hover:bg-white/3"
              )}
            >
              <div className={cn(
                "w-8 h-8 rounded-lg flex items-center justify-center shrink-0 border",
                isSelected
                  ? "bg-indigo-500/20 border-indigo-500/30 text-indigo-400"
                  : "bg-[#0f1117] border-[#1e2130] text-[#5a5f6e]"
              )}>
                <Icon className="w-4 h-4" />
              </div>
              <div className="min-w-0 flex-1">
                <div className={cn("text-sm font-medium", isSelected ? "text-indigo-300" : "text-[#c8cdd8]")}>
                  {cmd.label}
                </div>
                {cmd.description && (
                  <div className="text-xs text-[#5a5f6e] truncate">{cmd.description}</div>
                )}
              </div>
              {isSelected && <ArrowRight className="w-3.5 h-3.5 text-indigo-400 shrink-0" />}
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]"
      onClick={(e) => { if (e.target === e.currentTarget) setCommandBarOpen(false); }}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

      {/* Panel */}
      <div className="relative w-full max-w-xl mx-4 bg-[#0c0e12] border border-[#1e2130] rounded-2xl shadow-2xl overflow-hidden">
        {/* Search input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-[#181b22]">
          <Search className="w-4 h-4 text-[#5a5f6e] shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search commands, modules, agents…"
            className="flex-1 bg-transparent text-sm text-[#c8cdd8] placeholder:text-[#3a3f50] outline-none"
          />
          {query && (
            <button
              onClick={() => setQuery("")}
              className="text-[10px] text-[#3a3f50] hover:text-[#7a8099] transition-colors"
            >
              Clear
            </button>
          )}
          <kbd className="text-[10px] text-[#3a3f50] border border-[#1e2130] rounded px-1.5 py-0.5 font-mono">
            ESC
          </kbd>
        </div>

        {/* Results */}
        <div ref={listRef} className="overflow-y-auto max-h-96 py-1">
          {filtered.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-[#3a3f50]">
              No results for &ldquo;{query}&rdquo;
            </div>
          ) : (
            <>
              {renderGroup("Navigation", grouped.navigation)}
              {renderGroup("Actions", grouped.actions)}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-[#181b22] px-4 py-2 flex items-center gap-3 text-[10px] text-[#3a3f50]">
          <span className="flex items-center gap-1">
            <Zap className="w-2.5 h-2.5" /> Sentinel OS Command Palette
          </span>
          <span className="ml-auto flex items-center gap-2">
            <kbd className="border border-[#1e2130] rounded px-1 font-mono">↑↓</kbd> navigate
            <kbd className="border border-[#1e2130] rounded px-1 font-mono">↵</kbd> open
          </span>
        </div>
      </div>
    </div>
  );
}
