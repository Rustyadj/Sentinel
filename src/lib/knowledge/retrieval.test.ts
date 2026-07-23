import { describe, expect, it } from "vitest";
import { buildRetrievalFilters } from "./retrieval";

describe("project memory isolation", () => {
  it("never includes unrelated or unscoped rows for an isolated project", () => {
    const filters = buildRetrievalFilters({ userId: "user-a", projectId: "project-a" });
    expect(filters.memory).toEqual({
      owner: "user-a", archived: false, scope: "project", projectId: "project-a",
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
    expect(filters.memory).toMatchObject({ owner: "user-a", projectId: null });
  });
});
