"use client";

import { useMemo, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";
import { ContextStrip } from "@/modules/mission-control/components/ContextStrip";

type ModuleTab = { id: string; label: string };
type ModuleConfig = { id: string; label: string; tabs: ModuleTab[]; defaultTab: string };

const CONFIGS: Array<{ match: (pathname: string) => boolean; config: ModuleConfig }> = [
  {
    match: (pathname) => pathname === "/chat" || pathname === "/visual-qa",
    config: {
      id: "chat",
      label: "CHAT",
      defaultTab: "mission",
      tabs: [
        { id: "mission", label: "Mission Control" },
        { id: "graph", label: "Knowledge Graph" },
        { id: "conversation", label: "Conversations" },
        { id: "sources", label: "Sources" },
        { id: "workflows", label: "Workflows" },
      ],
    },
  },
  {
    match: (pathname) => pathname.startsWith("/projects"),
    config: {
      id: "projects",
      label: "PROJECTS",
      defaultTab: "portfolio",
      tabs: [
        { id: "portfolio", label: "Portfolio" },
        { id: "active", label: "Active" },
        { id: "timeline", label: "Timeline" },
        { id: "reports", label: "Reports" },
      ],
    },
  },
  {
    match: (pathname) => pathname.startsWith("/memory"),
    config: {
      id: "knowledge",
      label: "KNOWLEDGE",
      defaultTab: "queue",
      tabs: [
        { id: "neural", label: "Neural Lens" },
        { id: "queue", label: "Learning Queue" },
        { id: "retrieval", label: "Retrieval Trace" },
        { id: "sources", label: "Sources" },
        { id: "memory", label: "Memory Candidates" },
        { id: "skills", label: "Skill Candidates" },
        { id: "contradictions", label: "Contradictions" },
        { id: "timeline", label: "Timeline" },
        { id: "graph", label: "Graph Inspector" },
      ],
    },
  },
  {
    match: (pathname) => pathname.startsWith("/agents"),
    config: {
      id: "agents",
      label: "AGENTS",
      defaultTab: "roster",
      tabs: [
        { id: "roster", label: "Roster" },
        { id: "activity", label: "Activity" },
        { id: "models", label: "Models" },
        { id: "tools", label: "Tools" },
        { id: "policies", label: "Policies" },
      ],
    },
  },
  {
    match: (pathname) =>
      pathname.startsWith("/orgchart") ||
      pathname.startsWith("/workspaces/organization"),
    config: {
      id: "organization",
      label: "ORGANIZATION",
      defaultTab: "chart",
      tabs: [
        { id: "chart", label: "Org Chart" },
        { id: "people", label: "People" },
        { id: "agents", label: "AI Agents" },
        { id: "teams", label: "Teams" },
        { id: "departments", label: "Departments" },
      ],
    },
  },
  {
    match: (pathname) => pathname.startsWith("/workflows"),
    config: {
      id: "workflows",
      label: "WORKFLOWS",
      defaultTab: "library",
      tabs: [
        { id: "library", label: "Library" },
        { id: "runs", label: "Runs" },
        { id: "approvals", label: "Approvals" },
        { id: "automations", label: "Automations" },
      ],
    },
  },
  {
    match: (pathname) => pathname.startsWith("/marketplace"),
    config: {
      id: "marketplace",
      label: "MARKETPLACE",
      defaultTab: "discover",
      tabs: [
        { id: "discover", label: "Discover" },
        { id: "installed", label: "Installed" },
        { id: "updates", label: "Updates" },
      ],
    },
  },
  {
    match: (pathname) => pathname.startsWith("/settings"),
    config: {
      id: "settings",
      label: "SETTINGS",
      defaultTab: "general",
      tabs: [
        { id: "general", label: "General" },
        { id: "security", label: "Security" },
        { id: "integrations", label: "Integrations" },
        { id: "billing", label: "Billing" },
      ],
    },
  },
];

const FALLBACK = CONFIGS[0].config;

export function ModuleTabs() {
  const pathname = usePathname();
  if (pathname === "/") return <ContextStrip />;
  return <StandardModuleTabs pathname={pathname} />;
}

function StandardModuleTabs({ pathname }: { pathname: string }) {
  const searchParams = useSearchParams();
  const config = useMemo(
    () => CONFIGS.find((entry) => entry.match(pathname))?.config ?? FALLBACK,
    [pathname]
  );
  const requestedTab = config.id === "chat" && searchParams.get("space") === "graph" ? "graph" : config.defaultTab;
  const [selection, setSelection] = useState({ moduleId: config.id, tabId: requestedTab });
  const activeTab = selection.moduleId === config.id ? selection.tabId : requestedTab;

  const selectTab = (tabId: string) => {
    setSelection({ moduleId: config.id, tabId });
    window.dispatchEvent(
      new CustomEvent("sentinel:module-tab", {
        detail: { moduleId: config.id, tabId },
      })
    );
  };

  return (
    <nav
      aria-label={`${config.label.toLowerCase()} module`}
      className="relative z-35 flex h-11 shrink-0 items-stretch border-b border-[#182338] bg-[#07101b]/96 px-3 backdrop-blur-xl"
    >
      <div className="flex shrink-0 items-center border-r border-white/[0.055] pr-3 text-[9px] font-semibold tracking-[0.13em] text-[#66758c]">
        {config.label}
      </div>
      <div className="flex min-w-0 flex-1 items-stretch gap-1 overflow-x-auto px-2" role="tablist">
        {config.tabs.map((tab) => {
          const active = tab.id === activeTab;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => selectTab(tab.id)}
              className={cn(
                "relative flex h-full shrink-0 items-center px-3 text-[10.5px] outline-none transition-colors",
                "focus-visible:bg-violet-500/10 focus-visible:text-white",
                active ? "text-[#f2efff]" : "text-[#8290a4] hover:text-[#d7ddeb]"
              )}
            >
              {tab.label}
              {active ? (
                <span className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-violet-500 shadow-[0_0_12px_rgba(139,92,246,0.75)]" />
              ) : null}
            </button>
          );
        })}
      </div>
      <div className="hidden shrink-0 items-center gap-2 pl-3 text-[9px] text-[#59677a] md:flex">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
        Live
      </div>
    </nav>
  );
}
