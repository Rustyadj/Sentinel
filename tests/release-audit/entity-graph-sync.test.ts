import { afterAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { syncTaskToGraph, syncWorkflowToGraph, removeEntityFromGraph } from "@/lib/knowledge/entity-sync";
import { buildGraphData } from "@/lib/knowledge/graph";
import { makeUser, makeProject, uid } from "../neural-engine/db-setup";

afterAll(async () => {
  await db.$disconnect();
});

describe("release audit — Task/Workflow real graph sync (Phase 10/12)", () => {
  it("syncTaskToGraph creates exactly one node and updates it in place on repeat calls", async () => {
    const owner = await makeUser();
    const project = await makeProject(owner.id, "Graph sync task project");
    const taskId = uid("task");

    const firstId = await syncTaskToGraph(
      {
        id: taskId,
        title: "Ship the release notes",
        description: "Draft and publish",
        status: "backlog",
        priority: "medium",
        workspaceId: null,
        projectId: project.id,
        tags: ["docs"],
      },
      owner.id,
    );

    const secondId = await syncTaskToGraph(
      {
        id: taskId,
        title: "Ship the release notes",
        description: "Draft and publish",
        status: "done",
        priority: "medium",
        workspaceId: null,
        projectId: project.id,
        tags: ["docs"],
      },
      owner.id,
    );

    expect(secondId).toBe(firstId);
    const rows = await db.knowledgeObject.findMany({ where: { sourceType: "task", sourceId: taskId } });
    expect(rows).toHaveLength(1);
    expect(rows[0].type).toBe("Task");
    expect((rows[0].metadata as { status: string }).status).toBe("done");
  });

  it("a project-scoped synced task is visible in buildGraphData to its owning user", async () => {
    const owner = await makeUser();
    const project = await makeProject(owner.id, "Graph sync visibility project");
    const taskId = uid("task");

    await syncTaskToGraph(
      {
        id: taskId,
        title: "Visible task",
        description: null,
        status: "in_progress",
        priority: "high",
        workspaceId: null,
        projectId: project.id,
        tags: [],
      },
      owner.id,
    );

    const graph = await buildGraphData({ projectId: project.id }, owner.id);
    const node = graph.nodes.find((n) => n.title === "Visible task" && n.type === "Task");
    expect(node).toBeTruthy();
  });

  it("removeEntityFromGraph deletes the node so it stops appearing in the graph", async () => {
    const owner = await makeUser();
    const project = await makeProject(owner.id, "Graph sync deletion project");
    const taskId = uid("task");
    await syncTaskToGraph(
      { id: taskId, title: "Doomed task", description: null, status: "backlog", priority: "low", workspaceId: null, projectId: project.id, tags: [] },
      owner.id,
    );
    await removeEntityFromGraph("task", taskId);
    const rows = await db.knowledgeObject.findMany({ where: { sourceType: "task", sourceId: taskId } });
    expect(rows).toHaveLength(0);
  });

  it("syncWorkflowToGraph creates exactly one node and updates it in place, matching Workflow's own visibility rule", async () => {
    const owner = await makeUser();
    const project = await makeProject(owner.id, "Graph sync workflow project");
    const workflowId = uid("workflow");

    const firstId = await syncWorkflowToGraph({
      id: workflowId,
      name: "Onboarding flow",
      description: "New user setup",
      status: "draft",
      projectId: project.id,
      userId: owner.id,
    });
    const secondId = await syncWorkflowToGraph({
      id: workflowId,
      name: "Onboarding flow",
      description: "New user setup",
      status: "active",
      projectId: project.id,
      userId: owner.id,
    });

    expect(secondId).toBe(firstId);
    const rows = await db.knowledgeObject.findMany({ where: { sourceType: "workflow", sourceId: workflowId } });
    expect(rows).toHaveLength(1);
    expect(rows[0].type).toBe("Workflow");
    expect((rows[0].metadata as { status: string }).status).toBe("active");

    const graph = await buildGraphData({ projectId: project.id }, owner.id);
    expect(graph.nodes.some((n) => n.title === "Onboarding flow")).toBe(true);
  });
});
