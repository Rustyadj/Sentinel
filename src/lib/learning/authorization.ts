import { db } from "@/lib/db";
import { userHasWorkspacePermission } from "@/lib/workspaces/authorization";

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

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
