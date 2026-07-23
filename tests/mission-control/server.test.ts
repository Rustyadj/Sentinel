// Regression coverage for buildMissionControlData's tenant scoping under
// realistic volume — added in response to review feedback on PR #14: the
// old code filtered candidates/experiences against the truncated top-20
// `projects` display list (silently dropping items outside it) and summed
// a capped, unordered `experience.findMany` for costToday (silently
// truncating once more than 200 same-day experiences existed).
import { afterAll, describe, expect, it, vi } from "vitest";

// getAccessibleWorkspaceIds (via @/lib/agents/permissions) statically
// imports @/auth, which pulls in next-auth's package internals — those
// import "next/server" in a way plain vitest (no Next build transform)
// can't resolve. None of that machinery is exercised by this test, which
// calls buildMissionControlData directly rather than through a request
// handler, so the whole module is stubbed out at the import boundary.
vi.mock("@/auth", () => ({ auth: vi.fn(), handlers: {}, signIn: vi.fn(), signOut: vi.fn() }));

import { db } from "@/lib/db";
import { buildMissionControlData } from "@/lib/mission-control/server";

afterAll(async () => {
  await db.$disconnect();
});

let seq = 0;
function uid(prefix: string) {
  seq += 1;
  return `${prefix}-${Date.now()}-${seq}-${Math.random().toString(36).slice(2, 8)}`;
}

async function makeUser() {
  return db.user.create({ data: { email: `${uid("user")}@example.com` } });
}

describe("buildMissionControlData — tenant scoping under realistic volume", () => {
  it("still surfaces a learning candidate whose project sits outside the top-20 most-recently-updated project list", async () => {
    const user = await makeUser();
    const workspace = await db.workspace.create({
      data: { slug: uid("ws"), name: "Volume Workspace", ownerId: user.id },
    });

    // The target project is created first, so after 24 more (with strictly
    // later updatedAt) it falls to position 25 — outside the `take: 20`
    // display list `projects` — while still being a real, accessible
    // (userId-owned) project.
    const targetProject = await db.project.create({
      data: { name: "Old but accessible project", userId: user.id, workspaceId: workspace.id },
    });
    for (let i = 0; i < 24; i++) {
      await db.project.create({ data: { name: `Filler project ${i}`, userId: user.id, workspaceId: workspace.id } });
    }

    const agent = await db.agent.create({
      data: { name: "Volume Agent", role: "tester", avatar: "🤖", color: "#6366f1", model: "test-model", workspaceId: workspace.id, toolPermissions: [] },
    });
    const experience = await db.experience.create({
      data: { agentId: agent.id, projectId: targetProject.id, workspaceId: workspace.id, objective: "Work in the old project", outcomeStatus: "success" },
    });
    const candidate = await db.learningCandidate.create({
      data: { experienceId: experience.id, type: "confidence_update", proposedPayload: { note: "test" }, status: "proposed" },
    });

    const data = await buildMissionControlData({ id: user.id, name: null, email: user.email });

    expect(data.attention.some((item) => item.targetId === candidate.id)).toBe(true);
  });

  it("computes an accurate, untruncated costToday from more than 200 same-day experiences", async () => {
    const user = await makeUser();
    const workspace = await db.workspace.create({
      data: { slug: uid("ws"), name: "High Volume Workspace", ownerId: user.id },
    });
    const agent = await db.agent.create({
      data: { name: "High Volume Agent", role: "tester", avatar: "🤖", color: "#6366f1", model: "test-model", workspaceId: workspace.id, toolPermissions: [] },
    });

    const experienceCount = 240;
    const costPerExperience = 0.05;
    await db.experience.createMany({
      data: Array.from({ length: experienceCount }, () => ({
        agentId: agent.id,
        workspaceId: workspace.id,
        objective: "High volume task",
        outcomeStatus: "success" as const,
        cost: costPerExperience,
      })),
    });

    const data = await buildMissionControlData({ id: user.id, name: null, email: user.email });
    const agentOp = data.agents.find((item) => item.id === agent.id);

    expect(agentOp?.costToday).not.toBeNull();
    expect(agentOp?.costToday).toBeCloseTo(experienceCount * costPerExperience, 5);
  });

  it("still finds the currently-running experience for an agent whose 200-cap concurrent-run window is exercised", async () => {
    const user = await makeUser();
    const workspace = await db.workspace.create({
      data: { slug: uid("ws"), name: "Running Workspace", ownerId: user.id },
    });
    const agent = await db.agent.create({
      data: { name: "Running Agent", role: "tester", avatar: "🤖", color: "#6366f1", model: "test-model", workspaceId: workspace.id, toolPermissions: [] },
    });

    // A handful of older completed runs plus one real in-progress run —
    // the in-progress run must surface as currentTask regardless of how
    // many completed same-day rows exist alongside it.
    await db.experience.createMany({
      data: Array.from({ length: 5 }, () => ({
        agentId: agent.id, workspaceId: workspace.id, objective: "Completed earlier", outcomeStatus: "success" as const,
      })),
    });
    await db.experience.create({
      data: { agentId: agent.id, workspaceId: workspace.id, objective: "Actively running task", outcomeStatus: "in_progress" },
    });

    const data = await buildMissionControlData({ id: user.id, name: null, email: user.email });
    const agentOp = data.agents.find((item) => item.id === agent.id);

    expect(agentOp?.currentTask).toBe("Actively running task");
  });
});
