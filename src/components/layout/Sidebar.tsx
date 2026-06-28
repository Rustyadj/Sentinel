"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  MessageSquare,
  Bot,
  BookOpen,
  Wand2,
  Shield,
  GitBranch,
  Kanban,
  Network,
  BarChart3,
  Settings,
  ChevronLeft,
  ChevronRight,
  Cpu,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { NAV_MODULES } from "@/lib/constants";
import { useAppStore } from "@/store/useAppStore";
import { useAgentStore } from "@/store/useAgentStore";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { STATUS_COLORS } from "@/lib/constants";

const ICON_MAP: Record<string, LucideIcon> = {
  LayoutDashboard,
  MessageSquare,
  Bot,
  BookOpen,
  Wand2,
  Shield,
  GitBranch,
  Kanban,
  Network,
  BarChart3,
  Settings,
};

export function Sidebar() {
  const pathname = usePathname();
  const { sidebarCollapsed, toggleSidebar } = useAppStore();
  const { agents } = useAgentStore();

  const onlineCount = agents.filter((a) => a.status === "online").length;

  return (
    <TooltipProvider delayDuration={200}>
      <aside
        className={cn(
          "flex flex-col h-full border-r border-[--sidebar-border] bg-[--sidebar] transition-all duration-200",
          sidebarCollapsed ? "w-14" : "w-56"
        )}
      >
        {/* Logo */}
        <div
          className={cn(
            "flex items-center h-14 border-b border-[--sidebar-border] px-3 shrink-0",
            sidebarCollapsed ? "justify-center" : "justify-between"
          )}
        >
          {sidebarCollapsed ? (
            <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-[--primary]/10">
              <Cpu className="w-4 h-4 text-[--primary]" />
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2">
                <div className="flex items-center justify-center w-7 h-7 rounded-lg bg-[--primary]/10">
                  <Cpu className="w-3.5 h-3.5 text-[--primary]" />
                </div>
                <div>
                  <div className="text-sm font-semibold text-[--foreground] leading-none">
                    Sentinel OS
                  </div>
                  <div className="text-[10px] text-[--muted-foreground] leading-none mt-0.5">
                    Mission Control
                  </div>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-0.5">
          {NAV_MODULES.map((module) => {
            const Icon = ICON_MAP[module.icon] ?? LayoutDashboard;
            const isActive = pathname.startsWith(module.href);

            if (sidebarCollapsed) {
              return (
                <Tooltip key={module.id}>
                  <TooltipTrigger asChild>
                    <Link
                      href={module.href}
                      className={cn(
                        "flex items-center justify-center w-10 h-10 rounded-md mx-auto transition-colors",
                        isActive
                          ? "bg-[--primary]/15 text-[--primary]"
                          : "text-[--muted-foreground] hover:bg-[--accent] hover:text-[--foreground]"
                      )}
                    >
                      <Icon className="w-4 h-4" />
                    </Link>
                  </TooltipTrigger>
                  <TooltipContent side="right">{module.label}</TooltipContent>
                </Tooltip>
              );
            }

            return (
              <Link
                key={module.id}
                href={module.href}
                className={cn(
                  "flex items-center gap-2.5 px-2.5 py-2 rounded-md text-sm transition-colors",
                  isActive
                    ? "bg-[--primary]/15 text-[--primary]"
                    : "text-[--muted-foreground] hover:bg-[--accent] hover:text-[--foreground]"
                )}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span className="truncate">{module.label}</span>
              </Link>
            );
          })}
        </nav>

        {/* Agent status strip */}
        {!sidebarCollapsed && (
          <div className="px-3 pb-2 border-t border-[--sidebar-border] pt-3">
            <div className="text-[10px] uppercase tracking-widest text-[--muted-foreground] mb-2 px-0.5">
              Active Agents
            </div>
            <div className="flex flex-wrap gap-1.5">
              {agents.slice(0, 4).map((agent) => (
                <Tooltip key={agent.id}>
                  <TooltipTrigger asChild>
                    <div className="relative">
                      <div
                        className="w-7 h-7 rounded-full flex items-center justify-center text-xs border border-[--border]"
                        style={{ backgroundColor: agent.color + "22" }}
                      >
                        {agent.avatar}
                      </div>
                      <span
                        className="absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full border border-[--sidebar] animate-pulse-dot"
                        style={{
                          backgroundColor:
                            STATUS_COLORS[agent.status] ?? "#64748B",
                        }}
                      />
                    </div>
                  </TooltipTrigger>
                  <TooltipContent side="top">
                    {agent.name} · {agent.status}
                  </TooltipContent>
                </Tooltip>
              ))}
              {agents.length > 4 && (
                <div className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] bg-[--muted] text-[--muted-foreground] border border-[--border]">
                  +{agents.length - 4}
                </div>
              )}
            </div>
            <div className="mt-2 text-[10px] text-[--muted-foreground]">
              <span className="text-emerald-400">{onlineCount}</span> of{" "}
              {agents.length} online
            </div>
          </div>
        )}

        {/* Collapse toggle */}
        <div className="border-t border-[--sidebar-border] p-2">
          <button
            onClick={toggleSidebar}
            className={cn(
              "flex items-center gap-2 w-full px-2 py-2 rounded-md text-xs text-[--muted-foreground] hover:bg-[--accent] hover:text-[--foreground] transition-colors",
              sidebarCollapsed ? "justify-center" : ""
            )}
          >
            {sidebarCollapsed ? (
              <ChevronRight className="w-3.5 h-3.5" />
            ) : (
              <>
                <ChevronLeft className="w-3.5 h-3.5" />
                <span>Collapse</span>
              </>
            )}
          </button>
        </div>
      </aside>
    </TooltipProvider>
  );
}
