// Pure policy evaluators for bots. No database, no I/O: every decision the bot
// system makes about tools, memory and delegation is computed here from plain
// data, so it can be tested exhaustively and cannot drift between the code paths
// that enforce it.

import type { BotDelegationPolicy, BotMemoryPolicy, BotMemoryScope, ToolPermission } from "./schema";
import { MAX_DELEGATION_DEPTH } from "./schema";

// ---------------------------------------------------------------- tools ----

export interface PermissionRow {
  serverId: string;
  /** "*" is the server-level grant; a tool name overrides it for that tool. */
  toolName: string;
  permission: ToolPermission;
}

export interface CatalogTool {
  name: string;
  description?: string;
  /** From the tool's own MCP annotations. null = the server did not say. */
  readOnly: boolean | null;
  destructive?: boolean | null;
  /** Tools that reach around Sentinel's own governance (its memory, its delegation). */
  risk?: "normal" | "high";
}

export interface CatalogServer {
  id: string;
  /** Used to recognise runtime tool names such as `mcp_<slug>_<tool>`. */
  slug: string;
  name: string;
  tools: CatalogTool[];
}

export type ToolAccessSource = "tool" | "server" | "none" | "approved" | "unknown-tool";

export interface ToolDecision {
  allowed: boolean;
  requiresApproval: boolean;
  permission: ToolPermission | "none";
  source: ToolAccessSource;
  reason: string;
}

/**
 * Effective permission for one tool. Least privilege throughout:
 *  - no matching grant is a denial, not an inheritance from anything;
 *  - a tool-level row beats the server-level row, in either direction;
 *  - "read" admits only tools the server itself marked read-only — a tool whose
 *    read-only status is unknown is refused, because guessing wrong here is a
 *    write the operator never granted.
 */
export function evaluateToolAccess(
  rows: readonly PermissionRow[],
  tool: { serverId: string; toolName: string; readOnly: boolean | null },
  approvedOnce: ReadonlySet<string> = new Set(),
): ToolDecision {
  if (approvedOnce.has(`${tool.serverId}:${tool.toolName}`)) {
    return { allowed: true, requiresApproval: false, permission: "execute", source: "approved", reason: "Approved for this task." };
  }
  const toolRow = rows.find((row) => row.serverId === tool.serverId && row.toolName === tool.toolName);
  const serverRow = rows.find((row) => row.serverId === tool.serverId && row.toolName === "*");
  const effective = toolRow ?? serverRow;
  const source: ToolAccessSource = toolRow ? "tool" : serverRow ? "server" : "none";
  if (!effective) {
    return { allowed: false, requiresApproval: false, permission: "none", source, reason: "No grant for this tool or its server." };
  }
  switch (effective.permission) {
    case "disabled":
      return { allowed: false, requiresApproval: false, permission: "disabled", source, reason: "Access is disabled." };
    case "read":
      return tool.readOnly === true
        ? { allowed: true, requiresApproval: false, permission: "read", source, reason: "Read-only tool under a read grant." }
        : { allowed: false, requiresApproval: false, permission: "read", source, reason: tool.readOnly === false ? "Read grant does not cover a tool that can change state." : "Read grant does not cover a tool whose read-only status is unknown." };
    case "execute":
      return { allowed: true, requiresApproval: false, permission: "execute", source, reason: "Execute grant." };
    case "approval":
      return { allowed: false, requiresApproval: true, permission: "approval", source, reason: "Requires approval before each use." };
  }
}

function normalizeToolName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

export interface ResolvedTool {
  serverId: string;
  serverName: string;
  toolName: string;
  readOnly: boolean | null;
}

/**
 * Map a tool name as a runtime reports it back to catalog entries. Hermes
 * reports MCP tools with and without a server prefix, so several spellings are
 * tried. More than one server can expose the same bare name; the caller must
 * then treat the call under the strictest of them (see evaluateObservedTool).
 * An empty result means the tool is in no catalog at all.
 */
export function resolveObservedTool(reported: string, catalog: readonly CatalogServer[]): ResolvedTool[] {
  const wanted = normalizeToolName(reported);
  const matches: ResolvedTool[] = [];
  for (const server of catalog) {
    const slug = normalizeToolName(server.slug);
    for (const tool of server.tools) {
      const bare = normalizeToolName(tool.name);
      const spellings = new Set([bare, `${slug}_${bare}`, `mcp_${slug}_${bare}`, `mcp_${slug}__${bare}`]);
      // Tools declared as "server.tool" are also reported without the dotted prefix.
      const dot = tool.name.indexOf(".");
      if (dot > 0) {
        const after = normalizeToolName(tool.name.slice(dot + 1));
        for (const spelling of [after, `${slug}_${after}`, `mcp_${slug}_${after}`]) spellings.add(spelling);
      }
      if (spellings.has(wanted)) matches.push({ serverId: server.id, serverName: server.name, toolName: tool.name, readOnly: tool.readOnly });
    }
  }
  return matches;
}

export interface ObservedToolVerdict extends ToolDecision {
  reported: string;
  resolved: ResolvedTool | null;
}

/** Decide one observed tool call. Unknown tools are denied; ambiguous ones use the strictest match. */
export function evaluateObservedTool(
  rows: readonly PermissionRow[],
  reported: string,
  catalog: readonly CatalogServer[],
  approvedOnce: ReadonlySet<string> = new Set(),
): ObservedToolVerdict {
  const candidates = resolveObservedTool(reported, catalog);
  if (candidates.length === 0) {
    return { allowed: false, requiresApproval: false, permission: "none", source: "unknown-tool", reason: "Tool is not in any catalog Sentinel knows, so no grant can cover it.", reported, resolved: null };
  }
  const verdicts = candidates.map((candidate) => ({ candidate, decision: evaluateToolAccess(rows, candidate, approvedOnce) }));
  const denied = verdicts.find(({ decision }) => !decision.allowed && !decision.requiresApproval);
  const chosen = denied ?? verdicts.find(({ decision }) => decision.requiresApproval) ?? verdicts[0];
  return { ...chosen.decision, reported, resolved: chosen.candidate };
}

/** Human-readable manifest placed in the bot's prompt. Advisory: enforcement is separate. */
export function renderToolManifest(rows: readonly PermissionRow[], catalog: readonly CatalogServer[]): string {
  const lines: string[] = [];
  for (const server of catalog) {
    const perTool = server.tools.map((tool) => ({ tool, decision: evaluateToolAccess(rows, { serverId: server.id, toolName: tool.name, readOnly: tool.readOnly }) }));
    const allowed = perTool.filter(({ decision }) => decision.allowed).map(({ tool }) => tool.name);
    const approval = perTool.filter(({ decision }) => decision.requiresApproval).map(({ tool }) => tool.name);
    if (allowed.length) lines.push(`- ${server.name}: you MAY use ${allowed.join(", ")}.`);
    if (approval.length) lines.push(`- ${server.name}: ${approval.join(", ")} need approval before use; do not call them, say what you would do and why.`);
  }
  return lines.length
    ? `Tools you may use:\n${lines.join("\n")}\nAny tool not listed is forbidden. Calling one ends your task.`
    : "You have no tools. Answer from the instructions and context you were given. Calling any tool ends your task.";
}

// --------------------------------------------------------------- memory ----

export function memoryReadScopes(policy: BotMemoryPolicy): BotMemoryScope[] {
  return policy.enabled ? [...new Set(policy.readScopes)] : [];
}

export function memoryWriteScopes(policy: BotMemoryPolicy): BotMemoryScope[] {
  return policy.enabled ? [...new Set(policy.writeScopes)] : [];
}

export function canWriteMemoryScope(policy: BotMemoryPolicy, scope: BotMemoryScope): boolean {
  return memoryWriteScopes(policy).includes(scope);
}

// ----------------------------------------------------------- delegation ----

export interface DelegationSubject {
  id: string;
  status: string;
  delegationPolicy: BotDelegationPolicy;
}

export interface DelegationParent {
  bot: DelegationSubject;
  /** Bot ids already on the chain that led here, root first, including `bot`. */
  chain: string[];
}

export interface DelegationDecision {
  allowed: boolean;
  reason: string;
}

/** Does this caller key satisfy one entry of allowedCallers? `user` matches any `user:<id>`. */
export function callerMatches(allowedCallers: readonly string[], callerKey: string): boolean {
  return allowedCallers.some((entry) => entry === callerKey || (entry === "user" && callerKey.startsWith("user:")));
}

export function evaluateDelegation(input: {
  target: DelegationSubject;
  callerKey: string;
  parent?: DelegationParent | null;
}): DelegationDecision {
  const { target, callerKey, parent } = input;
  if (target.status !== "active") return { allowed: false, reason: `Bot is ${target.status}, not active.` };
  if (!callerMatches(target.delegationPolicy.allowedCallers, callerKey)) {
    return { allowed: false, reason: `Caller ${callerKey} is not in this bot's allowed callers.` };
  }
  if (!parent) return { allowed: true, reason: "Caller is allowed." };
  const policy = parent.bot.delegationPolicy;
  if (!policy.canDelegate) return { allowed: false, reason: "The delegating bot is not permitted to delegate." };
  if (!policy.allowedChildBots.includes(target.id)) return { allowed: false, reason: "Target is not one of the delegating bot's allowed child bots." };
  if (parent.chain.includes(target.id)) return { allowed: false, reason: "Delegation would loop back to a bot already on the chain." };
  // The root of a chain is level 0, so the child being created sits at
  // chain.length. A bot with maxDepth 1 may therefore start level-1 children,
  // and those children cannot delegate further unless their own policy allows.
  const childLevel = parent.chain.length;
  const ceiling = Math.min(policy.maxDepth, MAX_DELEGATION_DEPTH);
  if (childLevel > ceiling) return { allowed: false, reason: `Delegation level ${childLevel} exceeds the limit of ${ceiling}.` };
  return { allowed: true, reason: "Caller and child-bot policy allow it." };
}
