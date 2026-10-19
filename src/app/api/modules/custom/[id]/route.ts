import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireInstanceConfigEditor } from "@/lib/agents/permissions";
import {
  customModuleUpdateSchema, iframeContentIsHttps, invalidBody, IFRAME_CONTENT_ERROR,
} from "@/lib/modules/custom-modules";

type Params = { params: Promise<{ id: string }> };

export async function PUT(req: Request, { params }: Params) {
  const editor = await requireInstanceConfigEditor("edit custom modules");
  if (editor instanceof Response) return editor;
  const { id } = await params;

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  // Allowlisted fields only: the raw body used to be passed straight to
  // Prisma, letting a caller rewrite moduleId/href/config or any other column.
  const parsed = customModuleUpdateSchema.safeParse(raw);
  if (!parsed.success) return invalidBody(parsed.error);

  const existing = await db.customModule.findUnique({ where: { id }, select: { contentType: true, content: true } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!iframeContentIsHttps({ ...existing, ...parsed.data })) {
    return NextResponse.json({ error: IFRAME_CONTENT_ERROR }, { status: 400 });
  }

  const mod = await db.customModule.update({ where: { id }, data: parsed.data });
  return NextResponse.json(mod);
}

export async function DELETE(_req: Request, { params }: Params) {
  const editor = await requireInstanceConfigEditor("delete custom modules");
  if (editor instanceof Response) return editor;
  const { id } = await params;
  await db.customModule.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
