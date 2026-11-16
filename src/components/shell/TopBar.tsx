"use client";

import { useEffect, useRef, useState } from "react";
import { Menu, Search } from "lucide-react";
import { useSession } from "next-auth/react";
import { useShellStore } from "@/store/useShellStore";
import { TopBarAgentIndicator } from "@/components/layout/TopBarAgentIndicator";
import { TopBarApprovals } from "@/components/layout/TopBarApprovals";
import { TopBarNotifications } from "@/components/layout/TopBarNotifications";
import { TopBarProfileMenu } from "@/components/layout/TopBarProfileMenu";
import { VoiceControls } from "@/components/voice/VoiceControls";
import { IconButton } from "./primitives";
import Link from "next/link";
import { SentinelLogo } from "@/components/branding/SentinelLogo";
import { PrimaryNav } from "./NavRail";

type TopBarMenu = "agents" | "approvals" | "notifications" | "profile" | null;

/** First accessible workspace — approvals are scoped to it, exactly as before. */
function usePrimaryWorkspaceId() {
  const [workspaceId, setWorkspaceId] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/workspaces", { signal: controller.signal, cache: "no-store", headers: { Accept: "application/json" } })
      .then(async (response) => (response.ok ? ((await response.json()) as { workspaces?: Array<{ id: string }> }) : { workspaces: [] }))
      .then((body) => setWorkspaceId(body.workspaces?.[0]?.id ?? ""))
      .catch(() => { /* approvals simply stay empty */ });
    return () => controller.abort();
  }, []);
  return workspaceId;
}

/**
 * One top bar for every surface: the surface's own controls on the left,
 * global search and the operator's queues on the right. Screens contribute
 * controls through `left` — the shell never guesses what they need.
 */
export function TopBar({ left, title }: { left?: React.ReactNode; title?: React.ReactNode }) {
  const { setCommandPaletteOpen, setMobileNavOpen } = useShellStore();
  const { data: session } = useSession();
  const workspaceId = usePrimaryWorkspaceId();
  const [openMenu, setOpenMenu] = useState<TopBarMenu>(null);
  const actionsRef = useRef<HTMLDivElement>(null);

  const displayName = session?.user?.name ?? session?.user?.email ?? "Account";
  const initials = session?.user?.name
    ? session.user.name.split(" ").map((part) => part[0]).join("").toUpperCase().slice(0, 2)
    : session?.user?.email?.slice(0, 2).toUpperCase() ?? "?";

  useEffect(() => {
    if (!openMenu) return;
    const onPointer = (event: MouseEvent) => {
      if (actionsRef.current && !actionsRef.current.contains(event.target as Node)) setOpenMenu(null);
    };
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setOpenMenu(null); };
    window.addEventListener("mousedown", onPointer);
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("mousedown", onPointer); window.removeEventListener("keydown", onKey); };
  }, [openMenu]);

  const menu = (name: Exclude<TopBarMenu, null>) => ({
    open: openMenu === name,
    onOpenChange: (next: boolean) => setOpenMenu(next ? name : null),
  });

  return (
    <div className="relative z-[60] shrink-0">
      <header className="flex h-14 items-center gap-2 border-b border-(--border) bg-(--background) px-2 sm:gap-3 sm:px-4">
        <IconButton label="Open navigation" className="lg:hidden" onClick={() => setMobileNavOpen(true)}>
          <Menu className="h-[18px] w-[18px]" />
        </IconButton>

        <Link
          href="/chat"
          prefetch={false}
          aria-label="Sentinel home"
          className="flex h-10 shrink-0 items-center rounded-(--radius-md) pr-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--ring)"
        >
          <SentinelLogo className="hidden sm:inline-flex 2xl:hidden" markOnly />
          <SentinelLogo className="sm:hidden 2xl:inline-flex" />
        </Link>

        <PrimaryNav />
        <div className="flex-1 lg:hidden" />

        <button
          type="button"
          onClick={() => setCommandPaletteOpen(true)}
          className="hidden h-10 shrink-0 items-center gap-2.5 rounded-(--radius-md) border border-(--border) bg-(--panel) px-3 text-[13px] text-(--muted-foreground) transition-colors hover:border-(--border-strong) hover:text-(--foreground) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--ring) xl:flex"
        >
          <Search aria-hidden className="h-3.5 w-3.5" />
          <span className="text-left">Search or run a command</span>
          <kbd className="rounded border border-(--border) px-1.5 py-px font-mono text-[11px]">Ctrl K</kbd>
        </button>
        <IconButton label="Search" className="xl:hidden" onClick={() => setCommandPaletteOpen(true)}>
          <Search className="h-4 w-4" />
        </IconButton>

        <div ref={actionsRef} className="flex shrink-0 items-center gap-0.5 sm:gap-1">
          <div className="flex items-center xl:border-r xl:border-(--border) xl:pr-2">
            <VoiceControls
              compactOnMobile
              // The global voice control is Lisa's, deliberately: she is the
              // orchestrator, and this control is not scoped to a conversation.
              agentId="hermes-lisa"
              onTranscript={(text) => {
                window.dispatchEvent(new CustomEvent("sentinel:voice-transcript", { detail: { text } }));
              }}
            />
          </div>
          <span className="mr-1 hidden 2xl:block"><TopBarAgentIndicator {...menu("agents")} /></span>
          <TopBarApprovals workspaceId={workspaceId} {...menu("approvals")} />
          <span className="hidden sm:block"><TopBarNotifications {...menu("notifications")} /></span>
          <span className="ml-1"><TopBarProfileMenu initials={initials} displayName={displayName} {...menu("profile")} /></span>
        </div>
      </header>

      {title || left ? (
        <div className="flex min-h-12 flex-wrap items-center gap-1.5 border-b border-(--border) bg-(--background) px-3 py-1 sm:flex-nowrap sm:gap-2 sm:px-4">
          {title ? <h1 className="truncate font-display text-[18px] font-semibold tracking-tight text-(--foreground)">{title}</h1> : null}
          {left}
        </div>
      ) : null}
    </div>
  );
}
