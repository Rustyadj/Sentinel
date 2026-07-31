/**
 * Idempotent seed for the consolidated Agent identity/control-plane model.
 * Merges what used to be two disconnected static sources:
 *   - AGENT_TEMPLATES (chat personas) → Agent + AgentConfiguration
 *   - the old VPS registry array (real infra processes) → AgentInstance
 * Agents present in both (e.g. "hermes-lisa") end up as ONE row with both a
 * persona configuration and a bound runtime instance, not two records.
 */
import { db } from "@/lib/db";
import { AGENT_TEMPLATES } from "@/lib/constants";
import { syncAgentToGraph, syncAgentInstanceToGraph } from "./graph";

const AGENT_CONFIG_DIR = process.env.AGENT_CONFIG_DIR ?? "/opt/sentinel-os/agents";
const AGENT_LOG_DIR = process.env.AGENT_LOG_DIR ?? "/opt/sentinel-os/logs";

function envFlag(name: string, fallback = true): boolean {
  const value = process.env[name];
  if (value === undefined) return fallback;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

interface VpsSeedEntry {
  agentId: string;
  name: string;
  description: string;
  instance: {
    kind: string;
    type: string;
    provider: string;
    authMode: string;
    model: string;
    endpoint: string;
    configPath: string;
    logPath: string;
    dashboardPort: number | null;
    legacyPath: string | null;
    vpsWorkspaceTag: string;
    enabled: boolean;
  };
}

const VPS_SEED: VpsSeedEntry[] = [
  {
    agentId: "hermes-lisa",
    name: "Hermes Lisa",
    description: "Primary AI assistant — Claude Code OAuth, web terminal",
    instance: {
      kind: "hermes",
      type: "claude-code-agent",
      provider: "anthropic",
      authMode: "oauth",
      model: process.env.HERMES_LISA_MODEL ?? "claude-sonnet-4-6",
      endpoint: process.env.HERMES_ENDPOINT ?? "http://127.0.0.1:4860",
      configPath: `${AGENT_CONFIG_DIR}/hermes-lisa`,
      logPath: `${AGENT_LOG_DIR}/hermes-lisa.log`,
      dashboardPort: 4860,
      legacyPath: "/legacy/hermes",
      vpsWorkspaceTag: "default",
      enabled: envFlag("HERMES_LISA_ENABLED", true),
    },
  },
  {
    agentId: "hermes-clint",
    name: "Hermes Clint",
    description: "ICF construction estimating specialist",
    instance: {
      kind: "hermes",
      type: "claude-code-agent",
      provider: "anthropic",
      authMode: "oauth",
      model: process.env.HERMES_CLINT_MODEL ?? "claude-sonnet-4-6",
      endpoint: process.env.HERMES_CLINT_ENDPOINT ?? "http://127.0.0.1:4861",
      configPath: `${AGENT_CONFIG_DIR}/hermes-clint`,
      logPath: `${AGENT_LOG_DIR}/hermes-clint.log`,
      dashboardPort: 4861,
      legacyPath: null,
      vpsWorkspaceTag: "construction",
      enabled: envFlag("HERMES_CLINT_ENABLED", false),
    },
  },
  {
    agentId: "openclaw",
    name: "OpenClaw",
    description: "Personal AI assistant — Docker on VPS",
    instance: {
      kind: "openclaw",
      type: "open-webui-agent",
      provider: "anthropic",
      authMode: "api-key",
      model: process.env.OPENCLAW_MODEL ?? "claude-opus-4-8",
      endpoint: process.env.OPENCLAW_ENDPOINT ?? "http://127.0.0.1:50348",
      configPath: `${AGENT_CONFIG_DIR}/openclaw`,
      logPath: `${AGENT_LOG_DIR}/openclaw.log`,
      dashboardPort: null,
      legacyPath: "/legacy/openclaw",
      vpsWorkspaceTag: "personal",
      enabled: envFlag("OPENCLAW_ENABLED", true),
    },
  },
];

let seeded = false;

export async function ensureAgentsSeeded(): Promise<void> {
  if (seeded) return;

  // No DB-count short-circuit here on purpose: the upserts below are cheap
  // and idempotent, and this is also the only place that syncs Agent rows
  // to the knowledge graph — skipping it whenever agents already existed
  // (from a prior process) meant graph nodes for pre-existing agents were
  // silently never created. The in-memory `seeded` flag above is enough to
  // avoid repeat work within a single process's lifetime.

  // 1. Chat personas → Agent + AgentConfiguration
  for (const t of AGENT_TEMPLATES) {
    const agent = await db.agent.upsert({
      where: { id: t.id },
      create: {
        id: t.id,
        name: t.name,
        role: t.role,
        avatar: t.avatar,
        color: t.color,
        description: t.description ?? "",
        skills: t.skills ?? [],
        status: "online",
        configuration: {
          create: {
            model: t.model,
            systemPrompt: t.systemPrompt ?? "",
            memoryScope: t.memoryScope ?? "session",
            allowedTools: t.toolPermissions ?? [],
          },
        },
      },
      update: {},
    });
    await syncAgentToGraph(agent);
  }

  // 2. VPS infra processes → Agent (if not already seeded above) + AgentInstance
  for (const v of VPS_SEED) {
    if (!v.instance.enabled) continue;

    const agent = await db.agent.upsert({
      where: { id: v.agentId },
      create: {
        id: v.agentId,
        name: v.name,
        role: "Infrastructure Agent",
        avatar: "🖥️",
        color: "#6b7280",
        description: v.description,
        skills: [],
        status: "online",
      },
      update: {},
    });
    await syncAgentToGraph(agent);

    const existingInstance = await db.agentInstance.findFirst({
      where: { agentId: v.agentId, kind: v.instance.kind },
    });
    const instance =
      existingInstance ??
      (await db.agentInstance.create({
        data: { agentId: v.agentId, ...v.instance },
      }));
    await syncAgentInstanceToGraph(instance);
  }

  seeded = true;
}
