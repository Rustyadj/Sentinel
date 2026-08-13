import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAgentRecordUser, unauthorized, forbidden } from "@/lib/agents/permissions";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Params) {
  const { id } = await params;
  if (!(await requireAgentRecordUser(id))) return unauthorized();
  const agent = await db.agent.findUnique({ where: { id } });
  if (!agent) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(agent);
}

export async function PUT(req: Request, { params }: Params) {
  const { id } = await params;
  const user = await requireAgentRecordUser(id, true);
  if (!user) return forbidden("edit agents");
  const body = await req.json() as Record<string, unknown>;

  // Save old system prompt to history before updating
  const existing = await db.agent.findUnique({
    where: { id },
    include: { configuration: true },
  });
  let promptHistory =
    (existing?.configuration?.promptHistory as { prompt: string; savedAt: string }[]) ?? [];
  if (
    existing?.configuration?.systemPrompt &&
    body.systemPrompt !== undefined &&
    body.systemPrompt !== existing.configuration.systemPrompt
  ) {
    promptHistory = [
      { prompt: existing.configuration.systemPrompt, savedAt: new Date().toISOString() },
      ...promptHistory,
    ].slice(0, 10); // keep last 10
  }

  const configUpdate: Record<string, unknown> = { promptHistory };
  if (body.model !== undefined) configUpdate.model = body.model as string;
  if (body.systemPrompt !== undefined) configUpdate.systemPrompt = body.systemPrompt as string;
  if (body.toolPermissions !== undefined) configUpdate.allowedTools = body.toolPermissions as string[];
  if (body.memoryScope !== undefined) configUpdate.memoryScope = body.memoryScope as string;
  if (body.instructionFiles !== undefined && body.instructionFiles !== null) {
    configUpdate.instructionFiles = body.instructionFiles as object;
  }

  const agent = await db.agent.update({
    where: { id },
    data: {
      ...(body.name !== undefined && { name: body.name as string }),
      ...(body.role !== undefined && { role: body.role as string }),
      ...(body.avatar !== undefined && { avatar: body.avatar as string }),
      ...(body.color !== undefined && { color: body.color as string }),
      ...(body.description !== undefined && { description: body.description as string }),
      ...(body.skills !== undefined && { skills: body.skills as string[] }),
      ...(body.status !== undefined && { status: body.status as string }),
      configuration: {
        upsert: { create: configUpdate, update: configUpdate },
      },
    },
    include: { configuration: true },
  });
  await syncAgentToGraph(agent);
  return NextResponse.json(agent);
}

export async function DELETE(_req: Request, { params }: Params) {
  const { id } = await params;
  const user = await requireAgentRecordUser(id, true);
  if (!user) return forbidden("delete agents");
  await db.agent.delete({ where: { id } });
  await removeAgentFromGraph(id);
  return NextResponse.json({ ok: true });
}
