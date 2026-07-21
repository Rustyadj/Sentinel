import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { canEditConfig, getControlPlaneUser, forbidden, unauthorized } from "@/lib/agents/permissions";

export async function GET() {
  if (!(await getControlPlaneUser())) return unauthorized();
  const modules = await db.customModule.findMany({ orderBy: { order: "asc" } });
  return NextResponse.json(modules);
}

export async function POST(req: Request) {
  const user = await getControlPlaneUser();
  if (!user) return unauthorized();
  if (!canEditConfig(user.role)) return forbidden("create custom modules");
  const body = await req.json() as {
    label: string; icon?: string; description?: string;
    contentType?: string; content?: string; order?: number;
  };
  const moduleId = `custom-${body.label.toLowerCase().replace(/\s+/g, "-")}-${Date.now()}`;
  const mod = await db.customModule.create({
    data: {
      moduleId,
      label: body.label,
      icon: body.icon ?? "Puzzle",
      description: body.description ?? "",
      contentType: body.contentType ?? "markdown",
      content: body.content ?? `# ${body.label}\n\nCustom module content goes here.`,
      order: body.order ?? 200,
    },
  });
  return NextResponse.json(mod, { status: 201 });
}
