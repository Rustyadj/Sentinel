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
import { getAccessibleWorkspaceIds } from "@/lib/agents/permissions";

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
    // There is no global-admin role in this app. When callers omit scope,
    // resolve the explicit request header/body workspace or their first
    // accessible workspace and default there, never to an ungoverned global.
    const accessibleWorkspaceIds = await getAccessibleWorkspaceIds(user.id);
    const requestedWorkspaceId =
      req.headers.get("x-workspace-id")?.trim() ||
      (typeof body.workspaceId === "string" ? body.workspaceId.trim() : "");
    const defaultWorkspaceId = requestedWorkspaceId || accessibleWorkspaceIds[0];
    const scopeType = body.scopeType ?? "workspace";
    const scopeId = body.scopeId ?? defaultWorkspaceId ?? null;
    await requireFeatureFlagAccess(user.id, { scopeType, scopeId }, "workspace.update");
    return NextResponse.json(
      await createFeatureFlag(
        { ...body, scopeType, scopeId },
        { authorizedByUserId: user.id, defaultWorkspaceId },
      ),
      { status: 201 },
    );
  } catch (error) {
    return learningAccessErrorResponse(error);
  }
}
