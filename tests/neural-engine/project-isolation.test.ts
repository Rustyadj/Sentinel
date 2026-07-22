import { afterAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { retrieveContext } from "@/lib/knowledge/retrieval";
import { makeProject, makeUser } from "./db-setup";

afterAll(async () => {
  await db.$disconnect();
});

describe("project isolation (existing src/lib/knowledge/retrieval.ts, verified under Phase A)", () => {
  it("never returns another project's project-scoped memories, notes, or decisions", async () => {
    const user = await makeUser();
    const projectA = await makeProject(user.id, "Project A");
    const projectB = await makeProject(user.id, "Project B");

    await db.memory.create({
      data: {
        type: "fact",
        scope: "project",
        owner: user.id,
        content: "Project A secret",
        source: "test",
        projectId: projectA.id,
      },
    });
    await db.memory.create({
      data: {
        type: "fact",
        scope: "project",
        owner: user.id,
        content: "Project B secret",
        source: "test",
        projectId: projectB.id,
      },
    });
    await db.obsidianNote.create({
      data: { title: "A note", content: "A content", projectId: projectA.id },
    });
    await db.obsidianNote.create({
      data: { title: "B note", content: "B content", projectId: projectB.id },
    });
    await db.decision.create({
      data: {
        title: "A decision",
        summary: "A summary",
        status: "approved",
        createdBy: user.id,
        projectId: projectA.id,
      },
    });
    await db.decision.create({
      data: {
        title: "B decision",
        summary: "B summary",
        status: "approved",
        createdBy: user.id,
        projectId: projectB.id,
      },
    });

    const resultForA = await retrieveContext({ projectId: projectA.id, maxItems: 100 });

    expect(resultForA.memories.some((m) => m.content === "Project A secret")).toBe(true);
    expect(resultForA.memories.some((m) => m.content === "Project B secret")).toBe(false);

    expect(resultForA.notes.some((n) => n.title === "A note")).toBe(true);
    expect(resultForA.notes.some((n) => n.title === "B note")).toBe(false);

    expect(resultForA.decisions.some((d) => d.title === "A decision")).toBe(true);
    expect(resultForA.decisions.some((d) => d.title === "B decision")).toBe(false);
  });
});
