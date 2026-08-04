import { NextResponse } from "next/server";
import { ALLOWED_AGENT_IDS } from "@/lib/agents/registry";
import { RUNTIME_PERMISSIONS, requireRuntimeAccess } from "@/lib/agents/runtime/authorization";
import { runtimeErrorResponse } from "@/lib/agents/runtime/api";
import { writeAuditLog } from "@/lib/workspaces/audit";
import { containsSensitiveRuntimeConfig } from "@/lib/agents/runtime/sensitive-config";
import {
  readConfigFile, writeConfigFile, listBackups, rollbackConfigFile,
} from "@/lib/agents/configEditor";

type Params = { params: Promise<{ id: string; fileId: string }> };

export async function GET(_req: Request, { params }: Params) {
  try {
    const { id, fileId } = await params;
    if (!ALLOWED_AGENT_IDS.has(id)) {
      return NextResponse.json({ error: "Agent not found" }, { status: 404 });
    }
    await requireRuntimeAccess(id, RUNTIME_PERMISSIONS.view);
    const file = await readConfigFile(id, fileId);
    if (containsSensitiveRuntimeConfig(file.content)) {
      return NextResponse.json({ error: "Credential-bearing files are not exposed through Sentinel" }, { status: 403 });
    }
    const backups = await listBackups(id, fileId);
    return NextResponse.json({ ...file, backups });
  } catch (error) {
    return runtimeErrorResponse(error);
  }
}

export async function PUT(req: Request, { params }: Params) {
  try {
    const { id, fileId } = await params;
    if (!ALLOWED_AGENT_IDS.has(id)) {
      return NextResponse.json({ error: "Agent not found" }, { status: 404 });
    }
    const { user, runtime } = await requireRuntimeAccess(id, RUNTIME_PERMISSIONS.configure);
    const body = await req.json() as { content?: string; rollbackTo?: string };

    if (body.rollbackTo) {
      const result = await rollbackConfigFile(id, fileId, body.rollbackTo);
      if (!result.ok) {
        return NextResponse.json({ error: result.error }, { status: 400 });
      }
      await writeAuditLog({
        workspaceId: runtime.workspaceId,
        userId: user.id,
        action: "agent_runtime.config_rolled_back",
        entityType: "AgentRuntime",
        entityId: runtime.id,
        details: { fileId, backup: body.rollbackTo },
      });
      return NextResponse.json({ ok: true, rolledBack: true, savedAt: new Date().toISOString() });
    }

    if (typeof body.content !== "string") {
      return NextResponse.json({ error: "content is required" }, { status: 400 });
    }
    if (containsSensitiveRuntimeConfig(body.content)) {
      return NextResponse.json({ error: "Credentials cannot be managed through Sentinel" }, { status: 400 });
    }

    const result = await writeConfigFile(id, fileId, body.content);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
    await writeAuditLog({
      workspaceId: runtime.workspaceId,
      userId: user.id,
      action: "agent_runtime.config_updated",
      entityType: "AgentRuntime",
      entityId: runtime.id,
      details: { fileId },
    });

    return NextResponse.json({
      ok: true,
      backupPath: result.backupPath,
      savedAt: new Date().toISOString(),
      savedBy: user.email,
    });
  } catch (error) {
    return runtimeErrorResponse(error);
  }
}
