import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { errorResponse, HttpError, readBody, requireBotAdmin } from "@/lib/bots/api";
import { deleteMcpServer, refreshMcpServer, setMcpServerEnabled } from "@/lib/bots/catalog";

type Ctx = { params: Promise<{ serverId: string }> };

async function authorize(serverId: string) {
  const row = await db.mcpServerRegistration.findUnique({ where: { id: serverId }, select: { workspaceId: true } });
  if (!row) throw new HttpError("Server not found", 404);
  return { workspaceId: row.workspaceId, user: await requireBotAdmin(row.workspaceId) };
}

/** refresh | enable | disable. */
export async function POST(request: Request, { params }: Ctx) {
  try {
    const { serverId } = await params;
    const { workspaceId, user } = await authorize(serverId);
    const body = await readBody(request);
    switch (body.action) {
      case "refresh": { const row = await refreshMcpServer(serverId, workspaceId, user.id); return NextResponse.json({ status: row.status, lastError: row.lastError, tools: Array.isArray(row.tools) ? row.tools.length : 0 }); }
      case "enable": await setMcpServerEnabled(serverId, workspaceId, true, user.id); return NextResponse.json({ ok: true });
      case "disable": await setMcpServerEnabled(serverId, workspaceId, false, user.id); return NextResponse.json({ ok: true });
      default: throw new HttpError("action must be refresh, enable or disable", 400);
    }
  } catch (error) { return errorResponse(error); }
}

export async function DELETE(_request: Request, { params }: Ctx) {
  try {
    const { serverId } = await params;
    const { workspaceId, user } = await authorize(serverId);
    await deleteMcpServer(serverId, workspaceId, user.id);
    return NextResponse.json({ ok: true });
  } catch (error) { return errorResponse(error); }
}
