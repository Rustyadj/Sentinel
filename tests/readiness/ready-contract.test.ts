import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  queryRaw: vi.fn(),
  redisHealth: vi.fn(),
  getWorkers: vi.fn(),
  listRuntimeViews: vi.fn(),
  health: vi.fn(),
  redisGet: vi.fn(),
  redisSet: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ db: { $queryRaw: mocks.queryRaw } }));
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));
vi.mock("@/lib/redis", () => ({
  redisHealth: mocks.redisHealth,
  redisGet: mocks.redisGet,
  redisSet: mocks.redisSet,
}));
vi.mock("@/lib/orchestration/queue", () => ({
  getOrchestrationQueue: () => ({ getWorkers: mocks.getWorkers }),
}));
vi.mock("@/lib/agents/runtime/service", () => ({
  listRuntimeViews: mocks.listRuntimeViews,
  getRuntimeAdapter: () => ({ health: mocks.health }),
}));
vi.mock("@/lib/agents/runtime/config", () => ({ asRuntimeInstance: (r: unknown) => r }));

import { GET } from "@/app/api/ready/route";

const runtime = (over: Record<string, unknown> = {}) => ({
  id: "runtime-claude-code", agentId: "claude-code", kind: "claude-code",
  enabled: true, executionVerified: true, ...over,
});
const healthy = { ready: true, busy: false, reachable: true, authenticated: true };

describe("/api/ready reflects architectural truth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.queryRaw.mockResolvedValue([{ "?column?": 1 }]);
    mocks.redisHealth.mockResolvedValue({ configured: true, ok: true, latencyMs: 1 });
    mocks.getWorkers.mockResolvedValue([{ id: "worker-1" }]);
    mocks.listRuntimeViews.mockResolvedValue([runtime()]);
    mocks.health.mockResolvedValue(healthy);
    mocks.redisGet.mockResolvedValue(null);
    mocks.redisSet.mockResolvedValue(undefined);
  });

  it("is ready when the required components are up", async () => {
    const body = await (await GET()).json();
    expect(body.ready).toBe(true);
  });

  // The production regression this route was rewritten for: a runtime that is
  // simply absent from the architecture must not hold readiness down.
  it("stays ready when a runtime is unreachable", async () => {
    mocks.health.mockResolvedValue({ ready: false, busy: false, reachable: false, authenticated: null });
    const response = await GET();
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.ready).toBe(true);
    expect(body.optional.runtimes[0]).toMatchObject({ state: "unavailable", required: false });
  });

  it("reports auth_required without claiming Sentinel itself is down", async () => {
    mocks.health.mockResolvedValue({ ready: false, busy: false, reachable: true, authenticated: false, failureCode: "not_authenticated" });
    const response = await GET();
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.ready).toBe(true);
    expect(body.optional.runtimes[0].state).toBe("auth_required");
  });

  it.each([
    ["database", () => mocks.queryRaw.mockRejectedValue(new Error("down"))],
    ["redis", () => mocks.redisHealth.mockResolvedValue({ configured: true, ok: false })],
    ["orchestrationWorker", () => mocks.getWorkers.mockResolvedValue([])],
  ])("is not ready when required component %s fails", async (key, breakIt) => {
    breakIt();
    const response = await GET();
    const body = await response.json();
    expect(response.status).toBe(503);
    expect(body.ready).toBe(false);
    expect(body.required[key].ok).toBe(false);
  });

  it("is not ready when no dispatchable runtime is registered", async () => {
    mocks.listRuntimeViews.mockResolvedValue([runtime({ executionVerified: false })]);
    const response = await GET();
    expect(response.status).toBe(503);
    expect((await response.json()).required.runtimeRegistry.ok).toBe(false);
  });
});
