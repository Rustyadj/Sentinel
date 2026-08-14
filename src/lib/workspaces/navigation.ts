import { LENS_CONFIG } from "@/lib/lensRegistry";

export interface SubnavItem {
  id: string;
  label: string;
  href: string;
}

export interface WorkspaceNavDefinition {
  id: string;
  label: string;
  icon: string;
  route: string;
  color: string;
  subnav: SubnavItem[];
}

export interface PrimaryNavItem {
  id: string;
  label: string;
  icon: string;
  href: string;
  exact?: boolean;
}

export const PRIMARY_NAV: PrimaryNavItem[] = [
  { id: "home", label: "Home", icon: "Home", href: "/", exact: true },
  { id: "chat", label: "Chat", icon: "MessageSquare", href: "/chat" },
  { id: "projects", label: "Projects", icon: "Folder", href: "/projects" },
  { id: "agents", label: "Agents", icon: "Bot", href: "/agents" },
  { id: "memory", label: "Memory", icon: "BookOpen", href: "/memory" },
  { id: "files", label: "Files", icon: "FileStack", href: "/files" },
  { id: "workspaces", label: "Workspaces", icon: "LayoutGrid", href: "/workspaces" },
  { id: "marketplace", label: "Marketplace", icon: "Package", href: "/marketplace" },
];

export const SETTINGS_NAV: PrimaryNavItem = {
  id: "settings",
  label: "Settings",
  icon: "Settings",
  href: "/settings",
};

// Tab rows come straight from the lens registry (lib/lensRegistry.ts) —
// Overview is always first and lands on the canonical Sentinel graph focused
// on this lens's cluster; the rest are the workspace's normal application
// tabs. Sidebar-only fields (label/icon/color/route) stay defined here since
// they're app-shell chrome, not lens concerns.
export const WORKSPACE_NAV: WorkspaceNavDefinition[] = [
  {
    id: "cybersecurity",
    label: "Cybersecurity",
    icon: "Shield",
    route: LENS_CONFIG.cybersecurity.route,
    color: LENS_CONFIG.cybersecurity.accent,
    subnav: LENS_CONFIG.cybersecurity.tabs,
  },
  {
    id: "organization",
    label: "Organization",
    icon: "Building2",
    route: LENS_CONFIG.organization.route,
    color: LENS_CONFIG.organization.accent,
    subnav: LENS_CONFIG.organization.tabs,
  },
  {
    id: "studio",
    label: "Studio",
    icon: "Wand2",
    route: LENS_CONFIG.studio.route,
    color: LENS_CONFIG.studio.accent,
    subnav: LENS_CONFIG.studio.tabs,
  },
  {
    id: "marketing",
    label: "Marketing",
    icon: "Megaphone",
    route: LENS_CONFIG.marketing.route,
    color: LENS_CONFIG.marketing.accent,
    subnav: LENS_CONFIG.marketing.tabs,
  },
];

export function getActiveWorkspace(pathname: string) {
  return WORKSPACE_NAV.find((workspace) => pathname.startsWith(workspace.route));
}

export function getActiveNavLabel(pathname: string): string {
  if (pathname.startsWith("/workspaces")) {
    return getActiveWorkspace(pathname)?.label ?? "Workspaces";
  }
  return (
    PRIMARY_NAV.find((item) =>
      item.exact ? pathname === item.href : pathname.startsWith(item.href)
    ) ?? SETTINGS_NAV
  ).label;
}
