export interface SubnavItem {
  id: string;
  label: string;
  href: string;
}

export interface WorkspaceDef {
  id: string;
  label: string;
  icon: string;
  route: string;
  description: string;
  subnav: SubnavItem[];
  enabled: boolean;
  badge?: string;
  color: string;
}

export interface PrimaryNavItem {
  id: string;
  label: string;
  icon: string;
  href: string;
  exact?: boolean;
}

export const PRIMARY_NAV: PrimaryNavItem[] = [
  { id: "home",        label: "Home",        icon: "Home",          href: "/",            exact: true },
  { id: "chat",        label: "Chat",         icon: "MessageSquare", href: "/chat" },
  { id: "projects",    label: "Projects",     icon: "Folder",        href: "/projects" },
  { id: "agents",      label: "Agents",       icon: "Bot",           href: "/agents" },
  { id: "memory",      label: "Memory",       icon: "BookOpen",      href: "/memory" },
  { id: "files",       label: "Files",        icon: "FileStack",     href: "/files" },
  { id: "workspaces",  label: "Workspaces",   icon: "LayoutGrid",    href: "/workspaces" },
  { id: "marketplace", label: "Marketplace",  icon: "Package",       href: "/marketplace" },
];

export const SETTINGS_NAV: PrimaryNavItem = {
  id: "settings",
  label: "Settings",
  icon: "Settings",
  href: "/settings",
};

export const WORKSPACES: WorkspaceDef[] = [
  {
    id: "cybersecurity",
    label: "Cybersecurity",
    icon: "Shield",
    route: "/workspaces/cybersecurity",
    description: "Red/blue team ops, threat intel, and attack simulation",
    color: "#EF4444",
    enabled: true,
    subnav: [
      { id: "range",           label: "Range Console",     href: "/workspaces/cybersecurity" },
      { id: "red-team",        label: "Red Team",          href: "/workspaces/cybersecurity/red-team" },
      { id: "blue-team",       label: "Blue Team",         href: "/workspaces/cybersecurity/blue-team" },
      { id: "purple-team",     label: "Purple Team",       href: "/workspaces/cybersecurity/purple-team" },
      { id: "intelligence",    label: "Intelligence",      href: "/workspaces/cybersecurity/intelligence" },
      { id: "threat-intel",    label: "Threat Intel",      href: "/workspaces/cybersecurity/threat-intel" },
      { id: "vulnerabilities", label: "Vulnerabilities",   href: "/workspaces/cybersecurity/vulnerabilities" },
      { id: "attack-chains",   label: "Attack Chains",     href: "/workspaces/cybersecurity/attack-chains" },
      { id: "exploits",        label: "Exploits",          href: "/workspaces/cybersecurity/exploits" },
      { id: "phishing",        label: "Phishing Templates",href: "/workspaces/cybersecurity/phishing" },
      { id: "hosts",           label: "Hosts & Assets",    href: "/workspaces/cybersecurity/hosts" },
      { id: "reports",         label: "Reports",           href: "/workspaces/cybersecurity/reports" },
      { id: "ws-marketplace",  label: "Marketplace",       href: "/workspaces/cybersecurity/marketplace" },
      { id: "ws-settings",     label: "Settings",          href: "/workspaces/cybersecurity/settings" },
    ],
  },
  {
    id: "organization",
    label: "Organization",
    icon: "Building2",
    route: "/workspaces/organization",
    description: "Team management, org chart, and project coordination",
    color: "#3B82F6",
    enabled: true,
    subnav: [
      { id: "dashboard",   label: "Dashboard",   href: "/workspaces/organization" },
      { id: "org-chart",   label: "Org Chart",   href: "/workspaces/organization/org-chart" },
      { id: "teams",       label: "Teams",       href: "/workspaces/organization/teams" },
      { id: "projects",    label: "Projects",    href: "/workspaces/organization/projects" },
      { id: "workflows",   label: "Workflows",   href: "/workspaces/organization/workflows" },
      { id: "board",       label: "Board",       href: "/workspaces/organization/board" },
      { id: "documents",   label: "Documents",   href: "/workspaces/organization/documents" },
      { id: "meetings",    label: "Meetings",    href: "/workspaces/organization/meetings" },
      { id: "ai-agents",   label: "AI Agents",   href: "/workspaces/organization/ai-agents" },
      { id: "permissions", label: "Permissions", href: "/workspaces/organization/permissions" },
      { id: "ws-settings", label: "Settings",    href: "/workspaces/organization/settings" },
    ],
  },
  {
    id: "studio",
    label: "Studio",
    icon: "Wand2",
    route: "/workspaces/studio",
    description: "AI-powered app builder and design studio",
    color: "#8B5CF6",
    enabled: true,
    subnav: [
      { id: "builder",     label: "Builder",     href: "/workspaces/studio" },
      { id: "preview",     label: "Preview",     href: "/workspaces/studio/preview" },
      { id: "code",        label: "Code",        href: "/workspaces/studio/code" },
      { id: "components",  label: "Components",  href: "/workspaces/studio/components" },
      { id: "brand-kit",   label: "Brand Kit",   href: "/workspaces/studio/brand-kit" },
      { id: "assets",      label: "Assets",      href: "/workspaces/studio/assets" },
      { id: "database",    label: "Database",    href: "/workspaces/studio/database" },
      { id: "api",         label: "API",         href: "/workspaces/studio/api" },
      { id: "deployments", label: "Deployments", href: "/workspaces/studio/deployments" },
      { id: "ws-settings", label: "Settings",    href: "/workspaces/studio/settings" },
    ],
  },
  {
    id: "marketing",
    label: "Marketing",
    icon: "Megaphone",
    route: "/workspaces/marketing",
    description: "Campaigns, leads, and content management",
    color: "#F59E0B",
    enabled: true,
    subnav: [
      { id: "dashboard",  label: "Dashboard",  href: "/workspaces/marketing" },
      { id: "campaigns",  label: "Campaigns",  href: "/workspaces/marketing/campaigns" },
      { id: "leads",      label: "Leads",      href: "/workspaces/marketing/leads" },
      { id: "content",    label: "Content",    href: "/workspaces/marketing/content" },
      { id: "analytics",  label: "Analytics",  href: "/workspaces/marketing/analytics" },
    ],
  },
  {
    id: "finance",
    label: "Finance",
    icon: "DollarSign",
    route: "/workspaces/finance",
    description: "Financial analytics and reporting",
    color: "#10B981",
    enabled: false,
    badge: "Soon",
    subnav: [],
  },
];

/** Given a pathname, find the active workspace (if any). */
export function getActiveWorkspace(pathname: string): WorkspaceDef | undefined {
  return WORKSPACES.find((ws) => pathname.startsWith(ws.route));
}

/** Given a pathname, find the active primary nav item label. */
export function getActiveNavLabel(pathname: string): string {
  if (pathname.startsWith("/workspaces")) {
    const ws = getActiveWorkspace(pathname);
    if (ws) return ws.label;
    return "Workspaces";
  }
  const item = PRIMARY_NAV.find((n) =>
    n.exact ? pathname === n.href : pathname.startsWith(n.href)
  ) ?? SETTINGS_NAV;
  return item.label;
}
