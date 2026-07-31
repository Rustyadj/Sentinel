import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";
import { requireOwnedItem } from "@/lib/creator-studio/access";
import { db } from "@/lib/db";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const user = await requireUser();
  const { id } = await params;
  if (!(await requireOwnedItem(id, user.id))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const hooks = await db.contentHook.findMany({ where: { contentItemId: id }, orderBy: { createdAt: "desc" } });
  return NextResponse.json(hooks);
}

export async function POST(req: NextRequest, { params }: Params) {
  const user = await requireUser();
  const { id } = await params;
  if (!(await requireOwnedItem(id, user.id))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const body = (await req.json()) as { style?: string; text?: string };
  if (!body.style || !body.text?.trim()) {
    return NextResponse.json({ error: "Missing required fields: style, text" }, { status: 400 });
  }
  const hook = await db.contentHook.create({
    data: { contentItemId: id, style: body.style, text: body.text.trim() },
  });
  return NextResponse.json(hook, { status: 201 });
}
