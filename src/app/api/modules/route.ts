import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { MODULE_MANIFESTS } from "@/lib/modules/manifests";
import { getControlPlaneUser, unauthorized } from "@/lib/agents/permissions";

export async function GET() {
  if (!(await getControlPlaneUser())) return unauthorized();
  const [installed, custom] = await Promise.all([
    db.installedModule.findMany(),
    db.customModule.findMany({ orderBy: { order: "asc" } }),
  ]);
  return NextResponse.json({
    modules: MODULE_MANIFESTS.map((manifest) => ({
      ...manifest,
      installation: installed.find((item) => item.moduleId === manifest.id) ?? null,
    })),
    installed,
    custom,
  });
}
