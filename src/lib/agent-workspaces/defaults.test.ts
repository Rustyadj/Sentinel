import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const tx = {
    $queryRaw: vi.fn(),
    agent: { findUnique: vi.fn() },
    agentWorkspace: { findMany: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
  };
  return {
    tx,
    db: { $transaction: vi.fn(async (work: (client: typeof tx) => unknown) => work(tx)), agent: tx.agent, agentWorkspace: tx.agentWorkspace },
    recordEvent: vi.fn(),
    provider: { isAvailable: vi.fn(), createWorkspace: vi.fn() },
  };
});

vi.mock("@/lib/db", () => ({ db: mocks.db }));
vi.mock("./events", () => ({ recordWorkspaceEvent: mocks.recordEvent }));
vi.mock("./providers", () => ({ getRuntimeProvider: () => mocks.provider }));

import { resolveDefaultAgentWorkspace, setDefaultAgentWorkspace } from "./defaults";
import { createAgentWorkspace } from "./service";

const lisa = {
  id: "lisa-default", agentId: "hermes-lisa", ownerUserId: "operator", workspaceId: "tenant-1",
  organizationId: null, projectId: null, name: "Lisa Default Computer", slug: "lisa-default", description: null,
  status: "ACTIVE", runtimeType: "docker", image: "sentinel/agent-workspace:base", volumeName: "lisa-volume",
  homePath: "/workspace", resourceLimits: {}, policy: {}, locked: false, isDefault: true,
  lastActiveAt: null, archivedAt: null, dataDeletedAt: null, createdAt: new Date(), updatedAt: new Date(),
};
const nathan = { ...lisa, id: "nathan-default", agentId: "hermes-nathan2", name: "Nathan Default Computer", slug: "nathan-default", volumeName: "nathan-volume" };
const experimental = { ...lisa, id: "lisa-experimental", name: "Lisa Experimental Workspace", slug: "lisa-experimental", isDefault: false };

function defaultFinds(...responses: unknown[]) {
  mocks.tx.agentWorkspace.findMany.mockImplementation(() => Promise.resolve(responses.shift()));
}

describe("canonical agent workspace resolver", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.tx.$queryRaw.mockResolvedValue([]);
    mocks.provider.isAvailable.mockResolvedValue({ available: true });
    mocks.provider.createWorkspace.mockResolvedValue({ volumeName: "created-volume" });
    mocks.tx.agentWorkspace.update.mockImplementation(({ data }: { data: object }) => Promise.resolve({ ...lisa, ...data }));
  });

  it("creates the first default only with explicit provisioning", async () => {
    defaultFinds([], []);
    mocks.tx.agent.findUnique.mockResolvedValue({ id: "hermes-lisa" });
    mocks.tx.agentWorkspace.findFirst.mockResolvedValue(null);
    mocks.tx.agentWorkspace.create.mockResolvedValue({ ...lisa, volumeName: null });

    const workspace = await resolveDefaultAgentWorkspace({
      agentId: "hermes-lisa",
      provisioning: { tenantWorkspaceId: "tenant-1", ownerUserId: "operator", actor: { client: "system" } },
    });

    expect(workspace.id).toBe("lisa-default");
    expect(mocks.tx.agentWorkspace.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ isDefault: true }) }));
    expect(mocks.tx.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it("returns the same default repeatedly across chats, sessions, restarts, and runtime recreation", async () => {
    defaultFinds([lisa]);
    const first = await resolveDefaultAgentWorkspace({ agentId: "hermes-lisa" });
    defaultFinds([lisa]);
    const second = await resolveDefaultAgentWorkspace({ agentId: "hermes-lisa" });
    expect(first.id).toBe(second.id);
    expect(mocks.tx.agentWorkspace.findMany).toHaveBeenCalledTimes(2);
  });

  it("keeps different agents on different canonical computers", async () => {
    defaultFinds([lisa]);
    const lisaDefault = await resolveDefaultAgentWorkspace({ agentId: "hermes-lisa" });
    defaultFinds([nathan]);
    const nathanDefault = await resolveDefaultAgentWorkspace({ agentId: "hermes-nathan2" });
    expect(lisaDefault.id).not.toBe(nathanDefault.id);
  });

  it("does not let an additional workspace replace the default", async () => {
    mocks.tx.agent.findUnique.mockResolvedValue({ id: "hermes-lisa" });
    mocks.tx.agentWorkspace.findFirst.mockResolvedValue(null);
    mocks.tx.agentWorkspace.create.mockResolvedValue({ ...experimental, volumeName: null });
    mocks.tx.agentWorkspace.update.mockResolvedValue(experimental);
    const created = await createAgentWorkspace({
      agentId: "hermes-lisa", tenantWorkspaceId: "tenant-1", ownerUserId: "operator", name: "Lisa Experimental Workspace", actor: { client: "system" },
    });
    expect(created.isDefault).toBe(false);
    expect(mocks.tx.agentWorkspace.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ isDefault: false }) }));

    defaultFinds([lisa]);
    const workspace = await resolveDefaultAgentWorkspace({ agentId: "hermes-lisa" });
    expect(workspace.id).toBe(lisa.id);
    expect(experimental.isDefault).toBe(false);
  });

  it("promotes exactly one legacy candidate but refuses to guess among several", async () => {
    defaultFinds([], [experimental]);
    mocks.tx.agentWorkspace.update.mockResolvedValue({ ...experimental, isDefault: true });
    expect((await resolveDefaultAgentWorkspace({ agentId: "hermes-lisa" })).id).toBe(experimental.id);

    defaultFinds([], [lisa, experimental]);
    await expect(resolveDefaultAgentWorkspace({ agentId: "hermes-lisa" })).rejects.toMatchObject({ code: "default_workspace_conflict" });
  });

  it("surfaces duplicate legacy defaults rather than selecting one", async () => {
    defaultFinds([lisa, experimental]);
    await expect(resolveDefaultAgentWorkspace({ agentId: "hermes-lisa" })).rejects.toMatchObject({ code: "default_workspace_conflict" });
  });

  it("switches defaults transactionally for an explicit authorized operation", async () => {
    mocks.tx.agentWorkspace.findUnique.mockResolvedValue(experimental);
    mocks.tx.agentWorkspace.update.mockResolvedValue({ ...experimental, isDefault: true });
    const workspace = await setDefaultAgentWorkspace({ agentId: "hermes-lisa", agentWorkspaceId: experimental.id, actor: { client: "sentinel-ui", userId: "operator" } });
    expect(workspace.id).toBe(experimental.id);
    expect(mocks.tx.agentWorkspace.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ agentId: "hermes-lisa", isDefault: true }), data: { isDefault: false } }));
    expect(mocks.tx.agentWorkspace.update).toHaveBeenCalledWith(expect.objectContaining({ data: { isDefault: true } }));
  });
});
