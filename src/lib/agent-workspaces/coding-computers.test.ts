import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  db: { workspace: { findUnique: vi.fn() }, agentWorkspace: { findMany: vi.fn() }, agent: { findUnique: vi.fn(), upsert: vi.fn() }, agentRuntime: { findUnique: vi.fn(), upsert: vi.fn() } },
  resolve: vi.fn(), start: vi.fn(), command: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ db: mocks.db }));
vi.mock("./defaults", () => ({ resolveDefaultAgentWorkspace: mocks.resolve }));
vi.mock("./service", () => ({ startRuntime: mocks.start }));
vi.mock("./exec", () => ({ runCommand: mocks.command }));
vi.mock("@/lib/agents/runtime/workspace-runner", () => ({ shellArg: (value: string) => `'${value}'` }));
import { provisionCodingComputers } from "./coding-computers";
const input = { tenantWorkspaceId: "tenant", ownerUserId: "owner", image: "coding:pinned" };
describe("coding computer provisioning", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.db.workspace.findUnique.mockResolvedValue({ id: "tenant", ownerId: "owner" });
    mocks.db.agentWorkspace.findMany.mockResolvedValue([]);
    mocks.db.agent.findUnique.mockResolvedValue(null);
    mocks.db.agentRuntime.findUnique.mockResolvedValue(null);
    mocks.resolve.mockImplementation(async ({ agentId }) => ({ id: `computer-${agentId}`, agentId, workspaceId: "tenant", ownerUserId: "owner", status: "ACTIVE", locked: false, homePath: "/workspace", image: "existing:image", volumeName: `volume-${agentId}` }));
    mocks.command.mockResolvedValue({ exitCode: 0 });
  });
  it("creates two identities with independent defaults without replacing existing models or images", async () => {
    const result = await provisionCodingComputers(input);
    expect(result.map(row => row.agentId)).toEqual(["claude-code", "codex"]);
    expect(result.map(row => row.volumeName)).toEqual(["volume-claude-code", "volume-codex"]);
    expect(result.every(row => row.image === "existing:image")).toBe(true);
    expect(mocks.db.agent.upsert.mock.calls.every(([arg]) => JSON.stringify(arg.update) === '{"workspaceId":"tenant"}')).toBe(true);
    expect(mocks.resolve).toHaveBeenCalledWith(expect.objectContaining({ agentId: "codex", provisioning: expect.objectContaining({ policy: { allowedRuntimeClients: ["codex", "sentinel-ui"], crossAgentDelegation: "explicit-only" } }) }));
  });
  it("rejects a non-owner before any writes", async () => {
    await expect(provisionCodingComputers({ ...input, ownerUserId: "intruder" })).rejects.toMatchObject({ code: "workspace_forbidden" });
    expect(mocks.db.agent.upsert).not.toHaveBeenCalled();
  });
  it("preflights both agents and refuses a conflicting second runtime before changing the first", async () => {
    mocks.db.agentRuntime.findUnique.mockImplementation(async ({ where }) => where.id === "runtime-codex" ? { agentId: "codex", kind: "codex", workspaceId: "other-tenant" } : null);
    await expect(provisionCodingComputers(input)).rejects.toMatchObject({ code: "workspace_forbidden" });
    expect(mocks.db.agent.upsert).not.toHaveBeenCalled();
    expect(mocks.start).not.toHaveBeenCalled();
  });
  it("does not move another owner's existing workspace", async () => {
    mocks.db.agentWorkspace.findMany.mockResolvedValue([{ workspaceId: "tenant", ownerUserId: "someone-else" }]);
    await expect(provisionCodingComputers(input)).rejects.toMatchObject({ code: "workspace_forbidden" });
    expect(mocks.db.agent.upsert).not.toHaveBeenCalled();
  });
  it("reports initialization failure and does not mark the runtime verified", async () => {
    mocks.command.mockResolvedValue({ exitCode: 1 });
    await expect(provisionCodingComputers(input)).rejects.toMatchObject({ code: "command_failed" });
    expect(mocks.db.agentRuntime.upsert).not.toHaveBeenCalled();
  });
});
