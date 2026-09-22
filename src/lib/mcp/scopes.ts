/**
 * Scopes for the external MCP gateway.
 *
 * A scope is the unit the human consents to at the authorize screen and the
 * unit a tool is gated on. Tools never check "is this ChatGPT" — they declare
 * the scope they need, and the gateway refuses the call when the grant the
 * token was issued under doesn't carry it. Read and write are deliberately
 * split per domain so a connector can be given search access without ever
 * being able to create a task.
 */
export const MCP_SCOPES = {
  workspaceRead: "sentinel:workspace.read",
  agentsRead: "sentinel:agents.read",
  memoriesRead: "sentinel:memories.read",
  tasksRead: "sentinel:tasks.read",
  tasksWrite: "sentinel:tasks.write",
  contentRead: "sentinel:content.read",
  searchRead: "sentinel:search.read",
} as const;

export type McpScope = (typeof MCP_SCOPES)[keyof typeof MCP_SCOPES];

export const ALL_SCOPES: McpScope[] = Object.values(MCP_SCOPES);

/**
 * The ceiling a client gets when it registers without naming scopes.
 *
 * This is deliberately everything, because a ceiling grants nothing on its
 * own — no scope becomes real until a human ticks it at /mcp/authorize. The
 * two ideas below used to share one constant, and conflating them had teeth:
 * ChatGPT's dynamic registration sends no `scope`, so its ceiling came out
 * read-only, and since the consent screen only ever offers the ceiling,
 * `sentinel:tasks.write` could never be approved or even displayed. The write
 * tool was unreachable by construction. Keep these two separate.
 */
export const DEFAULT_CLIENT_SCOPES: McpScope[] = ALL_SCOPES;

/**
 * What arrives pre-ticked on the consent screen: everything read-only. Write
 * access is offered but never pre-selected — granting it stays an explicit
 * act by the human.
 */
export const PRE_TICKED_SCOPES: McpScope[] = [
  MCP_SCOPES.workspaceRead,
  MCP_SCOPES.agentsRead,
  MCP_SCOPES.memoriesRead,
  MCP_SCOPES.tasksRead,
  MCP_SCOPES.contentRead,
  MCP_SCOPES.searchRead,
];

export const SCOPE_DESCRIPTIONS: Record<McpScope, string> = {
  [MCP_SCOPES.workspaceRead]: "See workspace structure and summary counts",
  [MCP_SCOPES.agentsRead]: "See your agents and their roles",
  [MCP_SCOPES.memoriesRead]: "Read memories stored in Sentinel",
  [MCP_SCOPES.tasksRead]: "Read tasks and their status",
  [MCP_SCOPES.tasksWrite]: "Create and update tasks on your behalf",
  [MCP_SCOPES.contentRead]: "Read projects, documents, notes, workflows, collaboration, knowledge, and runtime records",
  [MCP_SCOPES.searchRead]: "Search across all content in the selected Sentinel workspace and fetch matching records",
};

export function isKnownScope(value: string): value is McpScope {
  return (ALL_SCOPES as string[]).includes(value);
}

/** Parses an OAuth space-delimited scope string, dropping unknown entries. */
export function parseScopeString(value: string | null | undefined): McpScope[] {
  if (!value) return [];
  const seen = new Set<McpScope>();
  for (const entry of value.split(/\s+/)) {
    if (isKnownScope(entry)) seen.add(entry);
  }
  return [...seen];
}

export function formatScopeString(scopes: readonly McpScope[]): string {
  return scopes.join(" ");
}

/** Intersection, preserving the order of `requested`. */
export function narrowScopes(requested: readonly McpScope[], allowed: readonly McpScope[]): McpScope[] {
  return requested.filter((scope) => allowed.includes(scope));
}

export function hasScope(granted: readonly string[], required: McpScope): boolean {
  return granted.includes(required);
}
