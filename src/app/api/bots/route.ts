import { NextResponse } from "next/server";
import { adminWorkspaceIds, errorResponse, readBody, requiredString, requireBotAdmin } from "@/lib/bots/api";
import { listBotSummaries } from "@/lib/bots/registry";
import { createBot } from "@/lib/bots/service";

export async function GET(request: Request) {
  try {
    const { workspaceIds } = await adminWorkspaceIds(new URL(request.url).searchParams.get("workspaceId"));
    return NextResponse.json({ bots: await listBotSummaries(workspaceIds), workspaceIds });
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request) {
  try {
    const body = await readBody(request);
    const workspaceId = requiredString(body, "workspaceId");
    const user = await requireBotAdmin(workspaceId);
    const { toolGrants, skillIds, ...fields } = body;
    const bot = await createBot({ ...fields, workspaceId } as Parameters<typeof createBot>[0], user.id, {
      toolGrants: Array.isArray(toolGrants) ? toolGrants : undefined,
      skillIds: Array.isArray(skillIds) ? skillIds.map(String) : undefined,
    });
    return NextResponse.json({ bot }, { status: 201 });
  } catch (error) { return errorResponse(error); }
}
