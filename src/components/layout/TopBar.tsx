"use client";

import { Search, Bell, Plus, ChevronDown, Zap } from "lucide-react";
import { useSession } from "next-auth/react";
import { useAppStore } from "@/store/useAppStore";
import { useAgentStore } from "@/store/useAgentStore";
import { Button } from "@/components/ui/button";
import { usePathname, useRouter } from "next/navigation";
import { getActiveNavLabel } from "@/lib/workspaces";

export function TopBar() {
  const pathname = usePathname();
  const router = useRouter();
  const { setCommandBarOpen } = useAppStore();
  const { agents } = useAgentStore();
  const { data: session } = useSession();

  const label = getActiveNavLabel(pathname);
  const busyAgents = agents.filter((a) => a.status === "busy");
  const user = session?.user;
  const initials = user?.name
    ? user.name
        .split(" ")
        .map((n) => n[0])
        .join("")
        .toUpperCase()
        .slice(0, 2)
    : "?";

  return (
    <header className="h-12 border-b border-[--border] bg-[--card] flex items-center px-4 gap-3 shrink-0">
      {/* Breadcrumb */}
      <span className="text-sm font-medium text-[--foreground] truncate shrink-0">
        {label}
      </span>

      {/* Command search */}
      <button
        onClick={() => setCommandBarOpen(true)}
        className="flex-1 max-w-xs mx-auto flex items-center gap-2 h-7 px-3 rounded-md border border-[--border] bg-[--muted] text-[--muted-foreground] text-xs hover:border-[--primary]/50 hover:text-[--foreground] transition-colors"
      >
        <Search className="w-3 h-3 shrink-0" />
        <span className="flex-1 text-left">Search…</span>
        <kbd className="hidden sm:inline-flex items-center rounded border border-[--border] px-1 font-mono text-[10px] text-[--muted-foreground]">
          ⌘K
        </kbd>
      </button>

      {/* Right side */}
      <div className="flex items-center gap-2 ml-auto">
        {busyAgents.length > 0 && (
          <div className="hidden sm:flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/20">
            <Zap className="w-3 h-3 text-amber-400 animate-pulse-dot" />
            <span className="text-xs text-amber-400">
              {busyAgents.length} running
            </span>
          </div>
        )}

        <Button size="sm" variant="outline" className="gap-1 h-7 text-xs px-2">
          <Plus className="w-3 h-3" />
          <span className="hidden sm:inline">New</span>
        </Button>

        <Button size="icon" variant="ghost" className="h-7 w-7 relative">
          <Bell className="w-3.5 h-3.5" />
          <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-[--primary]" />
        </Button>

        <button
          onClick={() => router.push("/settings")}
          className="flex items-center gap-1.5 pl-1.5 pr-1 py-0.5 rounded-md hover:bg-[--accent] transition-colors"
          title="Settings"
        >
          {user?.image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={user.image}
              alt={user.name ?? "User"}
              className="w-5 h-5 rounded-full border border-[--border]"
            />
          ) : (
            <div className="w-5 h-5 rounded-full bg-[--primary]/20 flex items-center justify-center text-[9px] text-[--primary] font-semibold">
              {initials}
            </div>
          )}
          <span className="text-xs text-[--foreground] hidden sm:block">
            {user?.name?.split(" ")[0] ?? "User"}
          </span>
          <ChevronDown className="w-3 h-3 text-[--muted-foreground]" />
        </button>
      </div>
    </header>
  );
}
