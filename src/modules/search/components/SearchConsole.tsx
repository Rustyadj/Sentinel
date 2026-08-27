import Link from "next/link";
import { Bot, Building2, ListChecks, Search as SearchIcon, StickyNote } from "lucide-react";
import { WorkspaceHeader } from "@/components/workspace/WorkspaceHeader";
import { WorkspaceShell } from "@/components/workspace/WorkspaceShell";
import type { SearchResult, SearchResultKind } from "@/lib/search/query";

const GROUPS: Array<{ kind: SearchResultKind; label: string; icon: typeof SearchIcon }> = [
  { kind: "task", label: "Tasks", icon: ListChecks },
  { kind: "agent", label: "Agents", icon: Bot },
  { kind: "memory", label: "Memory", icon: StickyNote },
  { kind: "workspace", label: "Workspaces", icon: Building2 },
];

export function SearchConsole({
  query,
  results,
}: {
  query: string;
  results: Record<SearchResultKind, SearchResult[]>;
}) {
  const total = GROUPS.reduce((sum, group) => sum + results[group.kind].length, 0);

  return (
    <WorkspaceShell>
      <WorkspaceHeader title="Search" description="Tasks, agents, memory, and workspaces." showBack={false} />

      <form action="/search" method="GET" className="mb-6">
        <label htmlFor="search-q" className="sr-only">
          Search Sentinel
        </label>
        <div className="flex h-10 items-center gap-2.5 rounded-lg border border-[--canvas-card-border] bg-[--canvas-card] px-3 focus-within:border-[--primary]/50">
          <SearchIcon className="h-4 w-4 shrink-0 text-[--muted-foreground]" />
          <input
            id="search-q"
            name="q"
            defaultValue={query}
            placeholder="Search tasks, agents, memory, workspaces..."
            autoFocus
            className="w-full bg-transparent text-[13px] text-[--canvas-foreground] outline-none placeholder:text-[--muted-foreground]"
          />
        </div>
      </form>

      {!query ? (
        <p className="text-[--muted-foreground]">Type a query above to search across Sentinel.</p>
      ) : total === 0 ? (
        <p className="text-[--muted-foreground]">No results for &ldquo;{query}&rdquo;.</p>
      ) : (
        <div className="space-y-6">
          {GROUPS.filter((group) => results[group.kind].length > 0).map((group) => (
            <section key={group.kind}>
              <h2 className="mb-2 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-[--muted-foreground]">
                <group.icon className="h-3.5 w-3.5" /> {group.label}
              </h2>
              <ul className="divide-y divide-[--canvas-card-border] rounded-lg border border-[--canvas-card-border]">
                {results[group.kind].map((result) => (
                  <li key={result.id}>
                    <Link
                      href={result.href}
                      className="flex flex-col gap-0.5 px-4 py-2.5 text-[13px] hover:bg-[--canvas-card]/60"
                    >
                      <span className="truncate text-[--canvas-foreground]">{result.title}</span>
                      {result.subtitle ? (
                        <span className="truncate text-[11px] text-[--muted-foreground]">{result.subtitle}</span>
                      ) : null}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </WorkspaceShell>
  );
}
