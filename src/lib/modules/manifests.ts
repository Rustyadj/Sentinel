export interface ModuleManifestV2 {
  manifestVersion: 2;
  id: string;
  name: string;
  version: string;
  description: string;
  category: string;
  href: string;
  declaredPermissions: Array<{
    resource: string;
    actions: string[];
  }>;
}

export const MODULE_MANIFESTS: ModuleManifestV2[] = [
  {
    manifestVersion: 2,
    id: "kanban",
    name: "Kanban Board",
    version: "2.0.0",
    description: "Project task planning with workspace-scoped boards.",
    category: "Productivity",
    href: "/workspaces/organization/board",
    declaredPermissions: [
      { resource: "task", actions: ["read", "create", "update", "delete"] },
      { resource: "project", actions: ["read"] },
    ],
  },
  {
    manifestVersion: 2,
    id: "knowledge-graph",
    name: "Knowledge Graph",
    version: "2.0.0",
    description: "Explore knowledge objects, decisions, and their relationships.",
    category: "Knowledge",
    href: "/memory",
    declaredPermissions: [
      { resource: "knowledgeObject", actions: ["read", "create"] },
      { resource: "knowledgeEdge", actions: ["read", "create", "delete"] },
    ],
  },
  {
    manifestVersion: 2,
    id: "organization",
    name: "Organization Control",
    version: "2.0.0",
    description: "Teams, roles, approvals, meetings, and audit trails.",
    category: "Operations",
    href: "/workspaces/organization",
    declaredPermissions: [
      { resource: "workspace", actions: ["read"] },
      { resource: "team", actions: ["read", "create", "update", "delete"] },
      { resource: "approval", actions: ["read", "create", "review"] },
    ],
  },
  {
    manifestVersion: 2,
    id: "cybersecurity",
    name: "Cybersecurity Workspace",
    version: "2.0.0",
    description: "Security projects and red/blue team operational surfaces.",
    category: "Security",
    href: "/workspaces/cybersecurity",
    declaredPermissions: [
      { resource: "workspace", actions: ["read"] },
      { resource: "task", actions: ["read", "create", "update"] },
      { resource: "document", actions: ["read", "create"] },
    ],
  },
];

export function getModuleManifest(moduleId: string) {
  return MODULE_MANIFESTS.find((manifest) => manifest.id === moduleId);
}
