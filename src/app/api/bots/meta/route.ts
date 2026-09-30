import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { asRuntimeInstance } from "@/lib/agents/runtime/config";
import { getAdapterForRuntime } from "@/lib/agents/runtime/service";
import { errorResponse, HttpError, requireBotAdmin } from "@/lib/bots/api";
import { botModelOptions, listBotHosts } from "@/lib/bots/models";
import { MEMORY_SCOPES, TOOL_PERMISSIONS } from "@/lib/bots/schema";
import { BOT_TEMPLATES } from "@/lib/bots/templates";

/**
 * Everything the create/edit screens need to offer real choices: hosts, model
 * options from the registry, templates, and who can be named as an allowed
 * caller. `?health=1` also probes each host, which opens a connection to it.
 */
export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const workspaceId = params.get("workspaceId");
    if (!workspaceId) throw new HttpError("workspaceId is required", 400);
    await requireBotAdmin(workspaceId);
    const withHealth = params.get("health") === "1";
    const hosts = await Promise.all((await listBotHosts()).map(async (host) => {
      let health: { ready: boolean; reason?: string } | null = null;
      if (withHealth) {
        const { adapter } = await getAdapterForRuntime(host.agentId);
        health = await adapter.readiness(asRuntimeInstance(host)).catch(() => ({ ready: false, reason: "unreachable" }));
      }
      return { agentId: host.agentId, kind: host.kind, executionVerified: host.executionVerified, health };
    }));
    const hostId = params.get("runtimeAgentId") ?? hosts[0]?.agentId;
    const models = hostId ? await botModelOptions(hostId).catch(() => null) : null;
    const clients = await db.externalClient.findMany({ where: { enabled: true }, select: { id: true, name: true, clientId: true }, orderBy: { name: "asc" } });
    return NextResponse.json({
      hosts, models, templates: BOT_TEMPLATES, memoryScopes: MEMORY_SCOPES, toolPermissions: TOOL_PERMISSIONS,
      callers: { agents: hosts.map((host) => `agent:${host.agentId}`), clients: clients.map((client) => ({ key: `client:${client.id}`, name: client.name })) },
    });
  } catch (error) { return errorResponse(error); }
}
