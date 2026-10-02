import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { errorResponse, HttpError, readBody, requiredString, requireBotAdmin } from "@/lib/bots/api";
import { registerMcpServer, refreshMcpServer } from "@/lib/bots/catalog";
import { listBotHosts } from "@/lib/bots/models";
import { createBot } from "@/lib/bots/service";
import { getBotTemplate } from "@/lib/bots/templates";

/**
 * Idempotently connect the explicitly configured MobileOps MCP server and
 * create the first production bot as a draft.  Discovery is real: this route
 * never stores a pretend connection or grants tools it has not discovered.
 */
export async function POST(request: Request) {
  try {
    const body = await readBody(request);
    const workspaceId = requiredString(body, "workspaceId");
    const user = await requireBotAdmin(workspaceId);
    const existingBot = await db.bot.findUnique({ where: { workspaceId_slug: { workspaceId, slug: "mobileops-admin" } } });
    if (existingBot) return NextResponse.json({ botId: existingBot.id, created: false });

    const url = process.env.MOBILEOPS_MCP_URL?.trim();
    if (!url) throw new HttpError("MOBILEOPS_MCP_URL is not configured on Sentinel", 409);
    if (!process.env.MOBILEOPS_MCP_TOKEN?.trim()) throw new HttpError("MOBILEOPS_MCP_TOKEN is not configured on Sentinel", 409);

    let server = await db.mcpServerRegistration.findUnique({ where: { workspaceId_slug: { workspaceId, slug: "mobileops" } } });
    if (!server) {
      server = await registerMcpServer({ workspaceId, name: "MobileOps", url, description: "Typed MobileOps operational and admin tools.", authMode: "bearer-env", secretEnvVar: "MOBILEOPS_MCP_TOKEN", capabilityTags: ["mobileops", "operations", "admin"] }, user.id);
    }
    server = await refreshMcpServer(server.id, workspaceId, user.id);
    if (server.status !== "connected" || !Array.isArray(server.tools) || server.tools.length === 0) throw new HttpError(`MobileOps tool discovery failed: ${server.lastError ?? "no tools discovered"}`, 409);

    const template = getBotTemplate("mobileops-admin");
    const host = (await listBotHosts()).find((candidate) => candidate.agentId.toLowerCase().includes("nathan")) ?? (await listBotHosts())[0];
    if (!template || !host) throw new HttpError("No enabled Hermes host is available for MobileOps Admin", 409);
    const tools = server.tools as unknown as { name?: unknown; readOnly?: unknown }[];
    const bot = await createBot({ ...template.fields, workspaceId, runtimeAgentId: host.agentId, status: "draft" }, user.id, {
      toolGrants: tools.flatMap((tool) => typeof tool.name === "string" ? [{ serverId: server!.id, toolName: tool.name, permission: tool.readOnly === true ? "read" as const : "approval" as const }] : []),
    });
    return NextResponse.json({ bot, created: true, server: { id: server.id, status: server.status, tools: tools.length } }, { status: 201 });
  } catch (error) { return errorResponse(error); }
}
