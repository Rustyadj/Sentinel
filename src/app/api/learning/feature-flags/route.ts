import { NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";
import {
  createFeatureFlag,
  listFeatureFlags,
} from "@/lib/learning/feature-flags";
import {
  learningAccessErrorResponse,
  requireFeatureFlagAccess,
} from "@/lib/learning/authorization";

export async function GET(req: Request) {
  const user = await requireUser().catch(() => null);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  return NextResponse.json(await listFeatureFlags({
    scopeType: searchParams.get("scopeType") ?? undefined,
    scopeId: searchParams.get("scopeId") ?? undefined,
  }));
}

export async function POST(req: Request) {
  const user = await requireUser().catch(() => null);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  if (!body?.key || !body?.name) {
    return NextResponse.json({ error: "key and name are required" }, { status: 400 });
  }
  try {
    const scopeType = body.scopeType ?? "global";
    const scopeId = body.scopeId ?? null;
    await requireFeatureFlagAccess(user.id, { scopeType, scopeId }, "workspace.update");
    return NextResponse.json(
      await createFeatureFlag(body, { authorizedByUserId: user.id }),
      { status: 201 },
    );
  } catch (error) {
    return learningAccessErrorResponse(error);
  }
}
