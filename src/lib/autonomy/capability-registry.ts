import { db } from "@/lib/db";
import { loadCatalog, type CatalogEntry } from "@/lib/bots/catalog";
import { listRuntimeViews } from "@/lib/agents/runtime/service";
import { defaultCapabilityWeights } from "@/lib/orchestration/capability-defaults";
import { evaluateAuthority, type AuthorityGrantLike, type AuthorityOperation } from "./authority";
import { listActiveGrants } from "./authority-store";

/**
 * Unified capability registry: one read-only view over what already exists —
 * MCP servers (Sentinel's own, Hermes built-ins, admin-registered), agents
 * and their runtimes, and reusable skills. It owns no data; every source
 * keeps its own table and lifecycle.
 *
 * Discovery reports, per capability, whether the asking agent already holds
 * the authority it needs. It never grants anything: using a capability still
 * goes through that capability's own gate (bot tool grants, approval gate,
 * objective policy) and the authority system.
 */
export type CapabilityKind = "mcp_tool" | "agent" | "skill";

export interface CapabilityEntry {
  key: string;
  kind: CapabilityKind;
  name: string;
  description: string;
  /** Free-form input/output contract summary, when the source declares one. */
  contract: { input: string; output: string } | null;
  available: boolean;
  /** The authority operation using it requires. */
  requiredAuthority: AuthorityOperation;
  /** Relative cost hint: free | metered | unknown. */
  cost: "free" | "metered" | "unknown";
  execution: { sideEffects: boolean; destructive: boolean; external: boolean };
  /** 0..1 measured success rate, or null when no executions were measured. */
  reliability: number | null;
  /** Name of the credential reference (never its value). */
  credentialRef: string | null;
  tags: string[];
}

export function mcpCapabilities(catalog: readonly CatalogEntry[]): CapabilityEntry[] {
  return catalog.flatMap((server) => server.tools.map((tool): CapabilityEntry => {
    const external = server.kind === "registered";
    const readOnly = tool.readOnly === true;
    const destructive = tool.destructive === true;
    const requiredAuthority: AuthorityOperation = destructive ? "destructive" : readOnly ? "read" : external ? "external" : "write";
    return {
      key: `mcp:${server.id}:${tool.name}`, kind: "mcp_tool", name: `${server.name} · ${tool.name}`,
      description: tool.description ?? "", contract: null,
      available: server.enabled && (server.kind !== "registered" || server.status === "connected"),
      requiredAuthority, cost: external ? "unknown" : "free",
      execution: { sideEffects: !readOnly, destructive, external },
      reliability: null, credentialRef: server.authenticated ? `mcp:${server.id}` : null,
      tags: server.capabilityTags,
    };
  }));
}

export interface AgentCapabilitySource {
  agentId: string;
  name: string;
  kind: string;
  enabled: boolean;
  executionVerified: boolean;
  weights: Record<string, number>;
  successRate: number | null;
}

export function agentCapabilities(agents: readonly AgentCapabilitySource[]): CapabilityEntry[] {
  return agents.map((agent) => {
    const strengths = Object.entries(agent.weights).filter(([, w]) => w >= 0.8).map(([k]) => k);
    return {
      key: `agent:${agent.agentId}`, kind: "agent", name: agent.name,
      description: `${agent.kind} agent${strengths.length ? `; strongest at ${strengths.join(", ")}` : ""}`,
      contract: { input: "task brief (title, description, capabilities, fileScope)", output: "result text + artifacts" },
      available: agent.enabled && agent.executionVerified, requiredAuthority: "delegate", cost: "metered",
      execution: { sideEffects: true, destructive: false, external: false },
      reliability: agent.successRate, credentialRef: null, tags: strengths,
    };
  });
}

export interface SkillCapabilitySource { id: string; name: string; description: string; enabled: boolean; successRate: number | null; tags: string[]; contract?: { input: string; output: string } | null }

export function skillCapabilities(skills: readonly SkillCapabilitySource[]): CapabilityEntry[] {
  return skills.map((skill) => ({
    key: `skill:${skill.id}`, kind: "skill", name: skill.name, description: skill.description, contract: skill.contract ?? null,
    available: skill.enabled, requiredAuthority: "read", cost: "free",
    execution: { sideEffects: false, destructive: false, external: false },
    reliability: skill.successRate, credentialRef: null, tags: skill.tags,
  }));
}

export interface DiscoveredCapability extends CapabilityEntry {
  score: number;
  authorized: boolean;
  /** When not authorized: exactly what authority is missing. */
  missingAuthority: string | null;
}

/** Rank capabilities for a need and mark which the agent may already use. Pure. */
export function discoverCapabilities(entries: readonly CapabilityEntry[], input: { query: string; agentId: string; workspaceId: string; grants: readonly AuthorityGrantLike[]; limit?: number; now?: Date }): DiscoveredCapability[] {
  const terms = input.query.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 2);
  const scored = entries.map((entry) => {
    const haystack = `${entry.name} ${entry.description} ${entry.tags.join(" ")} ${entry.key}`.toLowerCase();
    const hits = terms.filter((t) => haystack.includes(t)).length;
    const relevance = terms.length ? hits / terms.length : 0.5;
    const score = relevance * (entry.available ? 1 : 0.3) * (0.7 + 0.3 * (entry.reliability ?? 0.6));
    const authority = entry.requiredAuthority === "read"
      ? { authorized: true, missing: "" }
      : evaluateAuthority({ workspaceId: input.workspaceId, agentId: input.agentId, operation: entry.requiredAuthority }, input.grants, input.now);
    return { ...entry, score: Math.round(score * 1000) / 1000, authorized: authority.authorized, missingAuthority: authority.authorized ? null : authority.missing };
  });
  return scored.filter((entry) => !terms.length || entry.score > 0).sort((a, b) => b.score - a.score || a.key.localeCompare(b.key)).slice(0, input.limit ?? 25);
}

/** Load every capability source for one workspace. */
export async function loadCapabilityRegistry(workspaceId: string): Promise<CapabilityEntry[]> {
  const [catalog, runtimeViews, skills] = await Promise.all([
    loadCatalog(workspaceId),
    listRuntimeViews().catch(() => []),
    // Null-workspace skills are invisible to every tenant (schema invariant), so only this workspace's rows.
    db.skill.findMany({ where: { workspaceId }, take: 200, orderBy: { updatedAt: "desc" }, select: { id: true, name: true, description: true, domain: true, status: true, inputSchema: true, outputSchema: true, requiredTools: true } }),
  ]);
  const runtimes = runtimeViews.filter((runtime) => runtime.workspaceId === workspaceId);
  const agentIds = runtimes.map((runtime) => runtime.agentId);
  const [agents, competencies] = await Promise.all([
    db.agent.findMany({ where: { id: { in: agentIds } }, select: { id: true, name: true, capabilityWeights: true } }),
    db.agentCompetency.findMany({ where: { agentId: { in: agentIds } }, select: { agentId: true, successRate: true } }),
  ]);
  const agentSources: AgentCapabilitySource[] = runtimes.map((runtime) => {
    const row = agents.find((agent) => agent.id === runtime.agentId);
    const weights = row?.capabilityWeights && typeof row.capabilityWeights === "object" && Object.keys(row.capabilityWeights).length
      ? row.capabilityWeights as Record<string, number> : defaultCapabilityWeights(runtime.agentId) as Record<string, number>;
    const rates = competencies.filter((c) => c.agentId === runtime.agentId && typeof c.successRate === "number").map((c) => c.successRate as number);
    return {
      agentId: runtime.agentId, name: row?.name ?? runtime.agentId, kind: runtime.kind, enabled: runtime.enabled,
      executionVerified: runtime.executionVerified, weights, successRate: rates.length ? rates.reduce((a, b) => a + b, 0) / rates.length : null,
    };
  });
  const skillSources: SkillCapabilitySource[] = skills.map((skill) => ({
    id: skill.id, name: skill.name, description: skill.description,
    enabled: skill.status === "active", successRate: null, tags: [skill.domain, ...skill.requiredTools].filter(Boolean),
    contract: skill.inputSchema || skill.outputSchema ? { input: JSON.stringify(skill.inputSchema ?? {}).slice(0, 300), output: JSON.stringify(skill.outputSchema ?? {}).slice(0, 300) } : null,
  }));
  return [
    ...mcpCapabilities(catalog),
    ...agentCapabilities(agentSources),
    ...skillCapabilities(skillSources),
  ];
}

export async function discoverForAgent(input: { workspaceId: string; agentId: string; query: string; limit?: number }): Promise<DiscoveredCapability[]> {
  const [entries, grants] = await Promise.all([loadCapabilityRegistry(input.workspaceId), listActiveGrants(input.workspaceId)]);
  return discoverCapabilities(entries, { ...input, grants });
}
