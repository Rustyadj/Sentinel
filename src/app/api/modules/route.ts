import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { MODULE_MANIFESTS } from "@/lib/modules/manifests";

export async function GET() {
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
