// Sentinel OS — global navigation model.
// Single source of truth for the sidebar hierarchy. Icons are referenced by
// name so this module stays server-safe (no lucide imports here).

export interface NavItem {
  id: string;
  label: string;
  icon: string;
  href: string;
  exact?: boolean;
}

export interface WorkspaceNavItem extends NavItem {
  /** Restrained accent used only for the workspace glyph. */
  color: string;
}

// Sentinel core shell nav. Domain modules (Organization console, Cybersecurity,
// AI Studio, Marketing, Kanban, Workflows, Marketplace, Learning Core) are
// intentionally not listed here — their routes and data are untouched, they
// are just no longer part of the primary shell surface. See docs/ARCHITECTURE.md.
export const PRIMARY_NAV: NavItem[] = [
  { id: "home",       label: "Home",       icon: "Home",          href: "/", exact: true },
  { id: "chat",       label: "Chat",       icon: "MessageSquare", href: "/chat" },
  { id: "agents",     label: "Agents",     icon: "Bot",           href: "/agents" },
  { id: "bots",       label: "Bots",       icon: "Boxes",         href: "/bots" },
  { id: "tasks",      label: "Tasks",      icon: "ListChecks",    href: "/tasks" },
  { id: "workspaces", label: "Workspaces", icon: "LayoutGrid",    href: "/workspaces" },
  { id: "agent-workspaces", label: "Agent Computers", icon: "HardDrive", href: "/agent-workspaces" },
  { id: "memory",     label: "Memory",     icon: "BookOpen",      href: "/memory" },
  { id: "graph",      label: "Graph",      icon: "Network",       href: "/chat?space=graph" },
  { id: "activity",   label: "Activity",   icon: "Activity",      href: "/activity" },
  { id: "search",     label: "Search",     icon: "Search",        href: "/search" },
  { id: "settings",   label: "Settings",   icon: "Settings",      href: "/settings" },
];

// Domain-specific workspace shortcuts have been removed from the shell rail
// per the core-shell rebuild — they remain reachable from /workspaces.
export const WORKSPACE_NAV: WorkspaceNavItem[] = [];

/**
 * The product sidebar. Grouped by what you came to do: work with people and
 * agents, watch what the agents are doing, run them, and look after the team.
 * `guest` marks the entries a project guest can reach; the rest are hidden
 * from them because the server would refuse them anyway.
 */
export interface NavGroup { id: string; label: string; items: Array<NavItem & { guest?: boolean }> }

export const SHELL_NAV_GROUPS: NavGroup[] = [
  {
    id: "work", label: "Work", items: [
      { id: "chat",       label: "Chat",       icon: "MessageSquare", href: "/chat", guest: true },
      { id: "roundtable", label: "Roundtable", icon: "MessagesSquare", href: "/roundtable", guest: true },
      { id: "projects",   label: "Projects",   icon: "FolderKanban",  href: "/projects", guest: true },
      { id: "tasks",      label: "Tasks",      icon: "ListChecks",    href: "/tasks" },
    ],
  },
  {
    id: "watch", label: "Watch", items: [
      { id: "graph",    label: "Live graph", icon: "Radar",    href: "/graph" },
      { id: "activity", label: "Activity",   icon: "Activity", href: "/activity" },
      { id: "memory",   label: "Memory",     icon: "BookOpen", href: "/memory" },
    ],
  },
  {
    id: "run", label: "Run", items: [
      { id: "agents",     label: "Agents",     icon: "Bot",       href: "/agents" },
      { id: "bots",       label: "Bots",       icon: "Boxes",     href: "/bots" },
      { id: "workspaces", label: "Workspaces", icon: "HardDrive", href: "/agent-workspaces" },
    ],
  },
  {
    id: "team", label: "Team", items: [
      { id: "people",  label: "People",  icon: "Users",     href: "/people" },
      // Where each change currently sits and whether production matches main.
      { id: "control", label: "Control", icon: "GitBranch", href: "/control" },
    ],
  },
];

export const SHELL_NAV: NavItem[] = SHELL_NAV_GROUPS.flatMap((group) => group.items);

/** Global, always-available, never a primary destination. */
export const SHELL_SECONDARY_NAV: NavItem[] = [
  { id: "search", label: "Search", icon: "Search", href: "/search" },
  { id: "settings", label: "Settings", icon: "Settings", href: "/settings" },
];

export function isNavItemActive(item: NavItem, pathname: string): boolean {
  return item.exact ? pathname === item.href : pathname.startsWith(item.href);
}
