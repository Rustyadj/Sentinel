import { readFile, unlink } from "node:fs/promises";
import { accessErrorResponse } from "@/lib/workspaces/authorization";
import { AGENT_WORKSPACE_PERMISSIONS, requireWorkspaceAccess } from "@/lib/agent-workspaces/authorization";
import { browserRuntimeStatus, getBrowserProvider } from "@/lib/agent-workspaces/browser";
import { WorkspaceError, workspaceErrorResponse } from "@/lib/agent-workspaces/errors";
import { recordWorkspaceEvent } from "@/lib/agent-workspaces/events";
import { readJson, requireString } from "@/lib/agent-workspaces/http";
import { parseLimits } from "@/lib/agent-workspaces/policy";

function assertAttached() {
  const status = browserRuntimeStatus();
  if (!status.attached) {
    throw new WorkspaceError(status.reason ?? "The browser runtime is unavailable.", "runtime_unavailable");
  }
  return getBrowserProvider();
}

function assertSessionWorkspace(sessionId: string, workspaceId: string) {
  const provider = assertAttached();
  const session = provider.getSession(sessionId);
  if (!session || session.workspaceId !== workspaceId) {
    throw new WorkspaceError("Browser session not found for this workspace.", "runtime_not_found");
  }
  return { provider, session };
}

function assertNetworkAllowed(resourceLimits: unknown) {
  if (parseLimits(resourceLimits).network === "none") {
    throw new WorkspaceError("Browser network access is disabled by this workspace's network policy.", "policy_violation");
  }
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    await requireWorkspaceAccess(id, AGENT_WORKSPACE_PERMISSIONS.view);
    const url = new URL(request.url);
    if (url.searchParams.get("status") === "true") {
      return Response.json(browserRuntimeStatus(), { headers: { "Cache-Control": "no-store" } });
    }
    const sessionId = requireString(url.searchParams.get("sessionId") ?? undefined, "sessionId", 200);
    const { provider } = assertSessionWorkspace(sessionId, id);
    const screenshot = await provider.screenshot(sessionId, url.searchParams.get("fullPage") === "true");
    return new Response(new Uint8Array(screenshot.data), {
      headers: {
        "Content-Type": screenshot.contentType,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    if (error instanceof Error && error.name === "WorkspaceAccessError") return accessErrorResponse(error);
    return workspaceErrorResponse(error);
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { user, workspace } = await requireWorkspaceAccess(id, AGENT_WORKSPACE_PERMISSIONS.execute);
    const body = await readJson(request);
    const action = requireString(body.action, "action", 20);
    const provider = assertAttached();

    if (action === "create") {
      const session = await provider.createSession(id);
      await recordWorkspaceEvent({
        agentWorkspaceId: id,
        tenantWorkspaceId: workspace.workspaceId,
        type: "process.started",
        actorUserId: user.id,
        source: "sentinel-ui",
        message: "Browser session started.",
        metadata: { browserSessionId: session.sessionId, provider: provider.id },
      });
      return Response.json({ session }, { status: 201 });
    }

    assertNetworkAllowed(workspace.resourceLimits);
    const sessionId = requireString(body.sessionId, "sessionId", 200);
    assertSessionWorkspace(sessionId, id);
    const targetUrl = requireString(body.url, "url", 4096);

    if (action === "navigate") {
      const navigation = await provider.navigate(sessionId, targetUrl);
      await recordWorkspaceEvent({
        agentWorkspaceId: id,
        tenantWorkspaceId: workspace.workspaceId,
        type: "command.executed",
        actorUserId: user.id,
        source: "sentinel-ui",
        message: `Browser navigated to ${navigation.url}`,
        metadata: { browserSessionId: sessionId, url: navigation.url, status: navigation.status },
      });
      return Response.json({ session: provider.getSession(sessionId), navigation });
    }

    if (action === "download") {
      let parsed: URL;
      try {
        parsed = new URL(targetUrl);
      } catch {
        throw new WorkspaceError("A valid browser URL is required.", "invalid_body");
      }
      const requestedName = typeof body.filename === "string" && body.filename.trim()
        ? body.filename.trim()
        : parsed.pathname.split("/").filter(Boolean).pop() ?? "download";
      const result = await provider.download(sessionId, targetUrl, requestedName);
      try {
        const data = await readFile(result.path);
        await recordWorkspaceEvent({
          agentWorkspaceId: id,
          tenantWorkspaceId: workspace.workspaceId,
          type: "command.executed",
          actorUserId: user.id,
          source: "sentinel-ui",
          message: `Browser downloaded ${requestedName}`,
          metadata: { browserSessionId: sessionId, url: targetUrl, filename: requestedName, sizeBytes: result.sizeBytes },
        });
        const filename = requestedName.replace(/[^a-zA-Z0-9._-]/g, "_") || "download";
        return new Response(new Uint8Array(data), {
          headers: {
            "Content-Type": "application/octet-stream",
            "Content-Disposition": `attachment; filename="${filename}"`,
            "Content-Length": String(data.byteLength),
            "Cache-Control": "no-store",
          },
        });
      } finally {
        await unlink(result.path).catch(() => undefined);
      }
    }

    throw new WorkspaceError('"action" must be "create", "navigate", or "download".', "invalid_body");
  } catch (error) {
    if (error instanceof Error && error.name === "WorkspaceAccessError") return accessErrorResponse(error);
    return workspaceErrorResponse(error);
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { user, workspace } = await requireWorkspaceAccess(id, AGENT_WORKSPACE_PERMISSIONS.execute);
    const sessionId = requireString(new URL(request.url).searchParams.get("sessionId") ?? undefined, "sessionId", 200);
    const { provider } = assertSessionWorkspace(sessionId, id);
    await provider.closeSession(sessionId);
    await recordWorkspaceEvent({
      agentWorkspaceId: id,
      tenantWorkspaceId: workspace.workspaceId,
      type: "process.stopped",
      actorUserId: user.id,
      source: "sentinel-ui",
      message: "Browser session closed.",
      metadata: { browserSessionId: sessionId, provider: provider.id },
    });
    return Response.json({ ok: true });
  } catch (error) {
    if (error instanceof Error && error.name === "WorkspaceAccessError") return accessErrorResponse(error);
    return workspaceErrorResponse(error);
  }
}
