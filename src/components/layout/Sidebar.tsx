"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import {
  BookOpen,
  Bot,
  Building2,
  Code2,
  DollarSign,
  FlaskConical,
  Folder,
  GitBranch,
  Home,
  Landmark,
  Megaphone,
  MessageSquare,
  Package,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Settings,
  Shield,
  Wand2,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  PRIMARY_NAV,
  WORKSPACE_NAV,
  isNavItemActive,
  type NavItem,
  type WorkspaceNavItem,
} from "@/lib/navigation";

const ICON_MAP: Record<string, LucideIcon> = {
  Home,
  MessageSquare,
  Folder,
  BookOpen,
  Bot,
  Building2,
  GitBranch,
  Package,
  Settings,
  Shield,
  Wand2,
  Megaphone,
  Landmark,
  Code2,
  DollarSign,
  FlaskConical,
};

function NavLink({ item, active, expanded }: { item: NavItem; active: boolean; expanded: boolean }) {
  const Icon = ICON_MAP[item.icon] ?? Home;
  return (
    <Link
      href={item.href}
      aria-label={item.label}
      aria-current={active ? "page" : undefined}
      title={item.label}
      className={cn(
        "group flex h-10 items-center gap-3 rounded-lg px-3 text-[13px] outline-none transition-colors",
        "focus-visible:ring-2 focus-visible:ring-cyan-400/60",
        active
          ? "bg-indigo-500/20 text-[#f3f6fb]"
          : "text-[#b4bdcb] hover:bg-white/[0.045] hover:text-white"
      )}
    >
      <Icon className="h-[17px] w-[17px] shrink-0 stroke-[1.6]" />
      <span className={cn("truncate transition-opacity duration-150", expanded ? "opacity-100" : "sr-only opacity-0")}>
        {item.label}
      </span>
    </Link>
  );
}

function WorkspaceLink({ item, active, expanded }: { item: WorkspaceNavItem; active: boolean; expanded: boolean }) {
  const Icon = ICON_MAP[item.icon] ?? Shield;
  return (
    <Link
      href={item.href}
      aria-label={`${item.label} workspace`}
      aria-current={active ? "page" : undefined}
      title={item.label}
      className={cn(
        "flex h-10 items-center gap-3 rounded-lg px-2.5 text-[13px] outline-none transition-colors",
        "focus-visible:ring-2 focus-visible:ring-cyan-400/60",
        active ? "bg-white/[0.055] text-white" : "text-[#c0c8d4] hover:bg-white/[0.04]"
      )}
    >
      <span
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-white/10"
        style={{ backgroundColor: `${item.color}22`, color: item.color }}
      >
        <Icon className="h-3.5 w-3.5 stroke-[1.8]" />
      </span>
      <span className={cn("truncate transition-opacity duration-150", expanded ? "opacity-100" : "sr-only opacity-0")}>
        {item.label}
      </span>
    </Link>
  );
}

/** Persistent mission-control navigation matching the accepted graph concept. */
export function Sidebar() {
  const pathname = usePathname();
  const { data: session } = useSession();
  const [expanded, setExpanded] = useState(false);
  const user = session?.user;
  const initials = user?.name
    ? user.name.split(" ").map((part) => part[0]).join("").toUpperCase().slice(0, 2)
    : "RJ";

  return (
    <nav
      aria-label="Primary"
      onMouseEnter={() => setExpanded(true)}
      onMouseLeave={() => setExpanded(false)}
      className={cn(
        "fixed bottom-0 left-0 top-16 z-50 flex flex-col overflow-hidden border-r border-[#152130] bg-[#06101a]/96 backdrop-blur-xl",
        "transition-[width,box-shadow] duration-200 ease-out motion-reduce:transition-none",
        expanded ? "w-[230px] shadow-[20px_0_60px_rgba(0,0,0,0.45)]" : "w-16"
      )}
    >
      <div className="flex h-11 shrink-0 items-center gap-3 border-b border-white/[0.045] px-3">
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          aria-label={expanded ? "Collapse navigation" : "Expand navigation"}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[#7f8ca0] outline-none transition-colors hover:bg-white/[0.05] hover:text-white focus-visible:ring-2 focus-visible:ring-violet-400/55"
        >
          {expanded ? <PanelLeftClose className="h-4 w-4" /> : <PanelLeftOpen className="h-4 w-4" />}
        </button>
        <span className={cn("truncate text-[10px] font-medium tracking-[0.11em] text-[#657389]", expanded ? "block" : "sr-only")}>
          NAVIGATION
        </span>
      </div>

      <div className="flex-1 overflow-y-auto px-2.5 py-3 xl:px-3">
        <ul className="space-y-0.5" role="list">
          {PRIMARY_NAV.map((item) => (
            <li key={item.id}>
              <NavLink
                item={item}
                expanded={expanded}
                active={isNavItemActive(item, pathname) || (pathname === "/visual-qa" && item.id === "chat")}
              />
            </li>
          ))}
        </ul>

        <div className="mt-7 border-t border-[#13202f] pt-5">
          <div className={cn("mb-2 items-center justify-between px-2.5", expanded ? "flex" : "hidden")}>
            <span className="text-[10px] font-medium tracking-[0.08em] text-[#758195]">WORKSPACES</span>
            <button
              type="button"
              aria-label="Create workspace"
              className="flex h-5 w-5 items-center justify-center rounded text-[#8793a6] hover:bg-white/[0.06] hover:text-white"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          </div>
          <ul className="space-y-0.5" role="list">
            {WORKSPACE_NAV.map((workspace) => (
              <li key={workspace.id}>
                <WorkspaceLink item={workspace} active={pathname.startsWith(workspace.href)} expanded={expanded} />
              </li>
            ))}
          </ul>
        </div>
      </div>

      <Link
        href="/settings"
        aria-label="Your profile and settings"
        className="flex h-[72px] shrink-0 items-center gap-3 border-t border-[#142131] px-[18px] hover:bg-white/[0.025]"
      >
        <span className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/10 bg-gradient-to-br from-sky-500/30 to-indigo-500/30 text-[11px] font-semibold text-white">
          {initials}
          <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-[#06101a] bg-emerald-400" />
        </span>
        <span className={cn("min-w-0 transition-opacity duration-150", expanded ? "block opacity-100" : "sr-only opacity-0")}>
          <span className="block truncate text-[12px] font-medium text-[#e8edf5]">{user?.name ?? "Rusty Johnson"}</span>
          <span className="block truncate text-[10px] text-[#7f8b9d]">Administrator</span>
        </span>
      </Link>
    </nav>
  );
}
