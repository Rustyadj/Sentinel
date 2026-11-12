import { beforeAll, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createSentinelMcpServer } from "@/lib/integrations/mcp-server";
import { makeUser, makeWorkspace } from "../neural-engine/db-setup";
import { ingestOperationalEvent } from "@/lib/knowledge/operational-ingestion";
import { syntheticIncident } from "./fixtures";
import type { McpScope } from "@/lib/integrations/oauth";
let owner: string, outsider: string, workspace: string;
beforeAll(async () => { owner = (await makeUser()).id; outsider = (await makeUser()).id; workspace = (await makeWorkspace(owner)).id; await ingestOperationalEvent(owner, workspace, syntheticIncident(1)); });
async function invoke(userId: string, scopes: McpScope[], name = "Codex") {
  const server = createSentinelMcpServer({ userId, scopes, clientId: name, externalClientId: name });
  const client = new Client({ name, version: "1.0.0" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(b), client.connect(a)]);
  try { return await client.callTool({ name: "sentinel.memory_search", arguments: { query: "Sentinel gateway outage", operational: "history", workspaceId: workspace, latest: true } }); }
  finally { await Promise.all([client.close(), server.close()]); }
}
describe("operational evidence on the existing MCP memory interface", () => {
  it("requires the existing memory scope", async () => { expect((await invoke(owner, ["sentinel.read"])).isError).toBe(true); });
  it("denies a valid workspace id belonging to another user", async () => { expect((await invoke(outsider, ["sentinel.memory.read"])).isError).toBe(true); });
  it.each(["Hermes Lisa", "Hermes Nathan2", "Claude Code", "Codex"])("returns permitted evidence to %s without granting infrastructure actions", async name => {
    const result = await invoke(owner, ["sentinel.memory.read"], name);
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({ incidents: [expect.objectContaining({ sourceId: "synthetic-incident-1", responders: [expect.objectContaining({ title: "Synthetic responder" })], actions: expect.arrayContaining([expect.objectContaining({ outcome: "unsuccessful" })]) })] });
  });
});
