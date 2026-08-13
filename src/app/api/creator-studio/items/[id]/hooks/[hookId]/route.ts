import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";
import { requireOwnedHook } from "@/lib/creator-studio/access";
import { db } from "@/lib/db";

type Params = { params: Promise<{ id: string; hookId: string }> };

export async function PUT(req: NextRequest, { params }: Params) {
  const user = await requireUser();
  const { id, hookId } = await params;
  const hook = await requireOwnedHook(hookId, user.id);
  if (!hook || hook.contentItemId !== id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const body = (await req.json()) as { text?: string; selected?: boolean };
  const updated = await db.contentHook.update({
    where: { id: hookId },
    data: { text: body.text?.trim(), selected: body.selected },
  });
  return NextResponse.json(updated);
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const user = await requireUser();
  const { id, hookId } = await params;
  const hook = await requireOwnedHook(hookId, user.id);
  if (!hook || hook.contentItemId !== id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  await db.contentHook.delete({ where: { id: hookId } });
  return NextResponse.json({ ok: true });
}
