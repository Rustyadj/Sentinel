import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ access: vi.fn(), restart: vi.fn(), audit: vi.fn() }));
vi.mock("@/lib/agents/runtime/authorization", () => ({
  RUNTIME_PERMISSIONS: { restart: "agents.runtime.restart" },
  requireRuntimeAccess: mocks.access,
}));
vi.mock("@/lib/agents/runtime/api", () => ({
  runtimeErrorResponse: (error: { status?: number; message?: string }) => Response.json(
    { error: error.message ?? "Runtime error" },
    { status: error.status ?? 500 },
  ),
}));
vi.mock("@/lib/agents/processControl", () => ({ restartContainer: mocks.restart }));
vi.mock("@/lib/workspaces/audit", () => ({ writeAuditLog: mocks.audit }));

import { POST } from "./route";

describe("POST /api/agents/[id]/restart", () => {
  beforeEach(() => vi.clearAllMocks());

  it("forbids workspace members", async () => {
    mocks.access.mockRejectedValue(Object.assign(new Error("Missing permission"), { status: 403 }));
    const response = await POST(new Request("http://localhost"), { params: Promise.resolve({ id: "hermes-lisa" }) });
    expect(response.status).toBe(403);
    expect(mocks.restart).not.toHaveBeenCalled();
  });

  it("restarts an allowlisted agent for an owner", async () => {
    mocks.access.mockResolvedValue({
      user: { id: "u1", email: "owner@example.com" },
      runtime: { id: "runtime-hermes-lisa", workspaceId: "workspace-1" },
    });
    mocks.restart.mockResolvedValue({ stdout: "ok", stderr: "" });
    const response = await POST(new Request("http://localhost"), { params: Promise.resolve({ id: "hermes-lisa" }) });
    expect(response.status).toBe(200);
    expect(mocks.restart).toHaveBeenCalledWith("hermes-lisa");
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "agent_runtime.restarted" }));
  });
});
