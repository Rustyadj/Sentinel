"use client";

import { useMemo, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { PanelRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/store/useAppStore";
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
      defaultTab: "graph",
      tabs: [
        { id: "graph", label: "Graph" },
        { id: "documents", label: "Documents" },
        { id: "memories", label: "Memories" },
        { id: "sources", label: "Sources" },
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
    match: (pathname) => pathname.startsWith("/security") || pathname.startsWith("/workspaces/cybersecurity"),
    config: {
      id: "cybersecurity",
      label: "RANGE CONSOLE",
      defaultTab: "overview",
      // Range Console's full information architecture (see the Sentinel Range
      // Console spec). Only Overview is implemented today — the rest render
      // an explicit not-yet-built state, same convention as Learning Core's
      // unimplemented tabs, rather than a silent dead click.
      tabs: [
        { id: "ai-security", label: "AI Security" },
        { id: "overview", label: "Overview" },
        { id: "operations", label: "Operations" },
        { id: "red-team", label: "Red Team" },
        { id: "blue-team", label: "Blue Team" },
        { id: "purple-team", label: "Purple Team" },
        { id: "attack-paths", label: "Attack Paths" },
        { id: "assets", label: "Assets" },
        { id: "vulnerabilities", label: "Vulnerabilities" },
        { id: "threat-intel", label: "Threat Intelligence" },
        { id: "phishing", label: "Phishing" },
        { id: "detection-engineering", label: "Detection Engineering" },
        { id: "workflows", label: "Workflows" },
        { id: "reports", label: "Reports" },
        { id: "chat", label: "Chat" },
        { id: "settings", label: "Settings" },
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
  {
    match: (pathname) => pathname.startsWith("/learning"),
    config: {
      id: "learning",
      label: "LEARNING CORE",
      defaultTab: "overview",
      // Tabs without a Phase implementation render an explicit not-yet-built
      // state rather than silently doing nothing when clicked.
      // See docs/LEARNING_CORE_ON_NEURAL_ENGINE.md for the phase plan.
      tabs: [
        { id: "overview", label: "Overview" },
        { id: "curiosity", label: "Curiosity" },
        { id: "reflections", label: "Reflections" },
        { id: "preferences", label: "Preferences" },
        { id: "knowledge-gaps", label: "Knowledge Gaps" },
        { id: "hypotheses", label: "Candidates" },
        { id: "evolution-archive", label: "Evolution" },
        { id: "evaluations", label: "Evaluations" },
        { id: "experiments", label: "Experience Replay" },
        { id: "shadow-runs", label: "Shadow Runs" },
        { id: "adversarial", label: "Adversarial" },
        { id: "benchmarks", label: "Benchmarks" },
        { id: "principles", label: "Principles" },
        { id: "memory-health", label: "Memory Health" },
        { id: "skills", label: "Skills" },
        { id: "improvement-queue", label: "Improvement Queue" },
        { id: "trust", label: "Trust" },
        { id: "guardian", label: "Guardian" },
        { id: "feature-flags", label: "Feature Flags" },
        { id: "evolution", label: "Evolution Timeline" },
        { id: "learning-settings", label: "Settings" },
      ],
    },
  },
];

/** Screens without section tabs still get a title bar, named after the route. */
const ROUTE_TITLES: Record<string, string> = {
  activity: "Activity", bots: "Bots", builder: "Builder", files: "Files", kanban: "Kanban",
  marketing: "Marketing", orgchart: "Org chart", search: "Search", tasks: "Tasks", workspaces: "Workspaces",
  projects: "Projects", chat: "Chat",
};

function fallbackConfig(pathname: string): ModuleConfig {
  const segment = pathname.split("/")[1] ?? "";
  const label = ROUTE_TITLES[segment] ?? (segment ? segment.replace(/-/g, " ") : "Sentinel");
  return { id: segment || "home", label: label.toUpperCase(), tabs: [], defaultTab: "" };
}

export function ModuleTabs({ rightPanel = false }: { rightPanel?: boolean }) {
  const pathname = usePathname();
  if (pathname === "/") return <ContextStrip />;
  return <StandardModuleTabs pathname={pathname} rightPanel={rightPanel} />;
}

function StandardModuleTabs({ pathname, rightPanel }: { pathname: string; rightPanel: boolean }) {
  const searchParams = useSearchParams();
  const { rightPanelOpen, setRightPanelOpen } = useAppStore();
  const config = useMemo(
    () => CONFIGS.find((entry) => entry.match(pathname))?.config ?? fallbackConfig(pathname),
    [pathname]
  );
  const linkedTab = searchParams.get("tab");
  const requestedTab = config.id === "learning" && config.tabs.some(tab => tab.id === linkedTab) ? linkedTab! : config.id === "chat" && searchParams.get("space") === "graph" ? "graph" : config.defaultTab;
  const [selection, setSelection] = useState({ moduleId: config.id, tabId: requestedTab, requestedTab });
  const activeTab = selection.moduleId === config.id && selection.requestedTab === requestedTab ? selection.tabId : requestedTab;

  const selectTab = (tabId: string) => {
    setSelection({ moduleId: config.id, tabId, requestedTab });
    window.dispatchEvent(
      new CustomEvent("sentinel:module-tab", {
        detail: { moduleId: config.id, tabId },
      })
    );
  };

  const title = ROUTE_TITLES[config.id] ?? config.label.charAt(0) + config.label.slice(1).toLowerCase();

  return (
    <nav
      aria-label={`${title} sections`}
      className="flex h-full min-w-0 flex-1 items-stretch gap-2"
    >
      <h1 className={cn("shrink-0 items-center pr-3 font-display text-[16px] font-semibold tracking-tight text-(--foreground)", config.tabs.length ? "hidden sm:flex" : "flex")}>
        {title}
      </h1>
      <div className="flex min-w-0 flex-1 items-stretch gap-0.5 overflow-x-auto [scrollbar-width:none]" role="tablist">
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
                "relative my-2.5 flex shrink-0 items-center rounded-md px-2.5 text-[13px] outline-none transition-colors",
                "focus-visible:ring-2 focus-visible:ring-(--ring)",
                active ? "text-(--foreground)" : "text-(--muted-foreground) hover:bg-(--panel) hover:text-(--foreground)"
              )}
            >
              {tab.label}
              {active ? (
                <span aria-hidden className="absolute inset-x-2.5 -bottom-2.5 h-[2px] rounded-full bg-(--primary)" />
              ) : null}
            </button>
          );
        })}
      </div>
      {rightPanel ? (
        <button
          type="button"
          onClick={() => setRightPanelOpen(!rightPanelOpen)}
          aria-pressed={rightPanelOpen}
          aria-label={rightPanelOpen ? "Hide context panel" : "Show context panel"}
          title={rightPanelOpen ? "Hide context panel" : "Show context panel"}
          className={cn(
            "my-2.5 hidden shrink-0 items-center gap-2 rounded-md px-2.5 text-[12px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--ring) xl:flex",
            rightPanelOpen ? "bg-(--muted) text-(--foreground)" : "text-(--muted-foreground) hover:bg-(--panel) hover:text-(--foreground)",
          )}
        >
          <PanelRight aria-hidden className="h-4 w-4" />
          Context
        </button>
      ) : null}
    </nav>
  );
}
