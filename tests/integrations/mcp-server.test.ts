import { beforeEach, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

vi.mock("@/lib/orchestration/scope", () => ({
  resolveScope: vi.fn(),
}));
vi.mock("@/lib/orchestration/service", () => ({
  createOrchestrationRun: vi.fn(),
}));
vi.mock("@/lib/orchestration/executor", () => ({
  cancelOrchestrationRun: vi.fn(),
}));
vi.mock("@/lib/knowledge/memoryAccess", () => ({
  memoryReadWhere: vi.fn(),
}));
const contextDeps = vi.hoisted(() => ({ resolveMcpContext: vi.fn(), listPermittedContext: vi.fn() }));
vi.mock("@/lib/integrations/mcp-context", () => contextDeps);
const deps = vi.hoisted(() => ({
  findUser: vi.fn(),
  findRun: vi.fn(),
  findMemories: vi.fn(),
  listDescriptors: vi.fn(),
}));
vi.mock("@/lib/db", () => ({
  db: {
    user: { findUnique: deps.findUser },
    orchestrationRun: { findFirst: deps.findRun, findFirstOrThrow: deps.findRun },
    memory: { findMany: deps.findMemories },
  },
}));
vi.mock("@/lib/agents/capability-descriptor", () => ({
  listAgentCapabilityDescriptors: deps.listDescriptors,
}));

import { createSentinelMcpServer } from "@/lib/integrations/mcp-server";
import { createOrchestrationRun } from "@/lib/orchestration/service";

beforeEach(() => {
  Object.values(deps).forEach((mock) => mock.mockReset());
  deps.listDescriptors.mockResolvedValue([]);
  contextDeps.resolveMcpContext.mockReset();
  contextDeps.listPermittedContext.mockReset();
  contextDeps.resolveMcpContext.mockResolvedValue({
    scope: { projectId: null, projectName: null, workspaceId: null, workspaceName: null, resolution: "none" },
    reason: "not permitted",
  });
});

describe("Sentinel MCP server", () => {
  it("advertises only curated Sentinel tools", async () => {
    const server = createSentinelMcpServer({
      userId: "user-1",
      clientId: "chatgpt",
      externalClientId: "client-1",
      scopes: ["sentinel.read", "sentinel.tasks.read", "sentinel.tasks.write", "sentinel.memory.read"],
    });
    const client = new Client({ name: "test-client", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual([
      "sentinel.agent_status",
      "sentinel.cancel_task",
      "sentinel.capabilities",
      "sentinel.get_result",
      "sentinel.get_task",
      "sentinel.list_agents",
      "sentinel.memory_search",
      "sentinel.profile",
      "sentinel.project_context",
      "sentinel.route_task",
    ]);
    expect(tools.some((tool) => /shell|database|docker/i.test(tool.name))).toBe(false);
    const profile = tools.find((tool) => tool.name === "sentinel.profile");
    expect(profile?._meta).toMatchObject({ "openai/profile": true });
    const route = tools.find((tool) => tool.name === "sentinel.route_task");
    expect(route?.inputSchema).toMatchObject({
      properties: expect.objectContaining({ projectId: expect.anything(), workspaceId: expect.anything(), contextTaskId: expect.anything() }),
    });
    const { resources } = await client.listResources();
    expect(resources.map((resource) => resource.uri).sort()).toEqual(["sentinel://capabilities", "sentinel://context"]);
    await Promise.all([client.close(), server.close()]);
  });

  it("returns the stable authenticated profile expected by ChatGPT", async () => {
    deps.findUser.mockResolvedValue({ id: "user-1", name: "Owner", email: "owner@example.com" });
    const server = createSentinelMcpServer({ userId: "user-1", clientId: "chatgpt", externalClientId: "client-1", scopes: ["sentinel.read"] });
    const client = new Client({ name: "test-client", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    const result = await client.callTool({ name: "sentinel.profile", arguments: {} });
    expect(result.structuredContent).toEqual({ id: "user-1", name: "Owner", email: "owner@example.com" });
    await Promise.all([client.close(), server.close()]);
  });

  it("fails closed on insufficient scope and another user's task id", async () => {
    deps.findRun.mockResolvedValue(null);
    const server = createSentinelMcpServer({ userId: "user-1", clientId: "chatgpt", externalClientId: "client-1", scopes: ["sentinel.tasks.read"] });
    const client = new Client({ name: "test-client", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    const wrongOwner = await client.callTool({ name: "sentinel.get_task", arguments: { taskId: "someone-elses-run" } });
    expect(wrongOwner.isError).toBe(true);
    expect(JSON.stringify(wrongOwner)).toContain("Task not found");
    const insufficient = await client.callTool({ name: "sentinel.cancel_task", arguments: { taskId: "run-1" } });
    expect(insufficient.isError).toBe(true);
    expect(JSON.stringify(insufficient)).toContain("sentinel.tasks.write");
    await Promise.all([client.close(), server.close()]);
  });

  it("revalidates durable execution scope before returning task data", async () => {
    contextDeps.resolveMcpContext.mockResolvedValue({
      scope: { projectId: "project-1", projectName: "Sentinel", workspaceId: "workspace-1", workspaceName: "Main", resolution: "context" },
      reason: "owned and permitted",
    });
    deps.findRun.mockResolvedValue({ id: "run-1", status: "succeeded", projectId: "project-1", workspaceId: "workspace-1", validation: { passed: true } });
    const server = createSentinelMcpServer({ userId: "user-1", clientId: "chatgpt", externalClientId: "client-1", scopes: ["sentinel.tasks.read"] });
    const client = new Client({ name: "test-client", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    const result = await client.callTool({ name: "sentinel.get_task", arguments: { taskId: "run-1" } });
    expect(result.isError).not.toBe(true);
    expect(contextDeps.resolveMcpContext).toHaveBeenCalledWith("user-1", { contextTaskId: "run-1" });
    expect(deps.findRun).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "run-1", userId: "user-1", projectId: "project-1" } }));
    await Promise.all([client.close(), server.close()]);
  });

  it("does not pass an external explicitUserOverride into production routing", async () => {
    vi.mocked(createOrchestrationRun).mockResolvedValue({ id: "run-1", status: "queued", resolvedAgentId: "codex", error: null } as never);
    const server = createSentinelMcpServer({ userId: "user-1", clientId: "chatgpt", externalClientId: "client-1", scopes: ["sentinel.tasks.write"] });
    const client = new Client({ name: "test-client", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    await client.callTool({ name: "sentinel.route_task", arguments: { task: "review this", mode: "async", explicitUserOverride: true } });
    expect(vi.mocked(createOrchestrationRun)).toHaveBeenCalledWith(expect.not.objectContaining({ explicitUserOverride: true }), expect.anything());
    await Promise.all([client.close(), server.close()]);
  });
});
