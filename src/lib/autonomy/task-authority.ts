import type { Task } from "@prisma/client";
import { emitCollaborationEvent } from "@/lib/orchestration/event-bus";
import { resolveGuardianReview } from "@/lib/learning/guardian";
import { logger } from "@/lib/logger";
import type { AuthorityOperation } from "./authority";
import { requiredTaskOperation } from "./task-authority-rules";
import { authorizeOperation, type AuthorizationOutcome } from "./authority-store";

export { keywordOperation, requiredTaskOperation } from "./task-authority-rules";

export interface TaskAuthorityInput {
  task: Pick<Task, "id" | "title" | "description" | "fileScope" | "capabilities" | "projectId" | "agentId">;
  roomId: string;
  workspaceId: string;
  runtimeKind: string | null;
  actionClass: string;
  /** fingerprintAction() of this exact action; retries of the identical action reuse one grant use. */
  fingerprint: string;
  /** Distinguishes the approval-gate use from the Guardian use of the same action. */
  gate: "approval" | "guardian";
}

export async function authorizeTaskAction(input: TaskAuthorityInput): Promise<AuthorizationOutcome & { operation: AuthorityOperation }> {
  const text = `${input.task.title} ${input.task.description ?? ""} ${input.task.fileScope.join(" ")}`;
  const operation = requiredTaskOperation(input.actionClass, text);
  const outcome = await authorizeOperation(
    {
      workspaceId: input.workspaceId, projectId: input.task.projectId, agentId: input.task.agentId ?? "unassigned", roomId: input.roomId,
      operation, capabilities: input.task.capabilities, runtime: input.runtimeKind,
    },
    { type: input.gate === "approval" ? "task" : "guardian_review", id: input.task.id, correlationId: input.fingerprint },
  );
  if (outcome.authorized && outcome.grant) {
    await emitCollaborationEvent(input.roomId, "authority.applied", {
      taskId: input.task.id, grantId: outcome.grant.id, useId: outcome.useId, operation, gate: input.gate,
    }).catch(() => undefined);
  }
  return { ...outcome, operation };
}

/**
 * A Tier 2 Guardian hold exists for human review. A standing grant is that
 * human's review given in advance, so it resolves the hold in the grantor's
 * name, with the grant recorded as the reason. Hard blocks never reach here.
 */
export async function resolveHoldWithGrant(decisionId: string, grant: { id: string; grantedByUserId?: string | null }): Promise<boolean> {
  if (!grant.grantedByUserId) return false;
  try {
    await resolveGuardianReview({ decisionId, reviewerId: grant.grantedByUserId, approve: true, notes: `Standing delegation grant ${grant.id}` });
    return true;
  } catch (error) {
    logger.warn("autonomy.guardian_hold_resolution_failed", { decisionId, grantId: grant.id, error: error instanceof Error ? error.message : String(error) });
    return false;
  }
}
