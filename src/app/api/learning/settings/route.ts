import { NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";
import {
  getLearningSettings,
  upsertLearningSettings,
  requireLearningSettingsAccess,
  type LearningSettingsScopeType,
} from "@/lib/learning/settings";
import { learningAccessErrorResponse } from "@/lib/learning/authorization";

export async function GET(req: Request) {
  const user = await requireUser().catch(() => null);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const scopeType = searchParams.get("scopeType") as LearningSettingsScopeType | null;
  const scopeId = searchParams.get("scopeId");
  if (!scopeType || !scopeId) {
    return NextResponse.json({ error: "scopeType and scopeId are required" }, { status: 400 });
  }
  try {
    await requireLearningSettingsAccess(user.id, scopeType, scopeId, "workspace.read");
    const settings = await getLearningSettings(scopeType, scopeId);
    return NextResponse.json(settings ?? null);
  } catch (error) {
    return learningAccessErrorResponse(error);
  }
}

export async function POST(req: Request) {
  const user = await requireUser().catch(() => null);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const { scopeType, scopeId, ...fields } = body ?? {};
  if (!scopeType || !scopeId) {
    return NextResponse.json({ error: "scopeType and scopeId are required" }, { status: 400 });
  }
  try {
    await requireLearningSettingsAccess(user.id, scopeType, scopeId, "workspace.update");
    const settings = await upsertLearningSettings(scopeType, scopeId, fields, { updatedByUserId: user.id });
    return NextResponse.json(settings);
  } catch (error) {
    return learningAccessErrorResponse(error);
  }
}
