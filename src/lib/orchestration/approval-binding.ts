import { createHash } from "node:crypto";
import type { ApprovalRequest, Prisma } from "@prisma/client";
import { db } from "@/lib/db";

/**
 * An approval authorizes exactly one execution of exactly the action the
 * human saw.
 *
 * - "Exactly the action": every gated request stores the fingerprint of the
 *   action it describes, and only an approval with the same fingerprint can
 *   clear an execution. Editing the task's title, description, file scope or
 *   capabilities, or moving it to another agent or runtime, changes the
 *   fingerprint, so the old approval no longer applies.
 * - "Exactly one execution": clearing spends the approval with a conditional
 *   UPDATE (`consumedAt IS NULL`), the same way bot grants are spent
 *   (src/lib/bots/execution.ts). Two concurrent executions cannot both spend
 *   it, and a retry or rerun needs a new approval.
 */
export interface GatedAction {
  taskId: string;
  runtimeKind: string;
  agentId: string;
  title: string;
  description: string | null;
  fileScope: string[];
  capabilities: string[];
  command: string;
}

/** SHA-256 of the action's canonical JSON: fixed key order, sorted sets, no undefined. */
export function fingerprintAction(action: GatedAction): string {
  const canonical = JSON.stringify([
    ["taskId", action.taskId],
    ["runtimeKind", action.runtimeKind],
    ["agentId", action.agentId],
    ["title", action.title],
    ["description", action.description ?? null],
    ["fileScope", [...action.fileScope].sort()],
    ["capabilities", [...action.capabilities].sort()],
    ["command", action.command],
  ]);
  return createHash("sha256").update(canonical).digest("hex");
}

type Client = Prisma.TransactionClient | typeof db;

/**
 * Spend one approved, unspent approval for this exact action, for this run.
 * Returns the approval it spent, or null when there is none to spend (or a
 * concurrent run spent it first). Each attempt targets one row, so two
 * approvals for the same action are two executions, not one.
 */
export async function consumeApproval(
  input: { taskId: string; actionFingerprint: string; runId: string },
  client: Client = db,
): Promise<ApprovalRequest | null> {
  const candidates = await client.approvalRequest.findMany({
    where: { taskId: input.taskId, actionFingerprint: input.actionFingerprint, status: "approved", consumedAt: null },
    orderBy: { createdAt: "asc" },
    select: { id: true },
    take: 5,
  });
  for (const candidate of candidates) {
    const spent = await client.approvalRequest.updateMany({
      where: { id: candidate.id, taskId: input.taskId, actionFingerprint: input.actionFingerprint, status: "approved", consumedAt: null },
      data: { consumedAt: new Date(), consumedByRunId: input.runId },
    });
    if (spent.count === 1) return client.approvalRequest.findUniqueOrThrow({ where: { id: candidate.id } });
  }
  return null;
}
