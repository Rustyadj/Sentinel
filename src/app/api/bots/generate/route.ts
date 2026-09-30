import { NextResponse } from "next/server";
import { errorResponse, readBody, requiredString, requireBotAdmin } from "@/lib/bots/api";
import { generateBotProposal } from "@/lib/bots/generate";

/** A proposal to review and edit. Creates nothing and grants nothing. */
export async function POST(request: Request) {
  try {
    const body = await readBody(request);
    const workspaceId = requiredString(body, "workspaceId");
    const user = await requireBotAdmin(workspaceId);
    const proposal = await generateBotProposal({ description: requiredString(body, "description"), workspaceId, userId: user.id, hostAgentId: typeof body.hostAgentId === "string" ? body.hostAgentId : undefined });
    return NextResponse.json({ proposal });
  } catch (error) { return errorResponse(error); }
}
