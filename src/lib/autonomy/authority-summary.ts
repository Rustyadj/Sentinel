import { ROUTINE_OPERATIONS, type AuthorityGrantLike } from "./authority";

/**
 * Tells an agent what it is already authorized to do, so it does not ask for
 * permission it holds — and knows that anything outside it is routed to a
 * human automatically, without stopping unrelated work. Only grants that can
 * apply to this agent are listed. Pure.
 */
export function summarizeAuthority(agentId: string, workspaceId: string, grants: readonly AuthorityGrantLike[], now = new Date()): string {
  const t = now.getTime();
  const relevant = grants.filter((grant) => grant.workspaceId === workspaceId && !grant.revokedAt
    && (!grant.startsAt || grant.startsAt.getTime() <= t) && (!grant.expiresAt || grant.expiresAt.getTime() > t)
    && (!grant.agentId || grant.agentId === agentId)
    && (grant.maxUses === null || grant.usesCount < grant.maxUses));
  if (!relevant.length) {
    return "Read-only work runs freely. No standing delegation is configured for anything else, so Sentinel routes each consequential action to a human automatically and tells them exactly what authority is missing. Keep working on everything else in the meantime.";
  }
  const lines = relevant.slice(0, 12).map((grant) => {
    const ops = grant.operations.flatMap((op) => op === "routine" ? [...ROUTINE_OPERATIONS] : [op]);
    const scope = [grant.projectId && `project ${grant.projectId}`, grant.roomId && `room ${grant.roomId}`, grant.objectiveId && `objective ${grant.objectiveId}`].filter(Boolean).join(", ") || "whole workspace";
    const limits = [
      grant.capabilities.length && `capabilities ${grant.capabilities.join("/")}`,
      grant.runtimes.length && `runtimes ${grant.runtimes.join("/")}`,
      grant.maxUses !== null && `${Math.max(0, grant.maxUses - grant.usesCount)} uses left`,
      grant.budgetCents !== null && `${Math.max(0, grant.budgetCents - grant.spentCents)}¢ budget left`,
      grant.expiresAt && `until ${grant.expiresAt.toISOString().slice(0, 16)}Z`,
    ].filter(Boolean).join("; ");
    return `- ${[...new Set(ops)].join(", ")} — ${scope}${limits ? ` (${limits})` : ""}`;
  });
  return [
    "You hold this standing authority. Actions inside it run without asking anyone:",
    ...lines,
    "Anything outside it is routed to a human with the exact missing authority named. Continue unrelated authorized work while that is pending.",
  ].join("\n");
}
