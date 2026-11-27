import { db } from "@/lib/db";
import { RETIRED_AGENT_IDS } from "@/lib/agents/active";
import { canEditConfig, getWorkspaceControlPlaneUser } from "@/lib/agents/permissions";
import { getAccessibleLearningScope } from "@/lib/learning/authorization";
import { requireWorkspacePermission, userHasWorkspacePermission } from "@/lib/workspaces/authorization";
import { summarizeRecordedSteps } from "./analytics";
import { canManageDepartments, getVisibleWorkforceOrganization } from "./organization";
import { planningAvailable } from "./planning";

export async function getWorkforceSnapshot(workspaceId: string) {
  const user = await requireWorkspacePermission(workspaceId, "workspace.read");
  const [workspace, canReadTasks, canUpdateTasks, canReadAgents, canReadTeams, canCreateTeams, canUpdateTeams, canUpdateWorkspace, canExecute, controlUser, learningScope] = await Promise.all([
    db.workspace.findUniqueOrThrow({
      where: { id: workspaceId },
      select: { id: true, name: true, organization: { select: { id: true, name: true, ownerId: true } } },
    }),
    userHasWorkspacePermission(user.id, workspaceId, "task.read"),
    userHasWorkspacePermission(user.id, workspaceId, "task.update"),
    userHasWorkspacePermission(user.id, workspaceId, "agents.runtime.view"),
    userHasWorkspacePermission(user.id, workspaceId, "team.read"),
    userHasWorkspacePermission(user.id, workspaceId, "team.create"),
    userHasWorkspacePermission(user.id, workspaceId, "team.update"),
    userHasWorkspacePermission(user.id, workspaceId, "workspace.update"),
    userHasWorkspacePermission(user.id, workspaceId, "agents.runtime.execute"),
    getWorkspaceControlPlaneUser(workspaceId),
    getAccessibleLearningScope(user.id),
  ]);
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const org = await getVisibleWorkforceOrganization(user.id, workspace.organization);
  const [agents, runtimes, departments, teams, objectives, events, tasks, runs, steps, skills, connections, manageDepartments] = await Promise.all([
    canReadAgents ? db.agent.findMany({
      where: { workspaceId, id: { notIn: [...RETIRED_AGENT_IDS] } },
      select: { id: true, name: true, role: true, model: true, status: true, description: true, skills: true, memoryScope: true },
      orderBy: { name: "asc" },
    }) : [],
    canReadAgents ? db.agentRuntime.findMany({
      where: { workspaceId, enabled: true },
      select: { agentId: true, kind: true, executionVerified: true },
    }) : [],
    org ? db.department.findMany({
      where: { organizationId: org.id },
      select: { id: true, name: true, description: true, parentDepartmentId: true, updatedAt: true },
      orderBy: { name: "asc" },
    }) : [],
    canReadTeams ? db.team.findMany({
      where: { workspaceId },
      select: { id: true, name: true, memberAgentIds: true, description: true },
      orderBy: { name: "asc" },
    }) : [],
    canReadTasks ? db.objective.findMany({
      where: { workspaceId },
      select: {
        id: true, title: true, status: true,
        steps: {
          orderBy: { position: "asc" },
          select: { key: true, title: true, status: true, unblockRequest: true },
        },
      },
      orderBy: { updatedAt: "desc" }, take: 30,
    }) : [],
    canReadTasks ? db.objectiveEvent.findMany({
      where: { objective: { workspaceId } },
      select: { id: true, type: true, message: true, createdAt: true, objective: { select: { title: true } } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 20,
    }) : [],
    canReadTasks ? db.task.findMany({
      where: { workspaceId, projectId: null },
      select: { id: true, title: true, status: true, dueDate: true },
      orderBy: { updatedAt: "desc" }, take: 20,
    }) : [],
    canReadTasks ? db.orchestrationRun.groupBy({
      by: ["status"], where: { workspaceId, projectId: null, createdAt: { gte: since } }, _count: { _all: true },
    }) : [],
    canReadTasks ? db.objectiveStep.findMany({
      where: { objective: { workspaceId }, updatedAt: { gte: since } },
      select: { status: true, attempts: true, actualCostCents: true, estimatedCostCents: true, startedAt: true, completedAt: true },
    }) : [],
    learningScope.workspaceIds.includes(workspaceId) ? db.skill.findMany({
      where: { workspaceId },
      select: { id: true, name: true, description: true, domain: true, status: true, version: true, owner: true, requiredTools: true, _count: { select: { versions: true } } },
      orderBy: { name: "asc" },
    }) : [],
    canReadAgents ? db.mcpServerRegistration.findMany({
      where: { workspaceId },
      select: { id: true, name: true, status: true, authMode: true, enabled: true, capabilityTags: true, lastDiscoveredAt: true },
      orderBy: { name: "asc" },
    }) : [],
    org ? canManageDepartments(user.id, workspaceId, org.id, org.ownerId) : false,
  ]);

  return {
    workspace: { id: workspace.id, name: workspace.name, organization: org?.name ?? null },
    access: { canReadTasks, canReadAgents, canReadTeams, canCreateTeams, canUpdateTeams, manageDepartments, canUpdateWorkspace, canExecute, controlObjectives: canReadTasks && canUpdateTasks, plan: !!controlUser && canEditConfig(controlUser.role) },
    planningAvailable: planningAvailable(),
    mediaAvailable: Boolean(process.env.OPENAI_API_KEY?.trim()),
    agents, runtimes, departments, teams, objectives, events, tasks, runs, connections, skills,
    analytics: canReadTasks ? summarizeRecordedSteps(steps) : null,
  };
}

type JsonValue<T> = T extends Date ? string
  : T extends readonly (infer E)[] ? JsonValue<E>[]
  : T extends object ? { [P in keyof T]: JsonValue<T[P]> }
  : T;

export type WorkforceSnapshot = JsonValue<Awaited<ReturnType<typeof getWorkforceSnapshot>>>;
