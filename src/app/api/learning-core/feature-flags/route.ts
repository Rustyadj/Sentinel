import { NextResponse } from "next/server";
import { createFeatureFlag, listFeatureFlags } from "@/lib/learning-core/feature-flags";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  return NextResponse.json(await listFeatureFlags({
    scope: searchParams.get("scope") ?? undefined,
    enabled: searchParams.has("enabled") ? searchParams.get("enabled") === "true" : undefined,
  }));
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    if (!body.key) return NextResponse.json({ error: "key is required" }, { status: 400 });
    return NextResponse.json(await createFeatureFlag(body), { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to create feature flag" }, { status: 400 });
  }
}
