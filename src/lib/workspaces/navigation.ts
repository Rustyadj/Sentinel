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

export const WORKSPACE_NAV: WorkspaceNavDefinition[] = [
  {
    id: "cybersecurity",
    label: "Cybersecurity",
    icon: "Shield",
    route: "/workspaces/cybersecurity",
    color: "#EF4444",
    subnav: [
      { id: "range", label: "Range Console", href: "/workspaces/cybersecurity" },
      { id: "red-team", label: "Red Team", href: "/workspaces/cybersecurity/red-team" },
      { id: "blue-team", label: "Blue Team", href: "/workspaces/cybersecurity/blue-team" },
      { id: "marketplace", label: "Marketplace", href: "/marketplace" },
    ],
  },
  {
    id: "organization",
    label: "Organization",
    icon: "Building2",
    route: "/workspaces/organization",
    color: "#3B82F6",
    subnav: [
      { id: "dashboard", label: "Dashboard", href: "/workspaces/organization" },
      { id: "org-chart", label: "Org Chart", href: "/workspaces/organization/org-chart" },
      { id: "teams", label: "Teams", href: "/workspaces/organization/teams" },
      { id: "projects", label: "Projects", href: "/workspaces/organization/projects" },
      { id: "board", label: "Board", href: "/workspaces/organization/board" },
      { id: "documents", label: "Documents", href: "/workspaces/organization/documents" },
      { id: "meetings", label: "Meetings", href: "/workspaces/organization/meetings" },
      { id: "permissions", label: "Permissions", href: "/workspaces/organization/permissions" },
      { id: "approvals", label: "Approvals", href: "/workspaces/organization/approvals" },
    ],
  },
  {
    id: "studio",
    label: "Studio",
    icon: "Wand2",
    route: "/workspaces/studio",
    color: "#8B5CF6",
    subnav: [{ id: "builder", label: "Builder", href: "/workspaces/studio" }],
  },
  {
    id: "marketing",
    label: "Marketing",
    icon: "Megaphone",
    route: "/workspaces/marketing",
    color: "#F59E0B",
    subnav: [{ id: "dashboard", label: "Dashboard", href: "/workspaces/marketing" }],
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
