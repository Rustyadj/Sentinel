import { requireUser } from "@/lib/current-user";
import { adaptiveErrorResponse } from "@/lib/adaptive-memory/scope";
import { reviewWorkflowProposal } from "@/lib/adaptive-memory/workflow-discovery";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const body = await request.json();
    if (body.decision !== "approve" && body.decision !== "reject") {
      return Response.json({ error: "decision must be approve or reject" }, { status: 400 });
    }
    return Response.json(await reviewWorkflowProposal({ proposalId: id, actorUserId: user.id,
      decision: body.decision, activate: body.activate === true, reviewNote: body.reviewNote }));
  } catch (error) { return adaptiveErrorResponse(error); }
}
