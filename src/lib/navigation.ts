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
  { id: "tasks",      label: "Tasks",      icon: "ListChecks",    href: "/tasks" },
  { id: "workspaces", label: "Workspaces", icon: "LayoutGrid",    href: "/workspaces" },
  { id: "memory",     label: "Memory",     icon: "BookOpen",      href: "/memory" },
  { id: "graph",      label: "Graph",      icon: "Network",       href: "/chat?space=graph" },
  { id: "activity",   label: "Activity",   icon: "Activity",      href: "/activity" },
  { id: "settings",   label: "Settings",   icon: "Settings",      href: "/settings" },
];

// Domain-specific workspace shortcuts have been removed from the shell rail
// per the core-shell rebuild — they remain reachable from /workspaces.
export const WORKSPACE_NAV: WorkspaceNavItem[] = [];

export function isNavItemActive(item: NavItem, pathname: string): boolean {
  return item.exact ? pathname === item.href : pathname.startsWith(item.href);
}
