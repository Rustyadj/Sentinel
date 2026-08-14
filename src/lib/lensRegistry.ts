// Central Lens Registry — Graph-First Lens Architecture.
//
// A "lens" is a workspace's entry into the one canonical Sentinel graph:
// which cluster it centers on, what the workspace app is titled, and which
// tabs it exposes. LensOverview and the workspace pages read this instead of
// hard-coding cluster ids / titles / tab lists per page.
//
// Adding a lens = adding an entry here + a page that renders
// `<LensOverview lensId="..." />` as its first tab. No new graph, no new
// store, no per-lens camera logic.

import type { ClusterId } from "@/components/neural-lens/categories";

export type LensId = "cybersecurity" | "studio" | "organization" | "marketing";

export interface LensTab {
  id: string;
  label: string;
  href: string;
}

export interface LensConfig {
  id: LensId;
  /** Workspace slug in the `Workspace` table (see lib/workspaces). */
  workspaceSlug: string;
  /** The OS-level cluster this lens centers the canonical graph on. */
  clusterId: ClusterId;
  /** Whole-application title, distinct from any single tab's label
   * (e.g. "Range Console" is the app; "Overview" is its first tab). */
  title: string;
  description: string;
  /** Route to the workspace's root — always the Overview tab. */
  route: string;
  accent: string;
  tabs: LensTab[];
}

export const LENS_CONFIG: Record<LensId, LensConfig> = {
  cybersecurity: {
    id: "cybersecurity",
    workspaceSlug: "cybersecurity",
    clusterId: "Cybersecurity",
    title: "Range Console",
    description: "Red and blue team operations, threat intelligence, and attack simulation.",
    route: "/workspaces/cybersecurity",
    accent: "#EF4444",
    // Range Console owns its own in-app section switcher (Overview / Summary
    // / Red Team / Blue Team / Purple Team / Threat Intel / Attack Chains /
    // Techniques / Reports — see modules/cybersecurity/components/
    // CybersecurityPage.tsx's SubNav) rather than separate Next.js routes,
    // so only the workspace root is listed here.
    tabs: [{ id: "overview", label: "Overview", href: "/workspaces/cybersecurity" }],
  },
  studio: {
    id: "studio",
    workspaceSlug: "studio",
    clusterId: "Coding",
    title: "AI Studio",
    description: "AI-powered application and design workspace.",
    route: "/workspaces/studio",
    accent: "#8B5CF6",
    tabs: [
      { id: "overview", label: "Overview", href: "/workspaces/studio" },
      { id: "builder", label: "Builder", href: "/workspaces/studio/builder" },
      { id: "projects", label: "Projects", href: "/workspaces/studio/projects" },
    ],
  },
  organization: {
    id: "organization",
    workspaceSlug: "organization",
    clusterId: "Organization",
    title: "Organization Console",
    description: "Teams, projects, approvals, meetings, and access control.",
    route: "/workspaces/organization",
    accent: "#3B82F6",
    tabs: [
      { id: "overview", label: "Overview", href: "/workspaces/organization" },
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
  marketing: {
    id: "marketing",
    workspaceSlug: "marketing",
    clusterId: "Marketing",
    title: "Marketing",
    description: "Campaign, content, and growth operations.",
    route: "/workspaces/marketing",
    accent: "#F59E0B",
    // Marketing owns its own in-app section switcher (Overview / Dashboard /
    // Leads / CRM / Clients / Campaigns / SEO / Analytics / AI Agents /
    // Website), so only the workspace root is listed here.
    tabs: [{ id: "overview", label: "Overview", href: "/workspaces/marketing" }],
  },
};

export function getLensConfig(id: LensId): LensConfig {
  return LENS_CONFIG[id];
}

export function lensForClusterId(clusterId: ClusterId): LensConfig | undefined {
  return Object.values(LENS_CONFIG).find((lens) => lens.clusterId === clusterId);
}
