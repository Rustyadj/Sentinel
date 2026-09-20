import { describe, expect, it } from "vitest";
import { buildRetrievalFilters } from "./retrieval";

describe("project memory isolation", () => {
  it("never includes unrelated or unscoped rows for an isolated project", () => {
    const filters = buildRetrievalFilters({ userId: "user-a", projectId: "project-a" });
    expect(filters.memory).toEqual({
      owner: "user-a", archived: false, scope: "project", projectId: "project-a",
      state: { notIn: ["quarantined", "forgotten"] },
      // Continual memory adds two exclusions at this same choke point:
      // shadow-generated abstractions never reach production retrieval, and a
      // superseded version never appears beside the belief that replaced it.
      shadowOnly: false,
      validTo: null,
    });
    expect(filters.note).toEqual({ projectId: "project-a" });
    expect(filters.decision).toEqual({
      projectId: "project-a", status: { in: ["approved", "proposed"] },
    });
    expect(JSON.stringify(filters)).not.toContain('"projectId":null');
  });

  it("only includes the authenticated user's unscoped context outside projects", () => {
    const filters = buildRetrievalFilters({ userId: "user-a" });
    expect(filters.note).toEqual({ projectId: null, userId: "user-a" });
    expect(filters.decision).toMatchObject({ projectId: null, userId: "user-a" });
    // Since Memory gained a real workspaceId, the memory clause is a union of
    // branches rather than one flat object: owner-isolated scopes, plus a
    // workspace branch that is membership-isolated instead. Asserting the
    // union's shape would pin the implementation; what matters is that every
    // branch is bounded by something.
    expect(filters.memory).toMatchObject({ archived: false });
    expect(filters.memory.OR).toEqual([
      { owner: "user-a", scope: { in: ["organization", "user", "global"] }, projectId: null },
    ]);
  });

  it("returns no workspace memory at all when no access has been resolved", () => {
    // The `access` argument is optional so that callers which only need a
    // where-clause keep working. Omitting it must mean "no workspace access",
    // never "all workspaces" — a caller that forgets to resolve access has to
    // get less, not more.
    for (const filters of [
      buildRetrievalFilters({ userId: "user-a" }),
      buildRetrievalFilters({ userId: "user-a", projectId: "project-a", scopePolicy: "user-context" }),
    ]) {
      expect(JSON.stringify(filters.memory)).not.toContain('"workspace"');
    }
  });

  it("scopes workspace memory to the resolved workspaces, and does not restrict it by owner", () => {
    const filters = buildRetrievalFilters(
      { userId: "user-a", projectId: "project-a", scopePolicy: "user-context" },
      { workspaceIds: ["ws-a"], deniedRequestedWorkspace: false },
    );
    const workspaceBranch = (filters.memory.OR ?? []).find(
      (branch) => (branch as { scope?: unknown }).scope === "workspace",
    );
    // Membership, not ownership: a colleague's workspace memory is the whole
    // point of the scope existing.
    expect(workspaceBranch).toEqual({ scope: "workspace", workspaceId: { in: ["ws-a"] } });
    expect(workspaceBranch).not.toHaveProperty("owner");
  });

  it("matches nothing when the caller named a workspace they may not read", () => {
    const filters = buildRetrievalFilters(
      { userId: "user-a", workspaceId: "ws-b" },
      { workspaceIds: [], deniedRequestedWorkspace: true },
    );
    expect(JSON.stringify(filters.memory)).not.toContain('"workspace"');
  });
});
