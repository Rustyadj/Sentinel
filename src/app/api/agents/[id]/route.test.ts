import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ requireAgentRecordUser: vi.fn() }));
vi.mock("@/lib/agents/permissions", () => ({
  requireAgentRecordUser: mocks.requireAgentRecordUser,
  unauthorized: () => Response.json({ error: "Unauthorized" }, { status: 401 }),
  forbidden: (action: string) => Response.json({ error: `Forbidden: requires owner or admin to ${action}` }, { status: 403 }),
}));

import { db } from "@/lib/db";
import { PUT } from "./route";

afterAll(async () => db.$disconnect());

async function makeAgent() {
  return db.agent.create({
    data: { name: "Test worker", role: "implementation", avatar: "Code", color: "#F97316", model: "test-model" },
  });
}

describe("PUT /api/agents/[id]", () => {
  beforeEach(() => vi.clearAllMocks());

  it("forbids a member from updating capability weights", async () => {
    mocks.requireAgentRecordUser.mockResolvedValue(null);
    const req = new Request("http://localhost", { method: "PUT", body: JSON.stringify({ capabilityWeights: { coding: 1 } }) });
    const res = await PUT(req, { params: Promise.resolve({ id: "claude-code" }) });
    expect(res.status).toBe(403);
  });

  it("sanitizes and persists capability weights: clamps out-of-range values and drops unknown keys", async () => {
    const agent = await makeAgent();
    mocks.requireAgentRecordUser.mockResolvedValue({ id: "u1", email: "a@b.com", role: "owner", workspaceId: "w1" });

    const req = new Request("http://localhost", {
      method: "PUT",
      body: JSON.stringify({ capabilityWeights: { coding: 1.5, testing: -0.2, backend: 0.6, notARealCapability: 0.9 } }),
    });
    const res = await PUT(req, { params: Promise.resolve({ id: agent.id }) });
    expect(res.status).toBe(200);

    const updated = await db.agent.findUniqueOrThrow({ where: { id: agent.id } });
    expect(updated.capabilityWeights).toEqual({ coding: 1, testing: 0, backend: 0.6 });
  });

  it("leaves capabilityWeights untouched when the field is omitted from the request", async () => {
    const agent = await db.agent.create({
      data: {
        name: "Test worker 2", role: "implementation", avatar: "Code", color: "#F97316", model: "test-model",
        capabilityWeights: { coding: 0.42 },
      },
    });
    mocks.requireAgentRecordUser.mockResolvedValue({ id: "u1", email: "a@b.com", role: "owner", workspaceId: "w1" });

    const req = new Request("http://localhost", { method: "PUT", body: JSON.stringify({ name: "Renamed" }) });
    const res = await PUT(req, { params: Promise.resolve({ id: agent.id }) });
    expect(res.status).toBe(200);

    const updated = await db.agent.findUniqueOrThrow({ where: { id: agent.id } });
    expect(updated.capabilityWeights).toEqual({ coding: 0.42 });
    expect(updated.name).toBe("Renamed");
  });
});
