"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, Command, Search, Sparkles } from "lucide-react";
import { useSession } from "next-auth/react";
import { useAppStore } from "@/store/useAppStore";
import { cn } from "@/lib/utils";
import { SentinelLogo } from "@/components/branding/SentinelLogo";
import { VoiceControls } from "@/components/voice/VoiceControls";
import { TopBarAgentIndicator } from "./TopBarAgentIndicator";
import { TopBarApprovals } from "./TopBarApprovals";
import { TopBarNotifications } from "./TopBarNotifications";
import { TopBarProfileMenu } from "./TopBarProfileMenu";

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
type TopBarMenu = "workspace" | "agents" | "approvals" | "notifications" | "profile" | null;

export function TopBar() {
  const { setCommandBarOpen } = useAppStore();
  const { data: session } = useSession();
  const now = useClock();
  const [openMenu, setOpenMenu] = useState<TopBarMenu>(null);
  const workspaceOpen = openMenu === "workspace";
  const setWorkspaceOpen = (value: boolean | ((prev: boolean) => boolean)) =>
    setOpenMenu((prev) => {
      const next = typeof value === "function" ? value(prev === "workspace") : value;
      return next ? "workspace" : null;
    });
  const [workspaces, setWorkspaces] = useState<Array<{ id: string; name: string; color: string }>>([]);
  const [workspaceId, setWorkspaceId] = useState("");
  const [workspaceState, setWorkspaceState] = useState<"loading" | "live" | "unavailable">("loading");
  const headerRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!openMenu) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (headerRef.current && !headerRef.current.contains(event.target as Node)) setOpenMenu(null);
    };
    window.addEventListener("mousedown", handlePointerDown);
    return () => window.removeEventListener("mousedown", handlePointerDown);
  }, [openMenu]);

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
  const displayName = session?.user?.name ?? session?.user?.email ?? "Account";
  const initials = session?.user?.name
    ? session.user.name
        .split(" ")
        .map((part) => part[0])
        .join("")
        .toUpperCase()
        .slice(0, 2)
    : session?.user?.email
      ? session.user.email.slice(0, 2).toUpperCase()
      : "?";

  return (
    <header ref={headerRef} className="relative z-[60] flex h-16 shrink-0 items-center border-b border-[#182338] bg-[#040b14]/98 px-3 shadow-[0_10px_35px_rgba(0,0,0,0.18)] backdrop-blur-xl">
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

        <TopBarAgentIndicator
          open={openMenu === "agents"}
          onOpenChange={(next) => setOpenMenu(next ? "agents" : null)}
        />

        <div className="hidden items-center border-l border-white/[0.055] pl-3 md:flex">
          <VoiceControls
            onTranscript={(text) => {
              window.dispatchEvent(new CustomEvent("sentinel:voice-transcript", { detail: { text } }));
            }}
          />
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
        <TopBarApprovals
          workspaceId={workspaceId}
          open={openMenu === "approvals"}
          onOpenChange={(next) => setOpenMenu(next ? "approvals" : null)}
        />
        <TopBarNotifications
          open={openMenu === "notifications"}
          onOpenChange={(next) => setOpenMenu(next ? "notifications" : null)}
        />
        <TopBarProfileMenu
          initials={initials}
          displayName={displayName}
          open={openMenu === "profile"}
          onOpenChange={(next) => setOpenMenu(next ? "profile" : null)}
        />
      </div>
    </header>
  );
}
