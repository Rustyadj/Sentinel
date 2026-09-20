/** Agents retired from every active Sentinel discovery and execution surface. */
export const RETIRED_AGENT_IDS = ["openclaw", "gemini"] as const;

const retiredAgentIds = new Set<string>(RETIRED_AGENT_IDS);

export function isActiveAgentId(agentId: string): boolean {
  return !retiredAgentIds.has(agentId);
}
