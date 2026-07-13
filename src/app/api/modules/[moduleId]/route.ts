import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { getModuleManifest } from "@/lib/modules/manifests";

type Params = { params: Promise<{ moduleId: string }> };

export async function GET(_req: Request, { params }: Params) {
  const { moduleId } = await params;
  const mod = await db.installedModule.findUnique({ where: { moduleId } });
  return NextResponse.json(mod ?? { moduleId, enabled: true });
}

export async function PUT(req: Request, { params }: Params) {
  const { moduleId } = await params;
  const body = await req.json() as { enabled?: boolean; config?: object };
  const manifest = getModuleManifest(moduleId);
  if (!manifest) return NextResponse.json({ error: "Unknown module" }, { status: 404 });
  const configValue = (body.config ?? {}) as Prisma.InputJsonValue;
  const manifestValue = manifest as unknown as Prisma.InputJsonValue;
  const mod = await db.installedModule.upsert({
    where: { moduleId },
    create: { moduleId, enabled: body.enabled ?? true, version: manifest.version, manifest: manifestValue, config: configValue },
    update: { enabled: body.enabled ?? true, version: manifest.version, manifest: manifestValue, ...(body.config !== undefined && { config: configValue }) },
  });
  return NextResponse.json(mod);
}

export async function DELETE(_req: Request, { params }: Params) {
  const { moduleId } = await params;
  await db.installedModule.deleteMany({ where: { moduleId } });
  return new NextResponse(null, { status: 204 });
}
