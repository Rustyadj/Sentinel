import { db } from "@/lib/db";
import { getVpsAgent } from "@/lib/agents/registry";
import { defaultCapabilityWeights, type CapabilityWeights } from "./capability-defaults";

export type { AgentCapabilityKey, CapabilityWeights } from "./capability-defaults";
export { AGENT_CAPABILITY_KEYS, DEFAULT_CAPABILITY_WEIGHTS, defaultCapabilityWeights, sanitizeCapabilityWeights } from "./capability-defaults";

function isPopulatedWeights(value: unknown): value is CapabilityWeights {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value) && Object.keys(value as object).length > 0;
}

export async function getCapabilityWeights(agentId: string): Promise<CapabilityWeights> {
  const agent = await db.agent.findUnique({ where: { id: agentId }, select: { capabilityWeights: true } });
  if (isPopulatedWeights(agent?.capabilityWeights)) return agent!.capabilityWeights as CapabilityWeights;
  return defaultCapabilityWeights(agentId);
}

/**
 * The implementation worker pool for a room: every agent id whose VPS
 * registry kind is a coding runtime. Hermes (lead) and OpenClaw (personal
 * research assistant) are excluded by kind, not by a hardcoded role flag —
 * configurable later via a per-room override if that becomes necessary.
 */
export function resolveWorkerPool(agentIds: string[]): string[] {
  return agentIds.filter((id) => {
    const kind = getVpsAgent(id)?.kind;
    return kind === "claude-code" || kind === "codex";
  });
}

export function resolveLead(agentIds: string[]): string | undefined {
  return agentIds.find((id) => getVpsAgent(id)?.kind === "hermes");
}

/**
 * Display-only categorization for the participant bar's role badge
 * (spec's frontend contract fixes CollaborationParticipant.role to one of
 * these four strings). This says nothing about who is allowed to do what —
 * that's entirely the worker-router's job now.
 */
export type DisplayRole = "lead" | "implementation" | "review" | "research";

export function resolveDisplayRole(kind: string): DisplayRole {
  if (kind === "hermes") return "lead";
  if (kind === "claude-code" || kind === "codex") return "implementation";
  return "research";
}
