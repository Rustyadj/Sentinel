// Mirrors the display fields of AGENT_TEMPLATES in the web app
// (src/lib/constants.ts) — id, name, avatar, color. The mobile app never
// needs a template's systemPrompt/toolPermissions/model: those are what the
// server sends to the model, not anything a client picks or displays. IDs
// have to stay byte-for-byte identical to the web list, since agentId is
// what /api/chat and a room's agentIds array key off.
export interface AgentTemplate {
  id: string;
  name: string;
  role: string;
  avatar: string;
  color: string;
}

export const AGENT_TEMPLATES: AgentTemplate[] = [
  { id: "hermes-lisa", name: "Hermes Lisa", role: "Chief Orchestrator", avatar: "🌸", color: "#8B5CF6" },
  { id: "claude-code", name: "Claude Code", role: "Senior Engineer", avatar: "💻", color: "#3B82F6" },
  { id: "codex", name: "Codex", role: "Code Specialist", avatar: "⚡", color: "#10B981" },
  { id: "openclaw", name: "OpenClaw", role: "Research Agent", avatar: "🔍", color: "#F59E0B" },
  { id: "security-red", name: "Red Teamer", role: "Offensive Security", avatar: "🔴", color: "#EF4444" },
  { id: "security-blue", name: "Blue Defender", role: "Defensive Security", avatar: "🔵", color: "#06B6D4" },
];

const BY_ID = new Map(AGENT_TEMPLATES.map((agent) => [agent.id, agent]));

/** Falls back to a neutral placeholder for an agentId the mobile template
 * list doesn't recognise (e.g. a custom workspace agent created on the web)
 * rather than crashing on an unknown id. */
export function agentById(id: string): AgentTemplate {
  return (
    BY_ID.get(id) ?? {
      id,
      name: id,
      role: "Agent",
      avatar: "🤖",
      color: "#6b7280",
    }
  );
}
