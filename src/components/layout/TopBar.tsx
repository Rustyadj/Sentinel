"use client";

import { useEffect, useState } from "react";
import { Bell, ChevronDown, Command, Search, Sparkles } from "lucide-react";
import { useSession } from "next-auth/react";
import { useAppStore } from "@/store/useAppStore";
import { cn } from "@/lib/utils";
import { SentinelLogo } from "@/components/branding/SentinelLogo";

function useClock() {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    const tick = () => setNow(new Date());
    tick();
    const id = window.setInterval(tick, 30_000);
    return () => window.clearInterval(id);
  }, []);
  return now;
}

/** Dense mission-control header extracted from the accepted reference. */
export function TopBar() {
  const { setCommandBarOpen } = useAppStore();
  const { data: session } = useSession();
  const now = useClock();
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [workspaces, setWorkspaces] = useState<Array<{ id: string; name: string; color: string }>>([]);
  const [workspaceId, setWorkspaceId] = useState("");
  const [workspaceState, setWorkspaceState] = useState<"loading" | "live" | "unavailable">("loading");

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/workspaces", { signal: controller.signal, cache: "no-store", headers: { Accept: "application/json" } })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Workspace request returned ${response.status}`);
        const body = await response.json() as { workspaces?: Array<{ id: string; name: string; color?: string }> };
        const next = (body.workspaces ?? []).map((workspace) => ({ ...workspace, color: workspace.color ?? "#64748b" }));
        setWorkspaces(next);
        setWorkspaceId(next[0]?.id ?? "");
        setWorkspaceState("live");
      })
      .catch(() => { if (!controller.signal.aborted) setWorkspaceState("unavailable"); });
    return () => controller.abort();
  }, []);
  const initials = session?.user?.name
    ? session.user.name
        .split(" ")
        .map((part) => part[0])
        .join("")
        .toUpperCase()
        .slice(0, 2)
    : "RJ";

  return (
    <header className="relative z-[60] flex h-16 shrink-0 items-center border-b border-[#182338] bg-[#040b14]/98 px-3 shadow-[0_10px_35px_rgba(0,0,0,0.18)] backdrop-blur-xl">
      <SentinelLogo className="mr-5" />
      <div className="hidden min-w-[150px] items-center gap-2.5 border-l border-white/[0.055] pl-5 sm:flex">
        <Sparkles className="h-5 w-5 stroke-[1.4] text-[#d4d9e3]" />
        <span className="text-[13px] font-medium text-[#f0f3f8]">Sentinel</span>
        <span className="h-2 w-2 rounded-full bg-sky-400 shadow-[0_0_10px_rgba(56,189,248,0.5)]" />
        <span className="hidden text-[10px] text-sky-300 lg:inline">Control plane</span>
      </div>

      <button
        type="button"
        onClick={() => setCommandBarOpen(true)}
        aria-label="Open global search"
        className="absolute left-[48%] hidden h-9 w-[min(430px,32vw)] -translate-x-1/2 items-center gap-2.5 rounded-lg border border-[#1d2b40] bg-[#09131f]/88 px-3.5 text-[#7e8a9c] outline-none transition-colors hover:border-violet-400/30 hover:text-[#cbd3df] focus-visible:ring-2 focus-visible:ring-violet-400/50 lg:flex"
      >
        <Search className="h-4 w-4 shrink-0 stroke-[1.6]" />
        <span className="min-w-0 flex-1 truncate text-left text-[12px]">Search nodes, concepts, memories...</span>
        <span className="hidden items-center gap-1 text-[10px] text-[#5c697c] sm:flex">
          <Command className="h-3 w-3" />K
        </span>
      </button>

      <div className="ml-auto flex items-center gap-3 md:gap-5">
        <div className="relative hidden sm:block">
          <button
            type="button"
            onClick={() => setWorkspaceOpen((open) => !open)}
            aria-label="Select workspace"
            aria-haspopup="listbox"
            aria-expanded={workspaceOpen}
            className="flex h-9 items-center gap-2 rounded-xl border border-white/[0.055] bg-white/[0.035] px-3 text-[11px] text-[#d5dbe5] hover:border-white/[0.11]"
          >
            <span className={cn("h-2 w-2 rounded-full", workspaceState === "live" ? "bg-emerald-400" : workspaceState === "loading" ? "bg-amber-400" : "bg-slate-400")} />
            {workspaceState === "loading" ? "Loading workspace" : workspaces.find((workspace) => workspace.id === workspaceId)?.name ?? "No workspace"}
            <ChevronDown className="h-3.5 w-3.5 text-[#6e7a8c]" />
          </button>
          {workspaceOpen ? (
            <ul
              role="listbox"
              aria-label="Workspaces"
              className="absolute right-0 top-full z-50 mt-2 w-48 overflow-hidden rounded-xl border border-white/[0.08] bg-[#0a1420]/98 py-1 shadow-2xl"
            >
              {workspaces.map((workspace) => (
                <li key={workspace.id} role="option" aria-selected={workspace.id === workspaceId}>
                  <button
                    type="button"
                    onClick={() => { setWorkspaceId(workspace.id); setWorkspaceOpen(false); }}
                    className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[11px] text-[#c5cedb] hover:bg-white/[0.05]"
                  >
                    <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: workspace.color }} />
                    {workspace.name}
                  </button>
                </li>
              ))}
              {workspaces.length === 0 ? <li className="px-3 py-2 text-[10px] text-[#718095]">No accessible workspaces</li> : null}
            </ul>
          ) : null}
        </div>

        <time className="hidden font-mono text-[11px] tabular-nums text-[#aab4c3] lg:block" suppressHydrationWarning>
          {now
            ? `${now.toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
                hour12: false,
              })} CT`
            : "--:--:-- CT"}
        </time>
        <button
          type="button"
          aria-label="Notifications"
          className="flex h-8 w-8 items-center justify-center rounded-lg text-[#bac4d2] hover:bg-white/[0.05] hover:text-white"
        >
          <Bell className="h-4.5 w-4.5 stroke-[1.5]" />
        </button>
        <button
          type="button"
          aria-label="Open user menu"
          title={session?.user?.name ?? "Rusty Johnson"}
          className="flex h-8 w-8 items-center justify-center rounded-full border border-white/[0.09] bg-[#111c29] text-[9px] font-semibold text-[#dbe5f1] outline-none transition-colors hover:border-white/20 hover:text-white focus-visible:ring-2 focus-visible:ring-cyan-400/55"
        >
          {initials}
        </button>
      </div>
    </header>
  );
}
