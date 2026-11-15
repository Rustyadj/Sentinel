"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import {
  Activity, BookOpen, Boxes, Bot, FolderKanban, GitBranch, HardDrive, ListChecks, MessageSquare, MessagesSquare,
  Radar, Search, Settings, Users, X, type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { SHELL_NAV_GROUPS, SHELL_SECONDARY_NAV, type NavItem } from "@/lib/navigation";
import { SentinelLogo } from "@/components/branding/SentinelLogo";
import { useShellStore } from "@/store/useShellStore";

const ICONS: Record<string, LucideIcon> = {
  MessageSquare, MessagesSquare, FolderKanban, Radar, BookOpen, HardDrive, Bot, Boxes, ListChecks, Activity, GitBranch,
  Users, Search, Settings,
};

export function isShellNavActive(item: NavItem, pathname: string) {
  if (item.href === "/chat") return pathname === "/" || pathname.startsWith("/chat");
  if (item.href === "/agent-workspaces") return pathname.startsWith("/agent-workspaces") || pathname.startsWith("/workspaces");
  return pathname === item.href || pathname.startsWith(`${item.href}/`) || pathname.startsWith(`${item.href}?`);
}

/** The groups this person can use. A project guest sees only where they can actually go. */
function useNavGroups() {
  const { data: session } = useSession();
  const guest = session?.user?.scope === "guest";
  const groups = guest
    ? SHELL_NAV_GROUPS.map((group) => ({ ...group, items: group.items.filter((item) => item.guest) })).filter((group) => group.items.length)
    : SHELL_NAV_GROUPS;
  return { groups, secondary: guest ? [] : SHELL_SECONDARY_NAV };
}

/**
 * One entry. Where you are standing is a raised row with the signal light
 * beside it; everything else is quiet text.
 */
function NavLink({ item, pathname, onNavigate, large }: { item: NavItem; pathname: string; onNavigate?: () => void; large?: boolean }) {
  const Icon = ICONS[item.icon] ?? MessageSquare;
  const active = isShellNavActive(item, pathname);
  return (
    <Link
      href={item.href}
      prefetch={false}
      aria-current={active ? "page" : undefined}
      onClick={onNavigate}
      className={cn(
        "group relative flex items-center gap-3 rounded-(--radius-md) px-3 font-medium transition-colors duration-150",
        large ? "h-11 text-[15px]" : "h-9 text-[13.5px]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--ring)",
        active ? "bg-(--muted) text-(--foreground)" : "text-(--muted-foreground) hover:bg-(--panel) hover:text-(--foreground)",
      )}
    >
      <Icon aria-hidden className={cn("h-[17px] w-[17px] shrink-0 stroke-[1.7]", active && "text-(--primary)")} />
      <span className="truncate">{item.label}</span>
      {active ? <span aria-hidden className="ml-auto h-2 w-2 rounded-full bg-(--primary)" /> : null}
    </Link>
  );
}

/** Desktop sidebar: named groups, with search and settings at the foot. */
export function NavRail() {
  const pathname = usePathname();
  const { groups, secondary } = useNavGroups();
  return (
    <nav
      aria-label="Primary"
      className="hidden w-[216px] shrink-0 flex-col border-r border-(--sidebar-border) bg-(--sidebar) px-2.5 pb-3 lg:flex"
    >
      <Link
        href="/chat"
        prefetch={false}
        aria-label="Sentinel home"
        className="flex h-14 shrink-0 items-center rounded-(--radius-md) px-2.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--ring)"
      >
        <SentinelLogo />
      </Link>
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overflow-x-hidden pt-2 [scrollbar-width:none]">
        {groups.map((group) => (
          <div key={group.id}>
            <p id={`nav-${group.id}`} className="px-3 pb-1.5 text-[11.5px] font-medium text-(--text-faint)">{group.label}</p>
            <ul aria-labelledby={`nav-${group.id}`} className="flex flex-col gap-0.5">
              {group.items.map((item) => (
                <li key={item.id}><NavLink item={item} pathname={pathname} /></li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      {secondary.length ? (
        <ul aria-label="Utilities" className="mt-2 flex flex-col gap-0.5 border-t border-(--sidebar-border) pt-2">
          {secondary.map((item) => (
            <li key={item.id}><NavLink item={item} pathname={pathname} /></li>
          ))}
        </ul>
      ) : null}
    </nav>
  );
}

/** Narrow screens: the same groups in a sheet opened from the top bar. */
export function MobileNav() {
  const pathname = usePathname();
  const { groups, secondary } = useNavGroups();
  const { mobileNavOpen, setMobileNavOpen } = useShellStore();
  const closeRef = useRef<HTMLButtonElement>(null);
  const lastPath = useRef(pathname);

  useEffect(() => {
    if (pathname !== lastPath.current) {
      lastPath.current = pathname;
      setMobileNavOpen(false);
    }
  }, [pathname, setMobileNavOpen]);

  useEffect(() => {
    if (!mobileNavOpen) return;
    const previous = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setMobileNavOpen(false); };
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("keydown", onKey); previous?.focus?.(); };
  }, [mobileNavOpen, setMobileNavOpen]);

  if (!mobileNavOpen) return null;
  const close = () => setMobileNavOpen(false);

  return (
    <div className="fixed inset-0 z-[70] lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
      <button type="button" aria-label="Close navigation" tabIndex={-1} onClick={close} className="absolute inset-0 bg-[color-mix(in_srgb,var(--canvas)_78%,transparent)]" />
      <nav aria-label="Primary" className="animate-slide-in-left absolute inset-y-0 left-0 flex w-[min(300px,84vw)] flex-col border-r border-(--sidebar-border) bg-(--sidebar)">
        <div className="flex h-14 items-center justify-between px-4">
          <SentinelLogo />
          <button
            ref={closeRef}
            type="button"
            aria-label="Close navigation"
            onClick={close}
            className="flex h-10 w-10 items-center justify-center rounded-(--radius-md) text-(--muted-foreground) hover:bg-(--muted) hover:text-(--foreground)"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-3 pb-4">
          {groups.map((group) => (
            <div key={group.id} className="mt-3">
              <p className="px-3 pb-1.5 text-[12px] font-medium text-(--text-faint)">{group.label}</p>
              <ul className="flex flex-col gap-0.5">
                {group.items.map((item) => <li key={item.id}><NavLink item={item} pathname={pathname} onNavigate={close} large /></li>)}
              </ul>
            </div>
          ))}
          {secondary.length ? (
            <ul className="mt-4 flex flex-col gap-0.5 border-t border-(--sidebar-border) pt-3">
              {secondary.map((item) => <li key={item.id}><NavLink item={item} pathname={pathname} onNavigate={close} large /></li>)}
            </ul>
          ) : null}
        </div>
      </nav>
    </div>
  );
}
