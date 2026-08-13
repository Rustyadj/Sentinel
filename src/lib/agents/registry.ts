/**
 * VPS Agent Registry — server-side typed service layer.
 * Reads runtime-instance data from the DB (AgentInstance, joined with its
 * owning Agent). Never imported in client components.
 */
import { db } from "@/lib/db";
import type { Agent, AgentInstance } from "@prisma/client";
import { ensureAgentsSeeded } from "./seed";

export type AgentStatus = "online" | "offline" | "degraded" | "unknown";
export type AgentKind = "hermes" | "openclaw" | "claude-code" | "codex" | "custom";

export interface VpsAgent {
  id: string;
  name: string;
  kind: AgentKind;
  type: string;
  description: string;
  model: string;
  endpoint: string;
  containerName: string | null;
  configPath: string;
  logPath: string;
  memoryScope: string;
  workspaceId: string;
  enabled: boolean;
  legacyPath: string | null;
  dashboardPort: number | null;
}

type InstanceWithAgent = AgentInstance & { agent: Agent };

function toVpsAgent(instance: InstanceWithAgent): VpsAgent {
  return {
    id: instance.agentId,
    name: instance.agent.name,
    kind: (instance.kind as AgentKind) ?? "custom",
    type: instance.type,
    description: instance.agent.description,
    model: instance.model ?? "unknown",
    endpoint: instance.endpoint ?? "",
    configPath: instance.configPath ?? "",
    logPath: instance.logPath ?? "",
    memoryScope: instance.vpsWorkspaceTag ?? "session",
    workspaceId: instance.vpsWorkspaceTag ?? "default",
    enabled: instance.enabled,
    legacyPath: instance.legacyPath,
    dashboardPort: instance.dashboardPort,
  };
}

const REGISTRY: VpsAgent[] = [
  {
    id: "hermes-lisa",
    name: "Hermes Lisa",
    kind: "hermes",
    type: "claude-code-agent",
    description: "Primary AI assistant — Claude Code OAuth, web terminal",
    model: process.env.HERMES_LISA_MODEL ?? "claude-sonnet-4-6",
    endpoint: process.env.HERMES_ENDPOINT ?? "http://127.0.0.1:4860",
    containerName: process.env.HERMES_LISA_CONTAINER ?? "hermes-lisa",
    configPath: `${AGENT_CONFIG_DIR}/hermes-lisa`,
    logPath: `${AGENT_LOG_DIR}/hermes-lisa.log`,
    memoryScope: "org",
    workspaceId: "default",
    enabled: envFlag("HERMES_LISA_ENABLED", true),
    legacyPath: "/legacy/hermes",
    dashboardPort: 4860,
  },
  {
    id: "openclaw",
    name: "OpenClaw",
    kind: "openclaw",
    type: "open-webui-agent",
    description: "Personal AI assistant — Docker on VPS",
    model: process.env.OPENCLAW_MODEL ?? "claude-opus-4-8",
    endpoint: process.env.OPENCLAW_ENDPOINT ?? "http://127.0.0.1:3001",
    containerName: process.env.OPENCLAW_CONTAINER ?? "openclaw",
    configPath: `${AGENT_CONFIG_DIR}/openclaw`,
    logPath: `${AGENT_LOG_DIR}/openclaw.log`,
    memoryScope: "user",
    workspaceId: "personal",
    enabled: envFlag("OPENCLAW_ENABLED", true),
    legacyPath: "/legacy/openclaw",
    dashboardPort: null,
  },
  {
    id: "claude-code",
    name: "Claude Code",
    kind: "claude-code",
    type: "coding-runtime",
    description: "Repository-aware Claude Code CLI runtime — process transport, no HTTP endpoint",
    model: process.env.CLAUDE_CODE_MODEL ?? "provider-managed",
    endpoint: "",
    containerName: null,
    configPath: `${AGENT_CONFIG_DIR}/claude-code`,
    logPath: `${AGENT_LOG_DIR}/claude-code.log`,
    memoryScope: "project",
    workspaceId: "default",
    enabled: true,
    legacyPath: null,
    dashboardPort: null,
  },
  {
    id: "codex",
    name: "Codex",
    kind: "codex",
    type: "coding-runtime",
    description: "Sandboxed Codex CLI runtime — process transport, no HTTP endpoint",
    model: process.env.CODEX_MODEL ?? "provider-managed",
    endpoint: "",
    containerName: null,
    configPath: `${AGENT_CONFIG_DIR}/codex`,
    logPath: `${AGENT_LOG_DIR}/codex.log`,
    memoryScope: "project",
    workspaceId: "default",
    enabled: true,
    legacyPath: null,
    dashboardPort: null,
  },
];

export function getAllVpsAgents(): VpsAgent[] {
  return REGISTRY.filter((a) => a.enabled);
}

export async function getVpsAgent(id: string): Promise<VpsAgent | null> {
  await ensureAgentsSeeded();
  const instance = await db.agentInstance.findFirst({
    where: { agentId: id, enabled: true },
    include: { agent: true },
  });
  return instance ? toVpsAgent(instance) : null;
}

export async function isAllowedVpsAgentId(id: string): Promise<boolean> {
  return (await getVpsAgent(id)) !== null;
}
