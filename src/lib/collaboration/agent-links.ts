/**
 * Whether two agents in a project may message each other. Pure: callers load
 * ProjectAgent and AgentLinkRule rows and pass the relevant fields in.
 *
 * Agents with the same owner always talk. Across owners, each owner sets one
 * side (AgentLinkRule) and the stricter side wins, in both directions. A side
 * nobody has set counts as ASK, so a new agent never talks to a stranger's
 * agent without a person saying yes first.
 */

export const LINK_RULES = ["ALLOW", "ASK", "BLOCK"] as const;

export type LinkRule = (typeof LINK_RULES)[number];

export const DEFAULT_LINK_RULE: LinkRule = "ASK";

export function isLinkRule(value: unknown): value is LinkRule {
  return typeof value === "string" && (LINK_RULES as readonly string[]).includes(value);
}

/** Missing or unrecognised values fall back to ASK rather than to ALLOW. */
export function normalizeLinkRule(value: unknown): LinkRule {
  return isLinkRule(value) ? value : DEFAULT_LINK_RULE;
}

/** The stricter of the two owners' sides. */
export function stricterLinkRule(a: unknown, b: unknown): LinkRule {
  const left = normalizeLinkRule(a);
  const right = normalizeLinkRule(b);
  return LINK_RULES.indexOf(left) >= LINK_RULES.indexOf(right) ? left : right;
}

export interface LinkParty {
  /** ProjectAgent.ownerUserId */
  ownerUserId: string;
  /** ProjectAgent.canMessageOtherOwners */
  canMessageOtherOwners: boolean;
  /** This owner's AgentLinkRule.rule about the other agent, if they set one. */
  rule?: string | null;
}

export type LinkDecision =
  | { rule: "ALLOW"; reason: "same-owner" | "both-allow" }
  | { rule: "ASK"; reason: "needs-person" }
  | { rule: "BLOCK"; reason: "agent-not-permitted" | "owner-blocked" };

export function resolveAgentLink(from: LinkParty, to: LinkParty): LinkDecision {
  if (from.ownerUserId === to.ownerUserId) return { rule: "ALLOW", reason: "same-owner" };
  if (!from.canMessageOtherOwners || !to.canMessageOtherOwners) {
    return { rule: "BLOCK", reason: "agent-not-permitted" };
  }
  const rule = stricterLinkRule(from.rule, to.rule);
  if (rule === "ALLOW") return { rule, reason: "both-allow" };
  if (rule === "BLOCK") return { rule, reason: "owner-blocked" };
  return { rule, reason: "needs-person" };
}
