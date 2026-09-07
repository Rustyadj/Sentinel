import { recordProductionFailure } from "@/lib/learning/production-failures";
import { RUNTIME_PERMISSIONS, requireSessionAccess } from "@/lib/agents/runtime/authorization";
import { readJsonObject, runtimeErrorResponse } from "@/lib/agents/runtime/api";
import { delegateSession } from "@/lib/agents/runtime/delegation";
import { RuntimeError } from "@/lib/agents/runtime/errors";

export async function POST(request: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  let failureScope: { sourceId: string; workspaceId?: string; userId: string } | undefined;
  try {
    const { sessionId } = await params;
    const { user, session: source } = await requireSessionAccess(sessionId, RUNTIME_PERMISSIONS.execute);
    failureScope = { sourceId: sessionId, workspaceId: source.workspaceId, userId: user.id };
    const body = await readJsonObject(request);
    if (typeof body.targetAgentId !== "string" || typeof body.reason !== "string") {
      throw new RuntimeError("targetAgentId and reason are required", "invalid_body", 400);
    }
    if (body.context !== undefined && (!body.context || typeof body.context !== "object" || Array.isArray(body.context))) {
      throw new RuntimeError("context must be a JSON object", "invalid_body", 400);
    }
    const session = await delegateSession({
      sourceSessionId: sessionId,
      targetAgentId: body.targetAgentId,
      reason: body.reason,
      context: body.context as Record<string, unknown> | undefined,
      actorUserId: user.id,
    });
    return Response.json({ session }, { status: 201 });
  } catch (error) {
    if (failureScope) await recordProductionFailure("delegation_failure", { ...failureScope, context: { reason: error instanceof Error ? error.message : "Delegation failed" } }).catch(() => undefined);
    return runtimeErrorResponse(error);
  }
}
