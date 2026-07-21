import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ user: vi.fn(), restart: vi.fn() }));
vi.mock("@/lib/agents/permissions", () => ({
  getControlPlaneUser: mocks.user,
  canRestartAgent: (role: string) => role === "owner" || role === "admin",
  unauthorized: () => Response.json({ error: "Unauthorized" }, { status: 401 }),
  forbidden: () => Response.json({ error: "Forbidden" }, { status: 403 }),
}));
vi.mock("@/lib/agents/processControl", () => ({ restartContainer: mocks.restart }));

import { POST } from "./route";

describe("POST /api/agents/[id]/restart", () => {
  beforeEach(() => vi.clearAllMocks());

  it("forbids workspace members", async () => {
    mocks.user.mockResolvedValue({ id: "u1", email: "member@example.com", role: "member" });
    const response = await POST(new Request("http://localhost"), { params: Promise.resolve({ id: "hermes-lisa" }) });
    expect(response.status).toBe(403);
    expect(mocks.restart).not.toHaveBeenCalled();
  });

  it("restarts an allowlisted agent for an owner", async () => {
    mocks.user.mockResolvedValue({ id: "u1", email: "owner@example.com", role: "owner" });
    mocks.restart.mockResolvedValue({ stdout: "ok", stderr: "" });
    const response = await POST(new Request("http://localhost"), { params: Promise.resolve({ id: "hermes-lisa" }) });
    expect(response.status).toBe(200);
    expect(mocks.restart).toHaveBeenCalledWith("hermes-lisa");
  });
});
