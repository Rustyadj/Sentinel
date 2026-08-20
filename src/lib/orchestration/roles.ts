import type { AgentRole } from "@/types/collaboration";
import type { AgentKind } from "@/lib/agents/registry";

/**
 * Default kind -> role mapping (spec's default roster: Hermes leads,
 * Claude Code implements, Codex reviews). Rooms don't yet support a
 * per-room role override table, so this single function is the seam
 * where that would plug in later without touching call sites.
 */
const DEFAULT_ROLE_BY_KIND: Record<AgentKind, AgentRole> = {
  hermes: "lead",
  "claude-code": "implementation",
  codex: "review",
  openclaw: "research",
  custom: "research",
};

export function resolveAgentRole(kind: AgentKind): AgentRole {
  return DEFAULT_ROLE_BY_KIND[kind] ?? "research";
}

export interface RoomRoster {
  lead?: string;
  implementation?: string;
  review?: string;
}
