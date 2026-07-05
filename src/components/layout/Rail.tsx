"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Home,
  MessageSquare,
  Folder,
  Bot,
  BookOpen,
  FileStack,
  LayoutGrid,
  Package,
  Settings,
  Shield,
  Building2,
  Wand2,
  Megaphone,
  DollarSign,
  Cpu,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  PRIMARY_NAV,
  SETTINGS_NAV,
  WORKSPACES,
  getActiveWorkspace,
  type PrimaryNavItem,
  type SubnavItem,
} from "@/lib/workspaces";

const ICON_MAP: Record<string, LucideIcon> = {
  Home,
  MessageSquare,
  Folder,
  Bot,
  BookOpen,
  FileStack,
  LayoutGrid,
  Package,
  Settings,
  Shield,
  Building2,
  Wand2,
  Megaphone,
  DollarSign,
};

function PrimaryItem({
  item,
  isActive,
}: {
  item: PrimaryNavItem;
  isActive: boolean;
}) {
  const Icon = ICON_MAP[item.icon] ?? Home;
  return (
    <Link
      href={item.href}
      title={item.label}
      className={cn(
        "flex items-center gap-3 h-9 px-3 rounded-md transition-colors",
        isActive
          ? "bg-[--primary]/15 text-[--primary]"
          : "text-[--muted-foreground] hover:bg-white/5 hover:text-[--foreground]"
      )}
    >
      <Icon className="w-4 h-4 shrink-0" />
      <span className="text-sm whitespace-nowrap opacity-0 group-hover/rail:opacity-100 transition-opacity duration-100 delay-75">
        {item.label}
      </span>
    </Link>
  );
}

function SubItem({
  item,
  isActive,
}: {
  item: SubnavItem;
  isActive: boolean;
}) {
  return (
    <Link
      href={item.href}
      className={cn(
        "flex items-center h-7 pl-10 pr-3 rounded text-xs transition-colors whitespace-nowrap",
        isActive
          ? "text-[--primary] bg-[--primary]/10"
          : "text-[--muted-foreground] hover:bg-white/5 hover:text-[--foreground]"
      )}
    >
      {item.label}
    </Link>
  );
}

export function Rail() {
  const pathname = usePathname();
  const activeWorkspace = getActiveWorkspace(pathname);

  return (
    <aside
      className={cn(
        "group/rail fixed left-0 top-0 h-full z-40 flex flex-col",
        "w-14 hover:w-60 transition-[width] duration-200 ease-out overflow-hidden",
        "bg-[--sidebar] border-r border-[--sidebar-border]"
      )}
    >
      {/* Logo */}
      <div className="h-14 shrink-0 flex items-center gap-3 px-3 border-b border-[--sidebar-border]">
        <div className="w-8 h-8 shrink-0 flex items-center justify-center rounded-lg bg-[--primary]/10">
          <Cpu className="w-4 h-4 text-[--primary]" />
        </div>
        <div className="opacity-0 group-hover/rail:opacity-100 transition-opacity duration-100 delay-75 min-w-0">
          <div className="text-sm font-semibold text-[--foreground] leading-none whitespace-nowrap">
            Sentinel OS
          </div>
          <div className="text-[10px] text-[--muted-foreground] leading-none mt-0.5 whitespace-nowrap">
            AI Workspace
          </div>
        </div>
      </div>

      {/* Primary nav */}
      <nav className="flex-1 overflow-y-auto overflow-x-hidden py-2 px-2 space-y-0.5">
        {PRIMARY_NAV.map((item) => {
          const isActive = item.exact
            ? pathname === item.href
            : item.id === "workspaces"
            ? pathname.startsWith("/workspaces")
            : pathname.startsWith(item.href);
          return <PrimaryItem key={item.id} item={item} isActive={isActive} />;
        })}

        {/* Workspace subnav — visible only when rail is expanded (hover) */}
        {activeWorkspace && activeWorkspace.subnav.length > 0 && (
          <div className="mt-3 pt-2 border-t border-[--sidebar-border] space-y-0.5">
            <div className="px-3 mb-1 opacity-0 group-hover/rail:opacity-100 transition-opacity duration-100 delay-75">
              <span
                className="text-[10px] font-semibold uppercase tracking-widest whitespace-nowrap"
                style={{ color: activeWorkspace.color }}
              >
                {activeWorkspace.label}
              </span>
            </div>
            {activeWorkspace.subnav.map((sub) => {
              const isActive = pathname === sub.href;
              return (
                <div
                  key={sub.id}
                  className="opacity-0 group-hover/rail:opacity-100 transition-opacity duration-100 delay-75"
                >
                  <SubItem item={sub} isActive={isActive} />
                </div>
              );
            })}
          </div>
        )}
      </nav>

      {/* Settings — pinned at bottom */}
      <div className="shrink-0 border-t border-[--sidebar-border] px-2 py-2">
        <PrimaryItem
          item={SETTINGS_NAV}
          isActive={pathname.startsWith("/settings")}
        />
      </div>
    </aside>
  );
}
