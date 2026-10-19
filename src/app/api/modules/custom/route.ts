import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getControlPlaneUser, requireInstanceConfigEditor, unauthorized } from "@/lib/agents/permissions";
import {
  customModuleCreateSchema, iframeContentIsHttps, invalidBody, IFRAME_CONTENT_ERROR,
} from "@/lib/modules/custom-modules";

export async function GET() {
  if (!(await getControlPlaneUser())) return unauthorized();
  const modules = await db.customModule.findMany({ orderBy: { order: "asc" } });
  return NextResponse.json(modules);
}

export async function POST(req: Request) {
  const editor = await requireInstanceConfigEditor("create custom modules");
  if (editor instanceof Response) return editor;
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const parsed = customModuleCreateSchema.safeParse(raw);
  if (!parsed.success) return invalidBody(parsed.error);
  const body = parsed.data;
  const contentType = body.contentType ?? "markdown";
  const content = body.content ?? `# ${body.label}\n\nCustom module content goes here.`;
  if (!iframeContentIsHttps({ contentType, content })) {
    return NextResponse.json({ error: IFRAME_CONTENT_ERROR }, { status: 400 });
  }
  const moduleId = `custom-${body.label.toLowerCase().replace(/\s+/g, "-")}-${Date.now()}`;
  const mod = await db.customModule.create({
    data: {
      moduleId,
      label: body.label,
      icon: body.icon ?? "Puzzle",
      description: body.description ?? "",
      contentType,
      content,
      order: body.order ?? 200,
    },
  });
  return NextResponse.json(mod, { status: 201 });
}
