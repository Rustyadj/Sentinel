/**
 * VPS Agent Registry — server-side typed service layer.
 * Reads runtime-instance data from the DB (AgentInstance, joined with its
 * owning Agent). Never imported in client components.
 */
import { db } from "@/lib/db";
import type { Agent, AgentInstance } from "@prisma/client";
import { ensureAgentsSeeded } from "./seed";

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

export async function getAllVpsAgents(): Promise<VpsAgent[]> {
  await ensureAgentsSeeded();
  const instances = await db.agentInstance.findMany({
    where: { enabled: true },
    include: { agent: true },
  });
  return instances.map(toVpsAgent);
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
