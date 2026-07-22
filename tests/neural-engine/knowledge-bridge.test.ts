import { afterAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import {
  getOrCreateKnowledgeObjectForSource,
  retrieveContextWithProvenance,
} from "@/lib/neural-engine/knowledge-bridge";
import { makeProject, makeUser } from "./db-setup";

afterAll(async () => {
  await db.$disconnect();
});

describe("knowledge-bridge — getOrCreateKnowledgeObjectForSource", () => {
  it("is idempotent — a second call for the same source returns the same id, never duplicates", async () => {
    const params = {
      type: "Memory" as const,
      title: "Bridge test memory",
      sourceType: "memory",
      sourceId: `mem-${Date.now()}`,
      scope: "project" as const,
    };
    const first = await getOrCreateKnowledgeObjectForSource(params);
    const second = await getOrCreateKnowledgeObjectForSource(params);
    expect(second).toBe(first);

    const count = await db.knowledgeObject.count({
      where: { sourceType: params.sourceType, sourceId: params.sourceId },
    });
    expect(count).toBe(1);
  });

  it("creates distinct KnowledgeObjects for distinct sources", async () => {
    const a = await getOrCreateKnowledgeObjectForSource({
      type: "Note",
      title: "Note A",
      sourceType: "obsidian_note",
      sourceId: `note-a-${Date.now()}`,
      scope: "global",
    });
    const b = await getOrCreateKnowledgeObjectForSource({
      type: "Note",
      title: "Note B",
      sourceType: "obsidian_note",
      sourceId: `note-b-${Date.now()}`,
      scope: "global",
    });
    expect(a).not.toBe(b);
  });
});

describe("knowledge-bridge — retrieveContextWithProvenance", () => {
  it("returns a knowledgeObjectIds entry for every retrieved memory/note/decision, and preserves project isolation", async () => {
    const user = await makeUser();
    const project = await makeProject(user.id, "Bridge Project");

    await db.memory.create({
      data: {
        type: "fact",
        scope: "project",
        owner: user.id,
        content: "Bridged memory content",
        source: "test",
        projectId: project.id,
      },
    });
    await db.obsidianNote.create({
      data: { title: "Bridged note", content: "note body", projectId: project.id },
    });
    await db.decision.create({
      data: {
        title: "Bridged decision",
        summary: "summary",
        status: "approved",
        createdBy: user.id,
        projectId: project.id,
      },
    });

    const result = await retrieveContextWithProvenance({ userId: user.id, projectId: project.id, maxItems: 100 });

    expect(result.totalItems).toBeGreaterThan(0);
    expect(result.knowledgeObjectIds.length).toBe(
      result.memories.length + result.notes.length + result.decisions.length,
    );

    // Every bridged id must resolve to a real KnowledgeObject row.
    const bridged = await db.knowledgeObject.findMany({
      where: { id: { in: result.knowledgeObjectIds } },
    });
    expect(bridged.length).toBe(result.knowledgeObjectIds.length);
  });

  it("calling it twice for the same content does not create duplicate KnowledgeObject rows", async () => {
    const user = await makeUser();
    const project = await makeProject(user.id, "Bridge Project Repeat");
    await db.memory.create({
      data: {
        type: "fact",
        scope: "project",
        owner: user.id,
        content: "Repeat-bridge memory",
        source: "test",
        projectId: project.id,
      },
    });

    const first = await retrieveContextWithProvenance({ userId: user.id, projectId: project.id, maxItems: 10 });
    const second = await retrieveContextWithProvenance({ userId: user.id, projectId: project.id, maxItems: 10 });

    expect(second.knowledgeObjectIds.sort()).toEqual(first.knowledgeObjectIds.sort());
  });
});
