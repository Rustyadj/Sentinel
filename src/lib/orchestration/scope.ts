import { db } from "@/lib/db";
import { getReadableProjectIds } from "@/lib/knowledge/access";
import { getAccessibleWorkspaceIds } from "@/lib/agents/permissions";
import type { ResolvedScope, RouteTaskInput } from "./types";

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

function mentions(text: string, candidate: string | null | undefined): boolean {
  return Boolean(candidate && text.toLowerCase().includes(candidate.toLowerCase()));
}

/** Resolve a scope only from user-readable records. Ambiguity intentionally
 * resolves to no scope rather than guessing across project boundaries. */
export async function resolveScope(userId: string, input: RouteTaskInput): Promise<ResolvedScope> {
  const [projectIds, workspaceIds] = await Promise.all([getReadableProjectIds(userId), getAccessibleWorkspaceIds(userId)]);
  const [projects, workspaces] = await Promise.all([
    projectIds.length ? db.project.findMany({ where: { id: { in: projectIds } }, select: { id: true, name: true, workspaceId: true, workspace: { select: { name: true } } } }) : [],
    workspaceIds.length ? db.workspace.findMany({ where: { id: { in: workspaceIds } }, select: { id: true, name: true, slug: true } }) : [],
  ]);
  const haystack = `${input.task} ${input.projectHint ?? ""} ${input.workspaceHint ?? ""}`;
  const requestedProject = input.projectHint ? normalize(input.projectHint) : null;
  const projectMatches = projects.filter((project) =>
    requestedProject ? normalize(project.name) === requestedProject : mentions(haystack, project.name),
  );
  if (projectMatches.length === 1) {
    const project = projectMatches[0];
    return {
      projectId: project.id,
      projectName: project.name,
      workspaceId: project.workspaceId,
      workspaceName: project.workspace?.name ?? null,
      resolution: input.projectHint ? "explicit" : "inferred",
    };
  }
  const requestedWorkspace = input.workspaceHint ? normalize(input.workspaceHint) : null;
  const workspaceMatches = workspaces.filter((workspace) =>
    requestedWorkspace
      ? normalize(workspace.name) === requestedWorkspace || normalize(workspace.slug) === requestedWorkspace
      : mentions(haystack, workspace.name) || mentions(haystack, workspace.slug),
  );
  if (workspaceMatches.length === 1) {
    const workspace = workspaceMatches[0];
    return { workspaceId: workspace.id, workspaceName: workspace.name, projectId: null, projectName: null, resolution: input.workspaceHint ? "explicit" : "inferred" };
  }
  return { workspaceId: null, workspaceName: null, projectId: null, projectName: null, resolution: "none" };
}
