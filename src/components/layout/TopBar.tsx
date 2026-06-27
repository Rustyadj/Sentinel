"use client";

import { Search, Bell, Plus, ChevronDown, Zap } from "lucide-react";
import { useSession } from "next-auth/react";
import { useAppStore } from "@/store/useAppStore";
import { useAgentStore } from "@/store/useAgentStore";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { NAV_MODULES } from "@/lib/constants";
import { usePathname, useRouter } from "next/navigation";

export function TopBar() {
  const pathname = usePathname();
  const router = useRouter();
  const { setCommandBarOpen } = useAppStore();
  const { agents } = useAgentStore();
  const { data: session } = useSession();

  const activeModule = NAV_MODULES.find((m) => pathname.startsWith(m.href));
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
    <header className="h-14 border-b border-[--border] bg-[--card] flex items-center px-4 gap-3 shrink-0">
      {/* Module breadcrumb */}
      <div className="flex items-center gap-2 min-w-0">
        <span className="text-sm font-medium text-[--foreground] truncate">
          {activeModule?.label ?? "Mission Control"}
        </span>
        {activeModule && (
          <>
            <span className="text-[--muted-foreground] text-xs">/</span>
            <span className="text-xs text-[--muted-foreground] truncate hidden sm:block">
              {activeModule.description}
            </span>
          </>
        )}
      </div>

      {/* Command search */}
      <button
        onClick={() => setCommandBarOpen(true)}
        className={cn(
          "flex-1 max-w-sm mx-auto flex items-center gap-2 h-8 px-3 rounded-md border border-[--border] bg-[--muted] text-[--muted-foreground] text-xs hover:border-[--primary]/50 hover:text-[--foreground] transition-colors"
        )}
      >
        <Search className="w-3.5 h-3.5 shrink-0" />
        <span className="flex-1 text-left">Search or run a command…</span>
        <kbd className="hidden sm:inline-flex items-center gap-0.5 rounded border border-[--border] px-1 font-mono text-[10px] text-[--muted-foreground]">
          ⌘K
        </kbd>
      </button>

      {/* Right actions */}
      <div className="flex items-center gap-2 ml-auto">
        {/* Active ops indicator */}
        {busyAgents.length > 0 && (
          <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-500/10 border border-amber-500/20">
            <Zap className="w-3 h-3 text-amber-400 animate-pulse-dot" />
            <span className="text-xs text-amber-400">
              {busyAgents.length} agent{busyAgents.length > 1 ? "s" : ""} running
            </span>
          </div>
        )}

        {/* New action */}
        <Button size="sm" variant="outline" className="gap-1.5 h-8 text-xs">
          <Plus className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">New</span>
        </Button>

        {/* Notifications */}
        <Button size="icon" variant="ghost" className="h-8 w-8 relative">
          <Bell className="w-4 h-4" />
          <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full bg-[--primary]" />
        </Button>

        {/* User avatar */}
        <button
          onClick={() => router.push("/settings")}
          className="flex items-center gap-2 pl-2 pr-1 py-1 rounded-md hover:bg-[--accent] transition-colors"
          title="Settings"
        >
          {user?.image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={user.image}
              alt={user.name ?? "User"}
              className="w-6 h-6 rounded-full border border-[--border]"
            />
          ) : (
            <div className="w-6 h-6 rounded-full bg-[--primary]/20 flex items-center justify-center text-[10px] text-[--primary] font-semibold">
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
