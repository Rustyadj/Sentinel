import { db } from "@/lib/db";
import { userHasWorkspacePermission } from "@/lib/workspaces/authorization";
import { getAccessibleWorkspaceIds } from "@/lib/agents/permissions";

export class LearningAccessError extends Error {
  readonly status = 404;

  constructor() {
    super("Learning resource not found");
  }
}

export function learningAccessErrorResponse(error: unknown): Response {
  if (error instanceof LearningAccessError) {
    return Response.json({ error: error.message }, { status: error.status });
  }
  const message = error instanceof Error ? error.message : "Internal error";
  return Response.json({ error: message }, { status: 500 });
}

export async function requireLearningWorkspaceAccess(
  userId: string,
  workspaceId: string,
  permission: string,
): Promise<void> {
  if (!(await userHasWorkspacePermission(userId, workspaceId, permission))) {
    throw new LearningAccessError();
  }
}

export async function requireLearningProjectAccess(
  userId: string,
  projectId: string,
  permission: string,
): Promise<void> {
  const project = await db.project.findUnique({
    where: { id: projectId },
    select: { userId: true, workspaceId: true },
  });
  if (!project) throw new LearningAccessError();
  if (project.userId === userId) return;
  if (
    !project.workspaceId ||
    !(await userHasWorkspacePermission(userId, project.workspaceId, permission))
  ) {
    throw new LearningAccessError();
  }
}

export async function requireLearningAgentAccess(
  userId: string,
  agentId: string,
  permission: string,
): Promise<void> {
  const agent = await db.agent.findUnique({
    where: { id: agentId },
    select: { workspaceId: true },
  });
  if (!agent?.workspaceId) throw new LearningAccessError();
  await requireLearningWorkspaceAccess(userId, agent.workspaceId, permission);
}

export async function requireLearningCandidateAccess(
  userId: string,
  candidateId: string,
  permission: string,
): Promise<void> {
  const candidate = await db.learningCandidate.findUnique({
    where: { id: candidateId },
    include: {
      approvalRequest: { select: { workspaceId: true, projectId: true } },
      experience: { select: { workspaceId: true, projectId: true, agentId: true } },
      knowledgeGap: { select: { workspaceId: true, projectId: true, agentId: true } },
    },
  });
  if (!candidate) throw new LearningAccessError();
  const payload = candidate.proposedPayload as Record<string, unknown>;
  const workspaceId =
    candidate.approvalRequest?.workspaceId ??
    candidate.experience?.workspaceId ??
    candidate.knowledgeGap?.workspaceId ??
    stringValue(payload.workspaceId);
  if (workspaceId) {
    await requireLearningWorkspaceAccess(userId, workspaceId, permission);
    return;
  }
  const projectId =
    candidate.approvalRequest?.projectId ??
    candidate.experience?.projectId ??
    candidate.knowledgeGap?.projectId ??
    stringValue(payload.projectId);
  if (projectId) {
    await requireLearningProjectAccess(userId, projectId, permission);
    return;
  }
  const agentId =
    candidate.experience?.agentId ??
    candidate.knowledgeGap?.agentId ??
    stringValue(payload.agentId);
  if (agentId) {
    await requireLearningAgentAccess(userId, agentId, permission);
    return;
  }
  throw new LearningAccessError();
}

export async function requireBenchmarkAccess(
  userId: string,
  benchmarkId: string,
  permission: string,
): Promise<void> {
  const benchmark = await db.benchmarkDefinition.findUnique({
    where: { id: benchmarkId },
    select: { workspaceId: true },
  });
  if (!benchmark?.workspaceId) throw new LearningAccessError();
  await requireLearningWorkspaceAccess(userId, benchmark.workspaceId, permission);
}

export async function requireFeatureFlagAccess(
  userId: string,
  flag: { scopeType: string; scopeId: string | null },
  permission: string,
): Promise<void> {
  const scopeId = flag.scopeId;
  switch (flag.scopeType) {
    case "workspace":
      if (!scopeId) break;
      await requireLearningWorkspaceAccess(userId, scopeId, permission);
      return;
    case "project":
      if (!scopeId) break;
      await requireLearningProjectAccess(userId, scopeId, permission);
      return;
    case "agent":
      if (!scopeId) break;
      await requireLearningAgentAccess(userId, scopeId, permission);
      return;
    case "user":
      if (scopeId === userId) return;
      break;
    default:
      // There is no system-admin or organization-admin authorization model in
      // this repository. Global/organization mutations therefore fail closed.
      break;
  }
  throw new LearningAccessError();
}

export async function requireReflectionAccess(
  userId: string,
  reflectionId: string,
  permission: string,
): Promise<void> {
  const reflection = await db.reflection.findUnique({
    where: { id: reflectionId },
    select: { workspaceId: true, projectId: true, agentId: true },
  });
  if (!reflection) throw new LearningAccessError();
  if (reflection.workspaceId) {
    await requireLearningWorkspaceAccess(userId, reflection.workspaceId, permission);
    return;
  }
  if (reflection.projectId) {
    await requireLearningProjectAccess(userId, reflection.projectId, permission);
    return;
  }
  await requireLearningAgentAccess(userId, reflection.agentId, permission);
}

export async function requireExperienceAccess(
  userId: string,
  experienceId: string,
  permission: string,
): Promise<void> {
  const experience = await db.experience.findUnique({
    where: { id: experienceId },
    select: { workspaceId: true, projectId: true, agentId: true },
  });
  if (!experience) throw new LearningAccessError();
  if (experience.workspaceId) {
    await requireLearningWorkspaceAccess(userId, experience.workspaceId, permission);
    return;
  }
  if (experience.projectId) {
    await requireLearningProjectAccess(userId, experience.projectId, permission);
    return;
  }
  await requireLearningAgentAccess(userId, experience.agentId, permission);
}

export async function requireSkillAccess(
  userId: string,
  skillId: string,
  permission: string,
): Promise<void> {
  const skill = await db.skill.findUnique({ where: { id: skillId }, select: { workspaceId: true } });
  if (!skill) throw new LearningAccessError();
  // A skill with no resolvable workspace (pre-existing legacy row — see
  // Skill.workspaceId's schema comment) is invisible to every tenant user
  // rather than falling back to a global read.
  if (!skill.workspaceId) throw new LearningAccessError();
  await requireLearningWorkspaceAccess(userId, skill.workspaceId, permission);
}

export async function requireSkillVersionAccess(
  userId: string,
  skillVersionId: string,
  permission: string,
): Promise<void> {
  const version = await db.skillVersion.findUnique({
    where: { id: skillVersionId },
    select: { skillId: true },
  });
  if (!version) throw new LearningAccessError();
  await requireSkillAccess(userId, version.skillId, permission);
}

export async function requireLearningGoalAccess(
  userId: string,
  learningGoalId: string,
  permission: string,
): Promise<void> {
  const goal = await db.learningGoal.findUnique({
    where: { id: learningGoalId },
    select: { workspaceId: true, agentId: true },
  });
  if (!goal) throw new LearningAccessError();
  if (goal.workspaceId) {
    await requireLearningWorkspaceAccess(userId, goal.workspaceId, permission);
    return;
  }
  if (goal.agentId) {
    await requireLearningAgentAccess(userId, goal.agentId, permission);
    return;
  }
  throw new LearningAccessError();
}

export async function requireCuriosityEventAccess(
  userId: string,
  curiosityEventId: string,
  permission: string,
): Promise<void> {
  const event = await db.curiosityEvent.findUnique({
    where: { id: curiosityEventId },
    select: { workspaceId: true, projectId: true, agentId: true },
  });
  if (!event) throw new LearningAccessError();
  if (event.workspaceId) {
    await requireLearningWorkspaceAccess(userId, event.workspaceId, permission);
    return;
  }
  if (event.projectId) {
    await requireLearningProjectAccess(userId, event.projectId, permission);
    return;
  }
  await requireLearningAgentAccess(userId, event.agentId, permission);
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

// --- Scope-based read filtering, for LIST routes ---
//
// The functions above answer "can this user touch this ONE resource" (used
// by GET-by-id and mutation routes). LIST routes need a different shape: one
// upfront query for everything the user can see, then a where-clause filter
// applied to the list query itself — never fetch-then-filter-in-memory,
// since that still runs the unscoped query against every tenant's rows.

export interface AccessibleLearningScope {
  userId: string;
  workspaceIds: string[];
  projectIds: string[];
  agentIds: string[];
}

/**
 * Computes everything a user can see in one pass: accessible workspaces,
 * projects owned by them or in an accessible workspace, and agents that
 * belong to an accessible workspace. Every Learning Core LIST route should
 * scope through this rather than duplicating the accessible-workspace /
 * accessible-project / accessible-agent queries inline.
 */
export async function getAccessibleLearningScope(userId: string): Promise<AccessibleLearningScope> {
  const workspaceIds = await getAccessibleWorkspaceIds(userId);
  const [projects, agents] = await Promise.all([
    db.project.findMany({
      where: { OR: [{ userId }, { workspaceId: { in: workspaceIds } }] },
      select: { id: true },
    }),
    db.agent.findMany({ where: { workspaceId: { in: workspaceIds } }, select: { id: true } }),
  ]);
  return {
    userId,
    workspaceIds,
    projectIds: projects.map((p) => p.id),
    agentIds: agents.map((a) => a.id),
  };
}

/**
 * Builds an OR-clause fragment scoping a query to the accessible scope,
 * for models with one or more of userId/workspaceId/projectId/agentId as a
 * DIRECT column (not through a relation — use the resource-specific
 * require*Access functions above for relation-based ownership, e.g.
 * LearningCandidate → experience → workspaceId).
 *
 * `fields` declares which of the model's own columns to filter on — pass
 * only fields that actually exist on the target model. If none of the
 * declared fields have any accessible values (e.g. a brand-new user with no
 * workspaces), this fails closed to a where-clause that matches nothing,
 * never to an unscoped/global read.
 */
export function buildLearningScopeWhere(
  scope: AccessibleLearningScope,
  fields: { userId?: boolean; workspaceId?: boolean; projectId?: boolean; agentId?: boolean },
): Record<string, unknown> {
  const clauses: Record<string, unknown>[] = [];
  if (fields.userId) clauses.push({ userId: scope.userId });
  if (fields.workspaceId && scope.workspaceIds.length > 0) clauses.push({ workspaceId: { in: scope.workspaceIds } });
  if (fields.projectId && scope.projectIds.length > 0) clauses.push({ projectId: { in: scope.projectIds } });
  if (fields.agentId && scope.agentIds.length > 0) clauses.push({ agentId: { in: scope.agentIds } });
  if (clauses.length === 0) return { id: "__no_accessible_learning_scope__" };
  return { OR: clauses };
}

// --- Generic single-resource dispatchers ---
//
// Thin wrappers over the resource-specific functions above, for callers that
// want one call site rather than picking the right require*Access function
// by hand. Prefer the specific function directly when the resource type is
// already known at the call site; use these when routing a resource type
// that varies (e.g. a shared helper called from multiple route handlers).

export type LearningResourceRef =
  | { type: "workspace"; id: string }
  | { type: "project"; id: string }
  | { type: "agent"; id: string }
  | { type: "candidate"; id: string }
  | { type: "benchmark"; id: string }
  | { type: "reflection"; id: string }
  | { type: "featureFlag"; scopeType: string; scopeId: string | null };

async function dispatchLearningAccess(
  userId: string,
  resource: LearningResourceRef,
  permission: string,
): Promise<void> {
  switch (resource.type) {
    case "workspace":
      return requireLearningWorkspaceAccess(userId, resource.id, permission);
    case "project":
      return requireLearningProjectAccess(userId, resource.id, permission);
    case "agent":
      return requireLearningAgentAccess(userId, resource.id, permission);
    case "candidate":
      return requireLearningCandidateAccess(userId, resource.id, permission);
    case "benchmark":
      return requireBenchmarkAccess(userId, resource.id, permission);
    case "reflection":
      return requireReflectionAccess(userId, resource.id, permission);
    case "featureFlag":
      return requireFeatureFlagAccess(userId, resource, permission);
  }
}

export function assertCanReadLearningResource(userId: string, resource: LearningResourceRef): Promise<void> {
  return dispatchLearningAccess(userId, resource, "workspace.read");
}

export function assertCanMutateLearningResource(userId: string, resource: LearningResourceRef): Promise<void> {
  return dispatchLearningAccess(userId, resource, "workspace.update");
}
