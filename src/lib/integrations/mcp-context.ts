import { db } from "@/lib/db";
import { getReadableProjectIds } from "@/lib/knowledge/access";
import { getAccessibleWorkspaceIds } from "@/lib/agents/permissions";
import { resolveScope } from "@/lib/orchestration/scope";
import type { ResolvedScope } from "@/lib/orchestration/types";

/**
 * Context resolution for the MCP tools.
 *
 * resolveScope() infers a project or workspace from natural language and
 * deliberately fails closed when the answer is ambiguous. That is the right
 * behaviour, but on its own it leaves an MCP client stuck: the tool said "no
 * unambiguous context" and offered no way to disambiguate, because the schema
 * accepted only free-text hints and the response listed no alternatives.
 *
 * This adds the two missing halves, without loosening anything:
 *   - an explicit projectId/workspaceId path, validated against the caller's
 *     permitted set before it is used;
 *   - the permitted choices, so a model that cannot be guessed at can simply
 *     be told what it may pick from.
 *
 * Every candidate here comes from getReadableProjectIds/getAccessibleWorkspaceIds
 * for the authenticated user, so nothing outside their scope is ever named.
 */

export interface PermittedProject {
  id: string;
  name: string;
  workspaceId: string | null;
  workspaceName: string | null;
}

export interface PermittedWorkspace {
  id: string;
  name: string;
  slug: string;
}

export interface PermittedContext {
  projects: PermittedProject[];
  workspaces: PermittedWorkspace[];
}

/** Everything this user is allowed to see, and nothing else. */
export async function listPermittedContext(userId: string): Promise<PermittedContext> {
  const [projectIds, workspaceIds] = await Promise.all([
    getReadableProjectIds(userId),
    getAccessibleWorkspaceIds(userId),
  ]);

  const [projects, workspaces] = await Promise.all([
    projectIds.length
      ? db.project.findMany({
          where: { id: { in: projectIds } },
          select: { id: true, name: true, workspaceId: true, workspace: { select: { name: true } } },
          orderBy: { name: "asc" },
        })
      : [],
    workspaceIds.length
      ? db.workspace.findMany({
          where: { id: { in: workspaceIds } },
          select: { id: true, name: true, slug: true },
          orderBy: { name: "asc" },
        })
      : [],
  ]);

  return {
    projects: projects.map((project) => ({
      id: project.id,
      name: project.name,
      workspaceId: project.workspaceId,
      workspaceName: project.workspace?.name ?? null,
    })),
    workspaces,
  };
}

export interface ContextRequest {
  query?: string;
  projectHint?: string;
  workspaceHint?: string;
  /** Exact id, as returned by sentinel.project_context. */
  projectId?: string;
  /** Exact id, as returned by sentinel.project_context. */
  workspaceId?: string;
  /** Durable task whose already-resolved context should be reused. */
  contextTaskId?: string;
}

export interface ContextResolution {
  scope: ResolvedScope;
  /** Present only when the scope could not be pinned down. */
  choices?: PermittedContext;
  /** Why the caller got what it got, in words a model can act on. */
  reason: string;
}

/**
 * Resolution order, matching the agreed precedence:
 *   1. an explicit id, checked against the permitted set;
 *   2. natural-language inference via the existing resolveScope();
 *   3. exactly one permitted project, or exactly one permitted workspace;
 *   4. otherwise: no scope, plus the permitted choices to pick from.
 *
 * An id that is not in the permitted set is reported as not found rather than
 * as forbidden, so this cannot be used to probe for the existence of projects
 * the caller may not see.
 */
export async function resolveMcpContext(userId: string, request: ContextRequest): Promise<ContextResolution> {
  const permitted = await listPermittedContext(userId);

  if (request.projectId) {
    const project = permitted.projects.find((candidate) => candidate.id === request.projectId);
    if (!project) {
      return {
        scope: { projectId: null, projectName: null, workspaceId: null, workspaceName: null, resolution: "none" },
        choices: permitted,
        reason: "No permitted project has that id. Choose one of the listed projects.",
      };
    }
    return {
      scope: {
        projectId: project.id,
        projectName: project.name,
        workspaceId: project.workspaceId,
        workspaceName: project.workspaceName,
        resolution: "explicit",
      },
      reason: `Resolved project "${project.name}" from the supplied id.`,
    };
  }

  if (request.workspaceId) {
    const workspace = permitted.workspaces.find((candidate) => candidate.id === request.workspaceId);
    if (!workspace) {
      return {
        scope: { projectId: null, projectName: null, workspaceId: null, workspaceName: null, resolution: "none" },
        choices: permitted,
        reason: "No permitted workspace has that id. Choose one of the listed workspaces.",
      };
    }
    return {
      scope: {
        projectId: null,
        projectName: null,
        workspaceId: workspace.id,
        workspaceName: workspace.name,
        resolution: "explicit",
      },
      reason: `Resolved workspace "${workspace.name}" from the supplied id.`,
    };
  }

  if (request.contextTaskId) {
    const run = await db.orchestrationRun.findFirst({
      where: { id: request.contextTaskId, userId },
      select: { projectId: true, workspaceId: true },
    });
    const project = run?.projectId ? permitted.projects.find((candidate) => candidate.id === run.projectId) : null;
    if (project) {
      return {
        scope: {
          projectId: project.id, projectName: project.name, workspaceId: project.workspaceId,
          workspaceName: project.workspaceName, resolution: "context",
        },
        reason: `Reused the permitted project context from task ${request.contextTaskId}.`,
      };
    }
    const workspace = run?.workspaceId ? permitted.workspaces.find((candidate) => candidate.id === run.workspaceId) : null;
    if (workspace) {
      return {
        scope: {
          projectId: null, projectName: null, workspaceId: workspace.id,
          workspaceName: workspace.name, resolution: "context",
        },
        reason: `Reused the permitted workspace context from task ${request.contextTaskId}.`,
      };
    }
    return {
      scope: { projectId: null, projectName: null, workspaceId: null, workspaceName: null, resolution: "none" },
      choices: permitted,
      reason: "No owned task with a still-permitted context has that id. Choose one of the listed contexts.",
    };
  }

  // Unchanged behaviour for the natural-language path.
  const inferred = await resolveScope(userId, {
    task: request.query ?? "",
    projectHint: request.projectHint,
    workspaceHint: request.workspaceHint,
  });
  if (inferred.resolution !== "none") {
    return { scope: inferred, reason: `Resolved from ${inferred.resolution === "explicit" ? "the supplied hint" : "the query text"}.` };
  }

  // A single permitted candidate is not a guess, so it may resolve on its own.
  if (permitted.projects.length === 1) {
    const project = permitted.projects[0];
    return {
      scope: {
        projectId: project.id,
        projectName: project.name,
        workspaceId: project.workspaceId,
        workspaceName: project.workspaceName,
        resolution: "single",
      },
      reason: `Only one project is permitted for this user, so "${project.name}" was selected.`,
    };
  }
  if (permitted.projects.length === 0 && permitted.workspaces.length === 1) {
    const workspace = permitted.workspaces[0];
    return {
      scope: {
        projectId: null,
        projectName: null,
        workspaceId: workspace.id,
        workspaceName: workspace.name,
        resolution: "single",
      },
      reason: `No projects are permitted; only one workspace is, so "${workspace.name}" was selected.`,
    };
  }

  // Ambiguous, or genuinely empty. Either way, say which it is and offer the
  // options rather than returning an opaque failure.
  return {
    scope: { projectId: null, projectName: null, workspaceId: null, workspaceName: null, resolution: "none" },
    choices: permitted,
    reason:
      permitted.projects.length === 0 && permitted.workspaces.length === 0
        ? "This Sentinel user has no permitted projects or workspaces."
        : "More than one permitted context matches. Call this tool again with an explicit projectId or workspaceId from the listed choices.",
  };
}
