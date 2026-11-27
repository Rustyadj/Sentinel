import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireWorkspacePermission } from "@/lib/workspaces/authorization";
import { writeAuditLog } from "@/lib/workspaces/audit";
import { DEFAULT_AUTONOMY_SETTINGS, sanitizeAutonomySettings } from "@/lib/autonomy/settings";
import { getAutonomySettings, updateAutonomySettings } from "@/lib/autonomy/settings-store";
import { autonomyErrorResponse, str } from "../_shared";

export async function GET(request: NextRequest) {
  try {
    const workspaceId = request.nextUrl.searchParams.get("workspaceId");
    if (!workspaceId) return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
    await requireWorkspacePermission(workspaceId, "workspace.read");
    const agentId = request.nextUrl.searchParams.get("agentId");
    const rows = await db.autonomySettings.findMany({ where: { workspaceId }, select: { agentId: true, settings: true, updatedAt: true } });
    return NextResponse.json({
      defaults: DEFAULT_AUTONOMY_SETTINGS,
      effective: await getAutonomySettings(workspaceId, agentId),
      overrides: rows.map((row) => ({ agentId: row.agentId || null, settings: sanitizeAutonomySettings(row.settings), updatedAt: row.updatedAt })),
    });
  } catch (error) {
    return autonomyErrorResponse(error);
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = (await request.json()) as Record<string, unknown> | null;
    const workspaceId = str(body?.workspaceId, 64);
    if (!body || !workspaceId) return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
    const user = await requireWorkspacePermission(workspaceId, "workspace.update");
    const agentId = str(body.agentId, 80);
    const stored = await updateAutonomySettings({ workspaceId, agentId, patch: body.settings, userId: user.id });
    await writeAuditLog({ workspaceId, userId: user.id, action: "autonomy.settings.updated", entityType: "autonomy_settings", entityId: agentId ?? workspaceId, details: { agentId, settings: stored } });
    return NextResponse.json({ overrides: stored, effective: await getAutonomySettings(workspaceId, agentId) });
  } catch (error) {
    return autonomyErrorResponse(error);
  }
}
