/**
 * VPS Agent Registry — server-side typed service layer.
 * No DB model needed: reads from env + static config.
 * Never imported in client components.
 */

export type AgentStatus = "online" | "offline" | "degraded" | "unknown";
export type AgentKind = "hermes" | "openclaw" | "custom";

export interface VpsAgent {
  id: string;
  name: string;
  kind: AgentKind;
  type: string;
  description: string;
  model: string;
  endpoint: string;
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

const REGISTRY: VpsAgent[] = [
  {
    id: "hermes-lisa",
    name: "Hermes Lisa",
    kind: "hermes",
    type: "claude-code-agent",
    description: "Primary AI assistant — Claude Code OAuth, web terminal",
    model: process.env.HERMES_LISA_MODEL ?? "claude-sonnet-4-6",
    endpoint: process.env.HERMES_ENDPOINT ?? "http://127.0.0.1:4860",
    configPath: `${AGENT_CONFIG_DIR}/hermes-lisa`,
    logPath: `${AGENT_LOG_DIR}/hermes-lisa.log`,
    memoryScope: "org",
    workspaceId: "default",
    enabled: envFlag("HERMES_LISA_ENABLED", true),
    legacyPath: "/legacy/hermes",
    dashboardPort: 4860,
  },
  {
    id: "hermes-clint",
    name: "Hermes Clint",
    kind: "hermes",
    type: "claude-code-agent",
    description: "ICF construction estimating specialist",
    model: process.env.HERMES_CLINT_MODEL ?? "claude-sonnet-4-6",
    endpoint: process.env.HERMES_CLINT_ENDPOINT ?? "http://127.0.0.1:4861",
    configPath: `${AGENT_CONFIG_DIR}/hermes-clint`,
    logPath: `${AGENT_LOG_DIR}/hermes-clint.log`,
    memoryScope: "project",
    workspaceId: "construction",
    enabled: envFlag("HERMES_CLINT_ENABLED", false),
    legacyPath: null,
    dashboardPort: 4861,
  },
  {
    id: "openclaw",
    name: "OpenClaw",
    kind: "openclaw",
    type: "open-webui-agent",
    description: "Personal AI assistant — Docker on VPS",
    model: process.env.OPENCLAW_MODEL ?? "claude-opus-4-8",
    endpoint: process.env.OPENCLAW_ENDPOINT ?? "http://127.0.0.1:50348",
    configPath: `${AGENT_CONFIG_DIR}/openclaw`,
    logPath: `${AGENT_LOG_DIR}/openclaw.log`,
    memoryScope: "user",
    workspaceId: "personal",
    enabled: envFlag("OPENCLAW_ENABLED", true),
    legacyPath: "/legacy/openclaw",
    dashboardPort: null,
  },
];

export function getAllVpsAgents(): VpsAgent[] {
  return REGISTRY.filter((a) => a.enabled);
}

export function getVpsAgent(id: string): VpsAgent | undefined {
  return REGISTRY.find((a) => a.id === id && a.enabled);
}

export const ALLOWED_AGENT_IDS = new Set(REGISTRY.map((a) => a.id));
