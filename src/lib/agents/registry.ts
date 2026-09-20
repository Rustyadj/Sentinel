/**
 * VPS Agent Registry — server-side typed service layer.
 * No DB model needed: reads from env + static config.
 * Never imported in client components.
 */

import { resolveWorkerModel } from "./model-policy";
import { isActiveAgentId } from "./active";
import { compatibilityRuntime } from "./runtime/config";

export type AgentStatus = "online" | "offline" | "degraded" | "unknown";
export type AgentKind = "hermes" | "claude-code" | "codex" | "custom";

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

const AGENT_CONFIG_DIR = process.env.AGENT_CONFIG_DIR ?? "/opt/sentinel-os/agents";
const AGENT_LOG_DIR = process.env.AGENT_LOG_DIR ?? "/opt/sentinel-os/logs";

function envFlag(name: string, fallback = true): boolean {
  const value = process.env[name];
  if (value === undefined) return fallback;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

const NATHAN_RUNTIME = compatibilityRuntime("hermes-nathan2");

const REGISTRY: VpsAgent[] = [
  {
    id: "hermes-lisa",
    name: "Hermes Lisa",
    kind: "hermes",
    type: "claude-code-agent",
    description: "Primary AI assistant — Claude Code OAuth, web terminal",
    model: process.env.HERMES_LISA_MODEL ?? "gpt-5.6-luna",
    endpoint: process.env.HERMES_ENDPOINT ?? "http://127.0.0.1:4862",
    containerName: process.env.HERMES_LISA_CONTAINER ?? "hermes-lisa",
    configPath: `${AGENT_CONFIG_DIR}/hermes-lisa`,
    logPath: `${AGENT_LOG_DIR}/hermes-lisa.log`,
    memoryScope: "org",
    workspaceId: "default",
    enabled: envFlag("HERMES_LISA_ENABLED", true),
    legacyPath: "/legacy/hermes",
    dashboardPort: 4862,
  },
  {
    id: "hermes-nathan2",
    name: "Hermes Nathan2",
    kind: "hermes",
    type: "claude-code-agent",
    description: "Secondary Hermes assistant",
    model: process.env.HERMES_NATHAN2_MODEL ?? "gpt-5.6-luna",
    // Runtime dispatch owns this endpoint; the registry is only a legacy/UI view.
    endpoint: NATHAN_RUNTIME?.endpoint ?? "",
    containerName: process.env.HERMES_NATHAN2_CONTAINER ?? "hermes-nathan2",
    configPath: `${AGENT_CONFIG_DIR}/hermes-nathan2`,
    logPath: `${AGENT_LOG_DIR}/hermes-nathan2.log`,
    memoryScope: "org",
    workspaceId: "default",
    enabled: envFlag("HERMES_NATHAN2_ENABLED", true),
    legacyPath: NATHAN_RUNTIME?.nativeUiUrl ?? null,
    dashboardPort: 4864,
  },
  {
    id: "claude-code",
    name: "Claude Code",
    kind: "claude-code",
    type: "coding-runtime",
    description: "Repository-aware Claude Code CLI runtime — process transport, no HTTP endpoint",
    model: `${resolveWorkerModel("claude-code").displayName} · ${resolveWorkerModel("claude-code").effort}`,
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
    model: `${resolveWorkerModel("codex").displayName} · ${resolveWorkerModel("codex").effort}`,
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
  return REGISTRY.filter((a) => a.enabled && isActiveAgentId(a.id));
}

export function getVpsAgent(id: string): VpsAgent | undefined {
  return REGISTRY.find((a) => a.id === id && a.enabled && isActiveAgentId(a.id));
}

export const ALLOWED_AGENT_IDS = new Set(REGISTRY.filter((a) => isActiveAgentId(a.id)).map((a) => a.id));
