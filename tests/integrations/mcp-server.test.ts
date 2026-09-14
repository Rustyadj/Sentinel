import { describe, expect, it, vi } from "vitest";
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

import { createSentinelMcpServer } from "@/lib/integrations/mcp-server";
import { createOrchestrationRun } from "@/lib/orchestration/service";

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
      "sentinel.get_result",
      "sentinel.get_task",
      "sentinel.list_agents",
      "sentinel.memory_search",
      "sentinel.project_context",
      "sentinel.route_task",
    ]);
    expect(tools.some((tool) => /shell|database|docker/i.test(tool.name))).toBe(false);
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
