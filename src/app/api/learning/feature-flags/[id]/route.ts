import { NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";
import { getFeatureFlag, updateFeatureFlag } from "@/lib/learning/feature-flags";
import {
  LearningAccessError,
  learningAccessErrorResponse,
  requireFeatureFlagAccess,
} from "@/lib/learning/authorization";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requireUser().catch(() => null);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = await req.json();
  try {
    const current = await getFeatureFlag(id);
    if (!current) throw new LearningAccessError();
    await requireFeatureFlagAccess(user.id, current, "workspace.update");
    const nextScope = {
      scopeType: body.scopeType ?? current.scopeType,
      scopeId: body.scopeId !== undefined ? body.scopeId : current.scopeId,
    };
    await requireFeatureFlagAccess(user.id, nextScope, "workspace.update");
    return NextResponse.json(
      await updateFeatureFlag(id, body, { authorizedByUserId: user.id }),
    );
  } catch (error) {
    return learningAccessErrorResponse(error);
  }
}
