import { db } from "@/lib/db";
import { AGENT_TEMPLATES } from "@/lib/constants";
import type { PromptLayerInput } from "./prompt-layers";

/**
 * Persistent, model-independent agent identity.
 *
 * Identity comes from the Agent row (persona, personality, specialization,
 * communication style, working preferences) and never from the model or
 * runtime — so switching an agent's model leaves every identity layer, and
 * therefore its prompt identity, byte-for-byte unchanged. Before this, the
 * operator-edited `Agent.systemPrompt` was stored and versioned but never
 * delivered to any runtime.
 */
export interface AgentIdentity {
  agentId: string;
  name: string;
  role: string;
  persona: string;
  personality: string;
  specialization: string;
  communicationStyle: string;
  workingPreferences: Record<string, unknown>;
  skills: string[];
}

export function identityFromTemplate(agentId: string): AgentIdentity | null {
  const template = AGENT_TEMPLATES.find((entry) => entry.id === agentId);
  if (!template) return null;
  return {
    agentId, name: template.name, role: template.role, persona: template.systemPrompt ?? "", personality: "",
    specialization: template.description ?? "", communicationStyle: "", workingPreferences: {}, skills: template.skills ?? [],
  };
}

export async function loadAgentIdentity(agentId: string): Promise<AgentIdentity | null> {
  const row = await db.agent.findUnique({
    where: { id: agentId },
    select: { name: true, role: true, systemPrompt: true, description: true, skills: true, personality: true, specialization: true, communicationStyle: true, workingPreferences: true },
  }).catch(() => null);
  const template = identityFromTemplate(agentId);
  if (!row) return template;
  const prefs = row.workingPreferences && typeof row.workingPreferences === "object" && !Array.isArray(row.workingPreferences)
    ? row.workingPreferences as Record<string, unknown> : {};
  return {
    agentId,
    name: row.name,
    role: row.role,
    persona: row.systemPrompt?.trim() || template?.persona || "",
    personality: row.personality?.trim() ?? "",
    specialization: row.specialization?.trim() || row.description?.trim() || template?.specialization || "",
    communicationStyle: row.communicationStyle?.trim() ?? "",
    workingPreferences: prefs,
    skills: row.skills.length ? row.skills : template?.skills ?? [],
  };
}

function preferenceLines(prefs: Record<string, unknown>): string[] {
  return Object.entries(prefs)
    .filter(([, value]) => ["string", "number", "boolean"].includes(typeof value))
    .slice(0, 20)
    .map(([key, value]) => `- ${key}: ${String(value).slice(0, 200)}`);
}

/** Identity -> prompt layers. All are agent-sourced, not Sentinel's. */
export function identityLayers(identity: AgentIdentity | null): PromptLayerInput[] {
  if (!identity) return [];
  const personality = [identity.personality, identity.communicationStyle && `Communication style: ${identity.communicationStyle}`].filter(Boolean).join("\n");
  const specialization = [
    identity.specialization,
    identity.skills.length ? `Skills: ${identity.skills.join(", ")}` : "",
    ...preferenceLines(identity.workingPreferences).length ? ["Working preferences:", ...preferenceLines(identity.workingPreferences)] : [],
  ].filter(Boolean).join("\n");
  return [
    { id: "identity", source: "agent", title: "Identity", content: [`You are ${identity.name} (${identity.role}).`, identity.persona].filter(Boolean).join("\n"), maxChars: 6_000 },
    { id: "personality", source: "agent", title: "Personality", content: personality, maxChars: 2_000 },
    { id: "specialization", source: "agent", title: "Specialization", content: specialization, maxChars: 3_000 },
  ];
}
