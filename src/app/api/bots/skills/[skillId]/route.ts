import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { errorResponse, HttpError, readBody, requireBotAdmin } from "@/lib/bots/api";
import { approveSkill, getSkillReview, rejectSkill } from "@/lib/bots/skills";

type Ctx = { params: Promise<{ skillId: string }> };

async function authorize(skillId: string) {
  const skill = await db.skill.findUnique({ where: { id: skillId }, select: { workspaceId: true } });
  if (!skill?.workspaceId) throw new HttpError("Skill not found", 404);
  return { workspaceId: skill.workspaceId, user: await requireBotAdmin(skill.workspaceId) };
}

/** The exact text and digest an admin reviews before approving. */
export async function GET(_request: Request, { params }: Ctx) {
  try {
    const { skillId } = await params;
    const { workspaceId } = await authorize(skillId);
    return NextResponse.json({ review: await getSkillReview(skillId, workspaceId) });
  } catch (error) { return errorResponse(error); }
}

/** approve (with the sha256 that was reviewed) | reject. */
export async function POST(request: Request, { params }: Ctx) {
  try {
    const { skillId } = await params;
    const { workspaceId, user } = await authorize(skillId);
    const body = await readBody(request);
    if (body.action === "approve") return NextResponse.json({ review: await approveSkill(skillId, workspaceId, typeof body.sha256 === "string" ? body.sha256 : "", user.id) });
    if (body.action === "reject") { await rejectSkill(skillId, workspaceId, user.id); return NextResponse.json({ ok: true }); }
    throw new HttpError("action must be approve or reject", 400);
  } catch (error) { return errorResponse(error); }
}
