"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Activity, Bot, GitBranch, HardDrive, MessageSquare, Network, Settings, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { SHELL_NAV, SHELL_SECONDARY_NAV, type NavItem } from "@/lib/navigation";

const ICONS: Record<string, LucideIcon> = { MessageSquare, Network, HardDrive, Bot, Activity, GitBranch, Settings };

function isActive(item: NavItem, pathname: string) {
  if (item.href === "/chat") return pathname === "/" || pathname.startsWith("/chat");
  return pathname.startsWith(item.href);
}

function RailLink({ item, pathname }: { item: NavItem; pathname: string }) {
  const Icon = ICONS[item.icon] ?? MessageSquare;
  const active = isActive(item, pathname);
  return (
    <Link
      href={item.href}
      prefetch={false}
      aria-label={item.label}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group flex w-full flex-col items-center gap-1 rounded-xl py-2.5 text-[11px] transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[--ring]",
        active ? "bg-[--card] text-[--foreground] shadow-[var(--shadow-sm)]" : "text-[--muted-foreground] hover:text-[--foreground]",
      )}
    >
      <Icon className="h-[18px] w-[18px] stroke-[1.7]" />
      <span>{item.label}</span>
    </Link>
  );
}

/** Five surfaces, one rail. Everything else is contextual. */
export function NavRail() {
  const pathname = usePathname();
  return (
    <nav aria-label="Primary" className="flex w-[76px] shrink-0 flex-col justify-between bg-[--sidebar] px-2 py-3">
      <div className="flex flex-col gap-1">
        <Link href="/chat" prefetch={false} aria-label="Sentinel home" className="mb-2 flex h-9 items-center justify-center">
          <span className="text-[13px] font-semibold tracking-tight text-[--foreground]">S</span>
        </Link>
        {SHELL_NAV.map((item) => <RailLink key={item.id} item={item} pathname={pathname} />)}
      </div>
      <div className="flex flex-col gap-1">
        {SHELL_SECONDARY_NAV.map((item) => <RailLink key={item.id} item={item} pathname={pathname} />)}
      </div>
    </nav>
  );
}
