"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { useShellStore } from "@/store/useShellStore";
import { ENTITY_TOKEN, type EntityType } from "./primitives";

interface PaletteItem {
  id: string;
  group: string;
  type: EntityType | "action";
  label: string;
  hint?: string;
  run: () => void;
}

const ACTION_COLOR = "var(--muted-foreground)";

/**
 * One search surface for commands and real Sentinel entities. Every result
 * below the Commands group comes from a live API — nothing here is seeded with
 * example data, and a source that fails simply contributes no results.
 */
export function CommandPalette() {
  const router = useRouter();
  const { commandPaletteOpen, setCommandPaletteOpen } = useShellStore();
  const [query, setQuery] = useState("");
  const [entities, setEntities] = useState<PaletteItem[]>([]);
  const [cursor, setCursor] = useState(0);
  const [searching, setSearching] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const close = useCallback(() => {
    setCommandPaletteOpen(false);
    setQuery("");
    setEntities([]);
    setCursor(0);
  }, [setCommandPaletteOpen]);

  const go = useCallback((href: string) => { close(); router.push(href); }, [close, router]);

  const commands: PaletteItem[] = useMemo(() => [
    { id: "cmd-new-chat", group: "Commands", type: "action", label: "New chat", hint: "Ctrl/Cmd + N", run: () => go("/chat?new=1") },
    { id: "cmd-chat", group: "Commands", type: "action", label: "Open Chat", run: () => go("/chat") },
    { id: "cmd-graph", group: "Commands", type: "action", label: "Open Graph", hint: "Ctrl/Cmd + Shift + G", run: () => go("/graph") },
    { id: "cmd-workspaces", group: "Commands", type: "action", label: "Open Workspaces", hint: "Ctrl/Cmd + Shift + W", run: () => go("/agent-workspaces") },
    { id: "cmd-agents", group: "Commands", type: "action", label: "Open Agents", run: () => go("/agents") },
    { id: "cmd-bots", group: "Commands", type: "action", label: "Open Bots", run: () => go("/bots") },
    { id: "cmd-tasks", group: "Commands", type: "action", label: "Open Tasks", run: () => go("/tasks") },
    { id: "cmd-memory", group: "Commands", type: "action", label: "Open Memory", run: () => go("/memory") },
    { id: "cmd-domain-workspaces", group: "Commands", type: "action", label: "Open domain workspaces", hint: "Organization, security, studio", run: () => go("/workspaces") },
    { id: "cmd-activity", group: "Commands", type: "action", label: "Open Activity", run: () => go("/activity") },
    { id: "cmd-control", group: "Commands", type: "action", label: "Open Control", hint: "Releases and drift", run: () => go("/control") },
    { id: "cmd-search", group: "Commands", type: "action", label: "Search everything", run: () => go("/search") },
    { id: "cmd-settings", group: "Commands", type: "action", label: "Open Settings", run: () => go("/settings") },
  ], [go]);

  useEffect(() => {
    if (commandPaletteOpen) inputRef.current?.focus();
  }, [commandPaletteOpen]);

  // Live entity lookup, debounced. Each source is independent: one failing
  // endpoint never blanks the others, and none of them are ever faked.
  useEffect(() => {
    if (!commandPaletteOpen) return;
    const term = query.trim();
    let cancelled = false;
    if (term.length < 2) {
      const clear = setTimeout(() => { if (!cancelled) { setEntities([]); setSearching(false); } }, 0);
      return () => { cancelled = true; clearTimeout(clear); };
    }

    const timer = setTimeout(async () => {
      setSearching(true);
      const collected: PaletteItem[] = [];
      const lower = term.toLowerCase();

      const sources: { group: string; type: EntityType; url: string; pick: (body: unknown) => { id: string; label: string; hint?: string; href: string }[] }[] = [
        {
          group: "Agents", type: "agent", url: "/api/agents",
          pick: (body) => (Array.isArray(body) ? body : []).map((row: Record<string, unknown>) => ({
            id: String(row.id), label: String(row.name ?? row.id), hint: String(row.role ?? ""), href: `/agents?agent=${row.id}`,
          })),
        },
        {
          group: "Conversations", type: "conversation", url: "/api/rooms",
          pick: (body) => (Array.isArray(body) ? body : []).map((row: Record<string, unknown>) => ({
            id: String(row.id), label: String(row.name ?? "Conversation"), href: `/chat?room=${row.id}`,
          })),
        },
        {
          group: "Projects", type: "project", url: "/api/projects",
          pick: (body) => (Array.isArray(body) ? body : []).map((row: Record<string, unknown>) => ({
            id: String(row.id), label: String(row.name ?? row.id), href: `/projects?project=${row.id}`,
          })),
        },
        {
          group: "Workspaces", type: "workspace", url: "/api/agent-workspaces",
          pick: (body) => {
            const list = (body as { workspaces?: Record<string, unknown>[] })?.workspaces ?? [];
            return list.map((row) => ({
              id: String(row.id), label: String(row.name ?? row.id), hint: String(row.state ?? ""), href: `/agent-workspaces/${row.id}`,
            }));
          },
        },
      ];

      await Promise.all(sources.map(async (source) => {
        try {
          const response = await fetch(source.url);
          if (!response.ok) return;
          const rows = source.pick(await response.json())
            .filter((row) => row.label.toLowerCase().includes(lower))
            .slice(0, 5);
          for (const row of rows) {
            collected.push({
              id: `${source.group}-${row.id}`,
              group: source.group,
              type: source.type,
              label: row.label,
              hint: row.hint || undefined,
              run: () => go(row.href),
            });
          }
        } catch {
          // A source that cannot answer contributes nothing — never a stub row.
        }
      }));

      if (!cancelled) { setEntities(collected); setSearching(false); }
    }, 180);

    return () => { cancelled = true; clearTimeout(timer); };
  }, [query, commandPaletteOpen, go]);

  const items = useMemo(() => {
    const term = query.trim().toLowerCase();
    const matchedCommands = term
      ? commands.filter((command) => command.label.toLowerCase().includes(term))
      : commands;
    return [...matchedCommands, ...entities];
  }, [commands, entities, query]);

  // Clamped rather than reset from an effect: the cursor is derived from the
  // current result count, so it can never point past the list.
  const activeIndex = Math.min(cursor, Math.max(items.length - 1, 0));

  if (!commandPaletteOpen) return null;

  const grouped = items.reduce<Record<string, PaletteItem[]>>((accumulator, item) => {
    (accumulator[item.group] ??= []).push(item);
    return accumulator;
  }, {});

  const activeId = items[activeIndex] ? `palette-${items[activeIndex].id}` : undefined;

  return (
    <div
      className="fixed inset-0 z-[80] flex items-start justify-center bg-[rgba(4,7,8,0.62)] px-3 pt-[10vh] backdrop-blur-[2px] sm:px-4"
      onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}
    >
      <div role="dialog" aria-modal="true" aria-label="Search and commands" className="animate-fade-in w-full max-w-xl overflow-hidden rounded-lg border border-(--border-strong) bg-(--panel) shadow-[var(--shadow-lg)]">
        <div className="flex items-center gap-3 border-b border-(--border) px-4">
          <Search aria-hidden className="h-4 w-4 shrink-0 text-(--muted-foreground)" />
          <input
            ref={inputRef}
            value={query}
            role="combobox"
            aria-expanded
            aria-controls="palette-results"
            aria-activedescendant={activeId}
            aria-label="Search Sentinel or run a command"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") { close(); return; }
              if (event.key === "ArrowDown") { event.preventDefault(); setCursor((value) => Math.min(value + 1, items.length - 1)); }
              if (event.key === "ArrowUp") { event.preventDefault(); setCursor((value) => Math.max(value - 1, 0)); }
              if (event.key === "Enter") { event.preventDefault(); items[activeIndex]?.run(); }
            }}
            placeholder="Search agents, conversations, projects, or run a command"
            className="h-12 min-w-0 flex-1 bg-transparent text-[15px] text-(--foreground) outline-none placeholder:text-(--text-faint)"
          />
          <kbd className="hidden rounded border border-(--border) px-1.5 py-0.5 font-mono text-[10px] text-(--muted-foreground) sm:block">Esc</kbd>
        </div>
        <div id="palette-results" role="listbox" aria-label="Results" className="max-h-[min(24rem,60vh)] overflow-y-auto py-1.5">
          {items.length === 0 ? (
            <p className="px-4 py-6 text-center text-[13px] text-(--muted-foreground)">
              {searching ? "Searching…" : query.trim().length < 2 ? "Type at least two characters to search." : "No matches. Try a shorter term, or open Search for full results."}
            </p>
          ) : Object.entries(grouped).map(([group, groupItems]) => (
            <div key={group} role="group" aria-label={group}>
              <p className="px-4 pb-1 pt-2.5 text-[11px] font-medium text-(--text-faint)">{group}</p>
              {groupItems.map((item) => {
                const index = items.indexOf(item);
                const active = index === activeIndex;
                return (
                  <button
                    key={item.id}
                    id={`palette-${item.id}`}
                    role="option"
                    aria-selected={active}
                    tabIndex={-1}
                    onMouseEnter={() => setCursor(index)}
                    onClick={item.run}
                    className={cn(
                      "relative flex w-full items-center gap-3 px-4 py-2 text-left text-[14px] text-(--foreground)",
                      active && "bg-(--muted) before:absolute before:inset-y-1 before:left-0 before:w-[2px] before:rounded-full before:bg-(--primary)",
                    )}
                  >
                    <span
                      aria-hidden
                      className="h-1.5 w-1.5 shrink-0 rounded-full"
                      style={{ background: item.type === "action" ? ACTION_COLOR : ENTITY_TOKEN[item.type] }}
                    />
                    <span className="min-w-0 flex-1 truncate">{item.label}</span>
                    {item.hint ? <span className="shrink-0 text-[12px] text-(--muted-foreground)">{item.hint}</span> : null}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
