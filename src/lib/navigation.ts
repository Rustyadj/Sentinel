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

export const PRIMARY_NAV: NavItem[] = [
  { id: "home",         label: "Mission Control", icon: "Home",          href: "/", exact: true },
  { id: "chat",         label: "Chat",         icon: "MessageSquare", href: "/chat" },
  { id: "projects",     label: "Projects",     icon: "Folder",        href: "/projects" },
  { id: "knowledge",    label: "Knowledge",    icon: "BookOpen",      href: "/memory" },
  { id: "agents",       label: "Agents",       icon: "Bot",           href: "/agents" },
  { id: "organization", label: "Organization", icon: "Building2",     href: "/orgchart" },
  { id: "workflows",    label: "Workflows",    icon: "GitBranch",     href: "/workflows" },
  { id: "marketplace",  label: "Marketplace",  icon: "Package",       href: "/marketplace" },
  { id: "settings",     label: "Settings",     icon: "Settings",      href: "/settings" },
];

export const WORKSPACE_NAV: WorkspaceNavItem[] = [
  { id: "studio",        label: "AI Studio",     icon: "Wand2",        href: "/workspaces/studio",        color: "#8B5CF6" },
  { id: "cybersecurity", label: "Cybersecurity", icon: "Shield",       href: "/workspaces/cybersecurity", color: "#EF4444" },
  { id: "marketing",     label: "Marketing",     icon: "Megaphone",    href: "/workspaces/marketing",     color: "#F59E0B" },
  { id: "icf",           label: "ICF",           icon: "Landmark",     href: "/workspaces/icf",           color: "#06B6D4" },
  { id: "development",   label: "Development",   icon: "Code2",        href: "/workspaces/development",   color: "#3B82F6" },
  { id: "finance",       label: "Finance",       icon: "DollarSign",   href: "/workspaces/finance",       color: "#10B981" },
  { id: "research",      label: "Research",      icon: "FlaskConical", href: "/workspaces/research",      color: "#A78BFA" },
];

export function isNavItemActive(item: NavItem, pathname: string): boolean {
  return item.exact ? pathname === item.href : pathname.startsWith(item.href);
}
