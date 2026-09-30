import { NextResponse } from "next/server";
import { errorResponse, HttpError, readBody, requiredString, requireBotAdmin } from "@/lib/bots/api";
import { listWorkspaceSkills, proposeSkill, type SkillSource } from "@/lib/bots/skills";

export async function GET(request: Request) {
  try {
    const workspaceId = new URL(request.url).searchParams.get("workspaceId");
    if (!workspaceId) throw new HttpError("workspaceId is required", 400);
    await requireBotAdmin(workspaceId);
    return NextResponse.json({ skills: await listWorkspaceSkills(workspaceId) });
  } catch (error) { return errorResponse(error); }
}

/** Step 1 of installing a skill: fetch or accept its text and store it as "proposed". Never assignable until approved. */
export async function POST(request: Request) {
  try {
    const body = await readBody(request);
    const workspaceId = requiredString(body, "workspaceId");
    const user = await requireBotAdmin(workspaceId);
    const source: SkillSource = typeof body.url === "string" && body.url.trim()
      ? { kind: "url", url: body.url.trim() }
      : { kind: "inline", content: requiredString(body, "content") };
    return NextResponse.json({ review: await proposeSkill(workspaceId, source, user.id) }, { status: 201 });
  } catch (error) { return errorResponse(error); }
}
