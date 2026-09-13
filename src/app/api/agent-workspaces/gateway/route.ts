import { requireUser } from "@/lib/current-user";
import { accessErrorResponse } from "@/lib/workspaces/authorization";
import { AGENT_WORKSPACE_PERMISSIONS, requireWorkspaceAccess } from "@/lib/agent-workspaces/authorization";
import { WorkspaceError, workspaceErrorResponse } from "@/lib/agent-workspaces/errors";
import { readJson, requireString, optionalString, serialize } from "@/lib/agent-workspaces/http";
import { authorizeAgentRequest } from "@/lib/agent-workspaces/gateway";
import { runCommand } from "@/lib/agent-workspaces/exec";
import { listFiles, readFile, writeFile } from "@/lib/agent-workspaces/files";
import type { RuntimeClient } from "@/lib/agent-workspaces/types";

const CLIENTS: RuntimeClient[] = ["hermes", "claude-code", "codex"];
const OPERATIONS = ["exec", "list", "read", "write"] as const;
type Operation = typeof OPERATIONS[number];

/**
 * Sentinel Runtime Gateway — the only door execution clients use.
 *
 * A client never talks to the container runtime. It declares who it is
 * (`client`) and which agent it acts for (`actingAgentId`); the gateway
 * resolves human authorization, workspace ownership, cross-agent grants and
 * the cross-client delegation policy before any provider call happens.
 *
 * A `delegation` block is only accepted when the operator explicitly
 * authorised this specific handoff — Claude Code and Codex never divide work
 * between themselves on their own.
 */
export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const body = await readJson(request);
    const client = requireString(body.client, "client", 40) as RuntimeClient;
    if (!CLIENTS.includes(client)) throw new WorkspaceError("Unknown runtime client.", "invalid_body");
    const operation = requireString(body.operation, "operation", 20) as Operation;
    if (!OPERATIONS.includes(operation)) throw new WorkspaceError("Unsupported gateway operation.", "invalid_body");

    const agentWorkspaceId = requireString(body.agentWorkspaceId, "agentWorkspaceId", 200);
    const actingAgentId = requireString(body.actingAgentId, "actingAgentId", 200);
    const mutating = operation === "exec" || operation === "write";

    // The human on the request must independently hold the tenant permission
    // for what the client is asking to do.
    await requireWorkspaceAccess(
      agentWorkspaceId,
      mutating ? AGENT_WORKSPACE_PERMISSIONS.execute : AGENT_WORKSPACE_PERMISSIONS.view,
    );

    const delegation = body.delegation as { fromClient?: string; reason?: string } | undefined;
    const { workspace, actor } = await authorizeAgentRequest({
      agentWorkspaceId,
      actingAgentId,
      client,
      requiredLevel: mutating ? "write" : "read",
      delegation: delegation?.fromClient
        ? {
            fromClient: delegation.fromClient as RuntimeClient,
            authorizedByUserId: user.id,
            reason: requireString(delegation.reason, "delegation.reason", 500),
          }
        : null,
    });

    switch (operation) {
      case "exec":
        return Response.json(serialize({
          result: await runCommand({
            workspace,
            command: requireString(body.command, "command", 16_000),
            cwd: optionalString(body.cwd, "cwd", 4096),
            timeoutMs: typeof body.timeoutMs === "number" ? body.timeoutMs : undefined,
            actor,
          }),
        }));
      case "list":
        return Response.json(await listFiles(workspace, optionalString(body.path, "path", 4096)));
      case "read":
        return Response.json(await readFile(workspace, requireString(body.path, "path", 4096)));
      case "write":
        return Response.json(await writeFile(
          workspace,
          requireString(body.path, "path", 4096),
          typeof body.content === "string" ? body.content : "",
          body.encoding === "base64" ? "base64" : "utf8",
          actor,
        ));
    }
  } catch (error) {
    if (error instanceof Error && error.name === "WorkspaceAccessError") return accessErrorResponse(error);
    return workspaceErrorResponse(error);
  }
}
