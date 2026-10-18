"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity, BookOpen, Boxes, Bot, GitBranch, HardDrive, ListChecks, MessageSquare, Network, Search, Settings, X,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { SHELL_NAV_GROUPS, SHELL_SECONDARY_NAV, type NavItem } from "@/lib/navigation";
import { SentinelLogo } from "@/components/branding/SentinelLogo";
import { useShellStore } from "@/store/useShellStore";

const ICONS: Record<string, LucideIcon> = {
  MessageSquare, Network, BookOpen, HardDrive, Bot, Boxes, ListChecks, Activity, GitBranch, Search, Settings,
};

export function isShellNavActive(item: NavItem, pathname: string) {
  if (item.href === "/chat") return pathname === "/" || pathname.startsWith("/chat");
  if (item.href === "/agent-workspaces") return pathname.startsWith("/agent-workspaces") || pathname.startsWith("/workspaces");
  return pathname === item.href || pathname.startsWith(`${item.href}/`) || pathname.startsWith(`${item.href}?`);
}

/**
 * A rail entry. The selected state is a brass edge on a raised surface — the
 * stratum you are standing on — never a filled pill.
 */
function RailLink({ item, pathname }: { item: NavItem; pathname: string }) {
  const Icon = ICONS[item.icon] ?? MessageSquare;
  const active = isShellNavActive(item, pathname);
  return (
    <Link
      href={item.href}
      prefetch={false}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group relative flex w-full flex-col items-center gap-1 rounded-md py-2 text-[11px] font-medium tracking-[-0.01em] transition-colors duration-150",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--ring)",
        active
          ? "bg-(--muted) text-(--foreground)"
          : "text-(--muted-foreground) hover:bg-(--panel) hover:text-(--foreground)",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "absolute inset-y-2 -left-2 w-[3px] rounded-r-full bg-(--primary) transition-opacity duration-150",
          active ? "opacity-100" : "opacity-0",
        )}
      />
      <Icon aria-hidden className={cn("h-[18px] w-[18px] stroke-[1.6]", active && "text-(--primary-soft)")} />
      <span className="leading-none">{item.label}</span>
    </Link>
  );
}

/** Desktop rail: three quiet groups separated by hairlines, settings at the foot. */
export function NavRail() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Primary"
      className="hidden w-[80px] shrink-0 flex-col border-r border-(--sidebar-border) bg-(--sidebar) px-2 pb-3 md:flex"
    >
      <Link
        href="/chat"
        prefetch={false}
        aria-label="Sentinel home"
        className="flex h-14 shrink-0 items-center justify-center rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--ring)"
      >
        <SentinelLogo markOnly className="w-[27px]" />
      </Link>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden pt-1 [scrollbar-width:none]">
        {SHELL_NAV_GROUPS.map((group, index) => (
          <ul
            key={group.id}
            aria-label={group.label}
            className={cn("flex flex-col gap-0.5", index > 0 && "mt-2 border-t border-(--sidebar-border) pt-2")}
          >
            {group.items.map((item) => (
              <li key={item.id}><RailLink item={item} pathname={pathname} /></li>
            ))}
          </ul>
        ))}
      </div>
      <ul aria-label="Utilities" className="mt-2 flex flex-col gap-0.5 border-t border-(--sidebar-border) pt-2">
        {SHELL_SECONDARY_NAV.map((item) => (
          <li key={item.id}><RailLink item={item} pathname={pathname} /></li>
        ))}
      </ul>
    </nav>
  );
}

/** Narrow screens: the same groups in a sheet opened from the top bar. */
export function MobileNav() {
  const pathname = usePathname();
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

  const row = (item: NavItem) => {
    const Icon = ICONS[item.icon] ?? MessageSquare;
    const active = isShellNavActive(item, pathname);
    return (
      <li key={item.id}>
        <Link
          href={item.href}
          prefetch={false}
          aria-current={active ? "page" : undefined}
          onClick={() => setMobileNavOpen(false)}
          className={cn(
            "relative flex h-11 items-center gap-3 rounded-md px-3 text-[15px] transition-colors",
            active ? "bg-(--muted) text-(--foreground)" : "text-(--muted-foreground) hover:bg-(--panel) hover:text-(--foreground)",
          )}
        >
          {active ? <span aria-hidden className="absolute inset-y-2 left-0 w-[3px] rounded-r-full bg-(--primary)" /> : null}
          <Icon aria-hidden className={cn("h-[18px] w-[18px] stroke-[1.6]", active && "text-(--primary-soft)")} />
          {item.label}
        </Link>
      </li>
    );
  };

  return (
    <div className="fixed inset-0 z-[70] md:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
      <button type="button" aria-label="Close navigation" tabIndex={-1} onClick={() => setMobileNavOpen(false)} className="absolute inset-0 bg-[rgba(4,7,8,0.66)]" />
      <nav aria-label="Primary" className="animate-slide-in-left absolute inset-y-0 left-0 flex w-[min(300px,84vw)] flex-col border-r border-(--sidebar-border) bg-(--sidebar)">
        <div className="flex h-14 items-center justify-between px-4">
          <span className="flex items-center gap-2.5">
            <SentinelLogo markOnly className="w-[27px]" />
            <span className="font-display text-[17px] font-semibold tracking-tight">Sentinel</span>
          </span>
          <button
            ref={closeRef}
            type="button"
            aria-label="Close navigation"
            onClick={() => setMobileNavOpen(false)}
            className="flex h-9 w-9 items-center justify-center rounded-md text-(--muted-foreground) hover:bg-(--muted) hover:text-(--foreground)"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-3 pb-4">
          {SHELL_NAV_GROUPS.map((group) => (
            <div key={group.id} className="mt-3">
              <p className="px-3 pb-1.5 text-[12px] font-medium text-(--text-faint)">{group.label}</p>
              <ul className="flex flex-col gap-0.5">{group.items.map(row)}</ul>
            </div>
          ))}
          <ul className="mt-4 flex flex-col gap-0.5 border-t border-(--sidebar-border) pt-3">{SHELL_SECONDARY_NAV.map(row)}</ul>
        </div>
      </nav>
    </div>
  );
}
