/**
 * Context resolution for the MCP tools: precedence, isolation, and the
 * disambiguation path that was previously a dead end.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const deps = vi.hoisted(() => ({
  getReadableProjectIds: vi.fn(),
  getAccessibleWorkspaceIds: vi.fn(),
  resolveScope: vi.fn(),
  findProjects: vi.fn(),
  findWorkspaces: vi.fn(),
  findRun: vi.fn(),
}));

vi.mock("@/lib/knowledge/access", () => ({ getReadableProjectIds: deps.getReadableProjectIds }));
vi.mock("@/lib/agents/permissions", () => ({ getAccessibleWorkspaceIds: deps.getAccessibleWorkspaceIds }));
vi.mock("@/lib/orchestration/scope", () => ({ resolveScope: deps.resolveScope }));
vi.mock("@/lib/db", () => ({
  db: {
    project: { findMany: deps.findProjects },
    workspace: { findMany: deps.findWorkspaces },
    orchestrationRun: { findFirst: deps.findRun },
  },
}));

import { listPermittedContext, resolveMcpContext } from "@/lib/integrations/mcp-context";

const USER = "user-1";
const NONE = { projectId: null, projectName: null, workspaceId: null, workspaceName: null, resolution: "none" as const };

const PROJECT_A = { id: "p1", name: "Sentinel", workspaceId: "w1", workspace: { name: "Mission Control" } };
const PROJECT_B = { id: "p2", name: "Other", workspaceId: "w2", workspace: { name: "Personal" } };
const WS_A = { id: "w1", name: "Mission Control", slug: "default" };
const WS_B = { id: "w2", name: "Personal", slug: "personal" };

function permit(projects: typeof PROJECT_A[], workspaces: typeof WS_A[]) {
  deps.getReadableProjectIds.mockResolvedValue(projects.map((p) => p.id));
  deps.getAccessibleWorkspaceIds.mockResolvedValue(workspaces.map((w) => w.id));
  deps.findProjects.mockResolvedValue(projects);
  deps.findWorkspaces.mockResolvedValue(workspaces);
}

beforeEach(() => {
  Object.values(deps).forEach((fn) => fn.mockReset());
  deps.resolveScope.mockResolvedValue(NONE);
});

describe("permitted context listing", () => {
  it("lists only what the user may read", async () => {
    permit([PROJECT_A], [WS_A]);
    const context = await listPermittedContext(USER);
    expect(context.projects).toEqual([{ id: "p1", name: "Sentinel", workspaceId: "w1", workspaceName: "Mission Control" }]);
    expect(context.workspaces).toEqual([WS_A]);
  });

  it("returns nothing when the user may read nothing", async () => {
    permit([], []);
    const context = await listPermittedContext(USER);
    expect(context).toEqual({ projects: [], workspaces: [] });
  });
});

describe("explicit id resolution", () => {
  it("resolves a permitted projectId and carries its workspace", async () => {
    permit([PROJECT_A, PROJECT_B], [WS_A, WS_B]);
    const result = await resolveMcpContext(USER, { projectId: "p1" });
    expect(result.scope).toMatchObject({ projectId: "p1", projectName: "Sentinel", workspaceId: "w1", resolution: "explicit" });
    expect(result.choices).toBeUndefined();
  });

  it("resolves a permitted workspaceId", async () => {
    permit([], [WS_A, WS_B]);
    const result = await resolveMcpContext(USER, { workspaceId: "w2" });
    expect(result.scope).toMatchObject({ workspaceId: "w2", workspaceName: "Personal", projectId: null, resolution: "explicit" });
  });

  it("refuses a projectId outside the permitted set and leaks nothing about it", async () => {
    permit([PROJECT_A], [WS_A]);
    const result = await resolveMcpContext(USER, { projectId: "p-not-mine" });
    expect(result.scope.projectId).toBeNull();
    // Reported as "no permitted project has that id", never as "forbidden",
    // so it cannot be used to probe for projects the caller cannot see.
    expect(result.reason).toContain("No permitted project has that id");
    expect(JSON.stringify(result)).not.toContain("p-not-mine");
  });

  it("refuses a workspaceId outside the permitted set", async () => {
    permit([], [WS_A]);
    const result = await resolveMcpContext(USER, { workspaceId: "w-not-mine" });
    expect(result.scope.workspaceId).toBeNull();
    expect(result.choices?.workspaces).toEqual([WS_A]);
  });

  it("prefers an explicit id over natural-language inference", async () => {
    permit([PROJECT_A, PROJECT_B], [WS_A]);
    deps.resolveScope.mockResolvedValue({ ...NONE, projectId: "p2", projectName: "Other", resolution: "inferred" });
    const result = await resolveMcpContext(USER, { projectId: "p1", query: "something about Other" });
    expect(result.scope.projectId).toBe("p1");
    expect(deps.resolveScope).not.toHaveBeenCalled();
  });
});

describe("inference and single-candidate resolution", () => {
  it("uses the existing resolver when it succeeds", async () => {
    permit([PROJECT_A, PROJECT_B], [WS_A]);
    deps.resolveScope.mockResolvedValue({ ...NONE, projectId: "p2", projectName: "Other", resolution: "explicit" });
    const result = await resolveMcpContext(USER, { projectHint: "Other" });
    expect(result.scope.projectId).toBe("p2");
  });

  it("auto-selects when exactly one project is permitted", async () => {
    permit([PROJECT_A], [WS_A, WS_B]);
    const result = await resolveMcpContext(USER, { query: "anything" });
    expect(result.scope).toMatchObject({ projectId: "p1", resolution: "single" });
    expect(result.reason).toContain("Only one project is permitted");
  });

  it("auto-selects a lone workspace only when no projects are permitted", async () => {
    permit([], [WS_A]);
    const result = await resolveMcpContext(USER, { query: "anything" });
    expect(result.scope).toMatchObject({ workspaceId: "w1", projectId: null });
  });

  it("never auto-selects when several projects are permitted", async () => {
    permit([PROJECT_A, PROJECT_B], [WS_A, WS_B]);
    const result = await resolveMcpContext(USER, { query: "anything" });
    expect(result.scope.projectId).toBeNull();
    expect(result.scope.workspaceId).toBeNull();
    expect(result.choices?.projects).toHaveLength(2);
    expect(result.reason).toContain("explicit projectId or workspaceId");
  });

  it("never auto-selects when several workspaces are permitted and no project is", async () => {
    permit([], [WS_A, WS_B]);
    const result = await resolveMcpContext(USER, { query: "anything" });
    expect(result.scope.workspaceId).toBeNull();
    expect(result.choices?.workspaces).toHaveLength(2);
  });
});

describe("durable task context", () => {
  it("reuses context only from a task owned by this user and still permitted", async () => {
    permit([PROJECT_A], [WS_A]);
    deps.findRun.mockResolvedValue({ projectId: "p1", workspaceId: "w1" });
    const result = await resolveMcpContext(USER, { contextTaskId: "run-1" });
    expect(deps.findRun).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "run-1", userId: USER } }));
    expect(result.scope).toMatchObject({ projectId: "p1", workspaceId: "w1", resolution: "context" });
  });

  it("does not reuse a task context whose project is no longer permitted", async () => {
    permit([], [WS_A, WS_B]);
    deps.findRun.mockResolvedValue({ projectId: "removed-project", workspaceId: null });
    const result = await resolveMcpContext(USER, { contextTaskId: "run-1" });
    expect(result.scope.resolution).toBe("none");
    expect(JSON.stringify(result)).not.toContain("removed-project");
  });
});

describe("empty scope", () => {
  it("says so plainly when the user has no permitted context at all", async () => {
    permit([], []);
    const result = await resolveMcpContext(USER, { query: "anything" });
    expect(result.scope.resolution).toBe("none");
    expect(result.reason).toContain("no permitted projects or workspaces");
    expect(result.choices).toEqual({ projects: [], workspaces: [] });
  });
});
