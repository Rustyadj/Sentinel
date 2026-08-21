// Pure, client-safe capability data — no `db` import, so this can be used
// directly from frontend components (e.g. the capability-weights editor)
// as well as from server-side orchestration code. capabilities.ts re-exports
// everything here and adds the db-backed lookup on top.

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
 * per-agent by writing directly to Agent.capabilityWeights (see the
 * Capabilities tab on the Agent Registry page).
 */
export const DEFAULT_CAPABILITY_WEIGHTS: Record<string, CapabilityWeights> = {
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

/** Clamp to known capability keys and the [0, 1] range a caller-supplied
 *  weights object might not respect (this is the boundary where arbitrary
 *  client input becomes a persisted routing input). */
export function sanitizeCapabilityWeights(input: unknown): CapabilityWeights {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  const record = input as Record<string, unknown>;
  const out: CapabilityWeights = {};
  for (const key of AGENT_CAPABILITY_KEYS) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      out[key] = Math.min(1, Math.max(0, value));
    }
  }
  return out;
}
