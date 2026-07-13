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
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  PRIMARY_NAV,
  SETTINGS_NAV,
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
        "group/item relative flex h-10 items-center gap-3 rounded-lg px-3 text-sm transition",
        isActive
          ? "bg-violet-500/12 text-violet-200"
          : "text-slate-400 hover:bg-white/[0.045] hover:text-slate-100",
      )}
    >
      {isActive && (
        <span className="absolute -left-2 h-6 w-0.5 rounded-r-full bg-violet-400 shadow-[0_0_12px_rgba(167,139,250,.8)]" />
      )}
      <Icon className="h-[18px] w-[18px] shrink-0" />
      <span className="whitespace-nowrap opacity-0 transition-opacity duration-150 group-hover/rail:opacity-100">
        {item.label}
      </span>
    </Link>
  );
}

function SubItem({ item, isActive }: { item: SubnavItem; isActive: boolean }) {
  return (
    <Link
      href={item.href}
      className={cn(
        "flex h-8 items-center rounded-md pl-10 pr-3 text-xs transition",
        isActive
          ? "bg-violet-500/10 text-violet-200"
          : "text-slate-500 hover:bg-white/[0.04] hover:text-slate-200",
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
    <aside className="group/rail relative z-40 hidden h-full w-16 shrink-0 flex-col overflow-hidden border-r border-[#202937] bg-[#080c13] shadow-[12px_0_36px_rgba(0,0,0,.18)] transition-[width] duration-200 ease-out hover:w-60 md:flex">
      <nav className="flex-1 space-y-1 overflow-y-auto overflow-x-hidden px-2 py-3">
        {PRIMARY_NAV.map((item) => {
          const isActive =
            pathname === item.href ||
            (item.href !== "/" && pathname.startsWith(item.href));
          return <PrimaryItem key={item.id} item={item} isActive={isActive} />;
        })}

        {activeWorkspace && activeWorkspace.subnav.length > 0 && (
          <div className="mt-4 border-t border-[#202937] pt-3 opacity-0 transition-opacity duration-150 group-hover/rail:opacity-100">
            <div
              className="mb-2 px-3 text-[9px] font-bold uppercase tracking-[0.18em]"
              style={{ color: activeWorkspace.color }}
            >
              {activeWorkspace.label}
            </div>
            {activeWorkspace.subnav.map((item) => (
              <SubItem
                key={item.id}
                item={item}
                isActive={pathname === item.href}
              />
            ))}
          </div>
        )}
      </nav>

      <div className="shrink-0 border-t border-[#202937] p-2">
        <div className="mb-2 hidden rounded-lg border border-emerald-400/10 bg-emerald-400/[0.035] p-2.5 group-hover/rail:block">
          <div className="flex items-center gap-2">
            <span className="grid h-7 w-7 place-items-center rounded-lg bg-emerald-400/10">
              <span className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_12px_rgba(52,211,153,.8)]" />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-[11px] font-semibold text-slate-200">
                Hermes Lisa
              </span>
              <span className="block text-[9px] text-emerald-400">Online</span>
            </span>
          </div>
        </div>
        <PrimaryItem
          item={SETTINGS_NAV}
          isActive={pathname.startsWith("/settings")}
        />
      </div>
    </aside>
  );
}
