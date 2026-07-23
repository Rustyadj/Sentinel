import { NextResponse } from "next/server";
import { ALLOWED_AGENT_IDS } from "@/lib/agents/registry";
import {
  getControlPlaneUser, canViewAgent, canEditConfig,
  unauthorized, forbidden,
} from "@/lib/agents/permissions";
import {
  readConfigFile, writeConfigFile, listBackups, rollbackConfigFile,
} from "@/lib/agents/configEditor";

type Params = { params: Promise<{ id: string; fileId: string }> };

export async function GET(_req: Request, { params }: Params) {
  const { id, fileId } = await params;
  const user = await getControlPlaneUser(id);
  if (!user || !canViewAgent(user.role)) return unauthorized();
  if (!ALLOWED_AGENT_IDS.has(id)) {
    return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  }

  try {
    const file = await readConfigFile(id, fileId);
    const backups = await listBackups(id, fileId);
    return NextResponse.json({ ...file, backups });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function PUT(req: Request, { params }: Params) {
  const { id, fileId } = await params;
  const user = await getControlPlaneUser(id);
  if (!user) return unauthorized();
  if (!canEditConfig(user.role)) return forbidden("edit config files");
  if (!ALLOWED_AGENT_IDS.has(id)) {
    return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  }

  const body = await req.json() as { content?: string; rollbackTo?: string };

  // Rollback path
  if (body.rollbackTo) {
    const result = await rollbackConfigFile(id, fileId, body.rollbackTo);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
    return NextResponse.json({ ok: true, rolledBack: true, savedAt: new Date().toISOString() });
  }

  // Write path
  if (typeof body.content !== "string") {
    return NextResponse.json({ error: "content is required" }, { status: 400 });
  }

  const result = await writeConfigFile(id, fileId, body.content);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json({
    ok: true,
    backupPath: result.backupPath,
    diff: result.diff,
    savedAt: new Date().toISOString(),
    savedBy: user.email,
  });
}
