import { beforeEach, describe, expect, it, vi } from "vitest";

const deps = vi.hoisted(() => ({
  resolveContext: vi.fn(),
  listRuntimes: vi.fn(),
  health: vi.fn(),
  selectWorker: vi.fn(),
  retrieveContext: vi.fn(),
  findExisting: vi.fn(),
  createRun: vi.fn(),
  audit: vi.fn(),
  enqueue: vi.fn(),
}));

vi.mock("@/lib/integrations/mcp-context", () => ({ resolveMcpContext: deps.resolveContext }));
vi.mock("@/lib/agents/runtime/service", () => ({
  listRuntimeViews: deps.listRuntimes,
  getRuntimeAdapter: () => ({ health: deps.health }),
}));
vi.mock("@/lib/orchestration/worker-router", () => ({ selectWorker: deps.selectWorker }));
vi.mock("@/lib/neural-engine/knowledge-bridge", () => ({ retrieveContextWithProvenance: deps.retrieveContext }));
vi.mock("@/lib/workspaces/audit", () => ({ writeAuditLog: deps.audit }));
vi.mock("@/lib/orchestration/queue", () => ({ enqueueOrchestrationRun: deps.enqueue }));
vi.mock("@/lib/db", () => ({
  db: { orchestrationRun: { findUnique: deps.findExisting, create: deps.createRun } },
}));

import { createOrchestrationRun } from "@/lib/orchestration/service";

const runtime = {
  id: "runtime-codex",
  agentId: "codex",
  kind: "codex",
  transport: "process",
  enabled: true,
  executionVerified: true,
  capabilities: {},
  sentinelControl: "partial",
};

beforeEach(() => {
  Object.values(deps).forEach((mock) => mock.mockReset());
  deps.resolveContext.mockResolvedValue({
    scope: { projectId: "project-1", projectName: "Sentinel", workspaceId: "workspace-1", workspaceName: "Mission Control", resolution: "explicit" },
    reason: "explicit",
  });
  deps.listRuntimes.mockResolvedValue([runtime]);
  deps.retrieveContext.mockResolvedValue({ memories: [], notes: [], decisions: [], knowledgeObjectIds: [] });
  deps.findExisting.mockResolvedValue(null);
  deps.selectWorker.mockResolvedValue({ agentId: "codex", reason: "requested", scores: { codex: 1 } });
  deps.createRun.mockResolvedValue({ id: "run-1", projectId: "project-1", workspaceId: "workspace-1" });
  deps.audit.mockResolvedValue(undefined);
  deps.enqueue.mockResolvedValue(undefined);
});

describe("MCP durable routing", () => {
  it("honors a valid explicitly requested agent and enqueues exactly one durable run", async () => {
    deps.health.mockResolvedValue({ reachable: true, authenticated: true, ready: true });
    const run = await createOrchestrationRun(
      { task: "review this repository", projectId: "project-1", preferredAgentId: "codex" },
      { userId: "user-1", externalClientId: "client-1" },
    );
    expect(deps.selectWorker).toHaveBeenCalledWith(expect.objectContaining({ candidates: ["codex"] }));
    expect(deps.createRun).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ requestedAgentId: "codex", resolvedAgentId: "codex", userId: "user-1" }),
    }));
    expect(deps.enqueue).toHaveBeenCalledOnce();
    expect(run.id).toBe("run-1");
  });

  it("reports a reachable requested agent that is not authenticated", async () => {
    deps.health.mockResolvedValue({ reachable: true, authenticated: false, ready: false });
    await expect(createOrchestrationRun(
      { task: "review this repository", projectId: "project-1", preferredAgentId: "codex" },
      { userId: "user-1" },
    )).rejects.toThrow("codex is reachable but not authenticated");
    expect(deps.createRun).not.toHaveBeenCalled();
  });

  it("does not pretend an unknown requested agent exists", async () => {
    await expect(createOrchestrationRun(
      { task: "review this repository", projectId: "project-1", preferredAgentId: "not-configured" },
      { userId: "user-1" },
    )).rejects.toThrow("not configured or is not permitted");
  });
});
