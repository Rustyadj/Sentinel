import { db } from "@/lib/db";
import { getVpsAgent } from "@/lib/agents/registry";

export type AgentCapabilityKey =
  | "coding" | "debugging" | "frontend" | "backend" | "architecture"
  | "testing" | "security" | "database" | "devops" | "research" | "refactoring";

export const AGENT_CAPABILITY_KEYS: readonly AgentCapabilityKey[] = [
  "coding", "debugging", "frontend", "backend", "architecture",
  "testing", "security", "database", "devops", "research", "refactoring",
];

export type CapabilityWeights = Partial<Record<AgentCapabilityKey, number>>;

/**
 * Default weight tables, used whenever an Agent row's own
 * capabilityWeights is empty. These are routing hints Lisa's
 * worker-router uses to score candidates — never a permanent
 * "Claude builds, Codex reviews" assignment. An operator can override
 * per-agent by writing directly to Agent.capabilityWeights.
 */
const DEFAULT_CAPABILITY_WEIGHTS: Record<string, CapabilityWeights> = {
  "claude-code": {
    coding: 0.95, architecture: 0.9, frontend: 0.9, backend: 0.95,
    refactoring: 0.95, debugging: 0.85, testing: 0.85, security: 0.8,
    database: 0.85, devops: 0.75, research: 0.8,
  },
  codex: {
    coding: 0.95, testing: 0.95, debugging: 0.95, backend: 0.9,
    frontend: 0.9, architecture: 0.8, refactoring: 0.85, security: 0.85,
    database: 0.85, devops: 0.8, research: 0.75,
  },
  "hermes-lisa": { research: 0.9, architecture: 0.85 },
  openclaw: { research: 0.85 },
};

export function defaultCapabilityWeights(agentId: string): CapabilityWeights {
  return DEFAULT_CAPABILITY_WEIGHTS[agentId] ?? {};
}

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
