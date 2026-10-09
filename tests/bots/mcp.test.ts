import { beforeAll, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

vi.mock("@/lib/agents/runtime/service", async () => (await import("./fake-runtime")).serviceMock);
vi.mock("@/lib/orchestration/queue", () => ({ enqueueOrchestrationRun: vi.fn().mockResolvedValue(undefined) }));

import { db } from "@/lib/db";
import { createSentinelMcpServer, type McpPrincipal } from "@/lib/integrations/mcp-server";
import { executeOrchestrationRun } from "@/lib/orchestration/executor";
import { SENTINEL_MCP_TOOLS } from "@/lib/bots/catalog";
import { createBot } from "@/lib/bots/service";
import { botInput, makeExternalClient, makeWorkspace } from "./fixtures";
import { resetScript, script, turn } from "./fake-runtime";

let owner: { id: string }; let workspace: { id: string }; let clientRow: { id: string }; let otherClient: { id: string };
let forgeId: string; let privateId: string;

async function connect(principal: McpPrincipal) {
  const server = createSentinelMcpServer(principal);
  const client = new Client({ name: "lisa-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}
const principal = (over: Partial<McpPrincipal> = {}): McpPrincipal => ({
  userId: owner.id, clientId: "hermes-lisa-client", externalClientId: clientRow.id,
  scopes: ["sentinel.read", "sentinel.tasks.read", "sentinel.tasks.write", "sentinel.memory.read"], ...over,
});
const call = (client: Client, name: string, args: Record<string, unknown> = {}) => client.callTool({ name, arguments: args });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const structured = (result: unknown) => (result as { structuredContent?: Record<string, any> }).structuredContent!;
const errorText = (result: unknown) => JSON.stringify((result as { content?: unknown }).content);

beforeAll(async () => {
  ({ owner, workspace } = await makeWorkspace());
  clientRow = await makeExternalClient(owner.id);
  otherClient = await makeExternalClient(owner.id);
  forgeId = (await createBot(botInput(workspace.id, {
    name: "Forge", role: "Creative Production Director", status: "active", capabilities: ["video-generation", "ad-creative"],
    responsibilities: ["Short-form ads for TikTok, Reels and Shorts"], systemPrompt: "SECRET-PROMPT-DO-NOT-LEAK",
    delegationPolicy: { allowedCallers: [`client:${clientRow.id}`], allowedChildBots: [], canDelegate: false, maxDepth: 1 },
  }), owner.id)).id;
  privateId = (await createBot(botInput(workspace.id, {
    name: "Private", role: "Other", status: "active", capabilities: ["video-generation"],
    delegationPolicy: { allowedCallers: [`client:${otherClient.id}`], allowedChildBots: [], canDelegate: false, maxDepth: 1 },
  }), owner.id)).id;
});

describe("bot tools on the single SDK MCP server", () => {
  it("advertises the five bot tools and no way to create, edit, delete or grant", async () => {
    const client = await connect(principal());
    const names = (await client.listTools()).tools.map((tool) => tool.name);
    expect(names).toEqual(expect.arrayContaining(["sentinel.list_bots", "sentinel.get_bot", "sentinel.delegate_to_bot", "sentinel.get_bot_task_status", "sentinel.cancel_bot_task"]));
    expect(names.some((name) => /create_bot|update_bot|delete_bot|duplicate_bot|grant|enable_bot|disable_bot|skill|memory_policy/i.test(name))).toBe(false);
  });

  it("the catalog Sentinel offers for grants matches the tools the server really registers", async () => {
    const client = await connect(principal());
    const live = (await client.listTools()).tools.map((tool) => tool.name).sort();
    expect(SENTINEL_MCP_TOOLS.map((tool) => tool.name).sort()).toEqual(live);
    // and readOnly in the catalog agrees with the server's own annotations
    const annotated = new Map((await client.listTools()).tools.map((tool) => [tool.name, tool.annotations?.readOnlyHint === true]));
    for (const tool of SENTINEL_MCP_TOOLS) expect(annotated.get(tool.name), tool.name).toBe(tool.readOnly);
  });

  it("list_bots is the registry, filtered to bots that accept this client", async () => {
    const client = await connect(principal());
    const result = await call(client, "sentinel.list_bots", { query: "short-form reel ad" });
    const bots = structured(result).bots as Array<{ name: string }>;
    expect(bots.map((bot) => bot.name)).toEqual(["Forge"]);
    expect(JSON.stringify(result)).not.toContain("SECRET-PROMPT-DO-NOT-LEAK");
    const other = await connect(principal({ externalClientId: otherClient.id }));
    expect((structured(await call(other, "sentinel.list_bots", {})).bots as Array<{ name: string }>).map((bot) => bot.name)).toEqual(["Private"]);
  });

  it("get_bot returns the registry entry, and a bot that does not accept this client is 'not found'", async () => {
    const client = await connect(principal());
    expect(structured(await call(client, "sentinel.get_bot", { botId: forgeId })).bot).toMatchObject({ name: "Forge", host: { dispatchable: true } });
    // get_bot is read-only discovery of a bot in the user's workspace; delegation is what the policy gates.
    const denied = await call(client, "sentinel.delegate_to_bot", { botId: privateId, task: "please make a reel" });
    expect(denied.isError).toBe(true);
    expect(errorText(denied)).toMatch(/allowed callers/);
  });

  it("delegates asynchronously, then reports status and cancels — all as this client, all durable", async () => {
    const client = await connect(principal());
    const delegated = await call(client, "sentinel.delegate_to_bot", { botId: forgeId, task: "Create three concepts for a 15-second ICF construction ad.", context: "Brand: Titan ICF." });
    const task = structured(delegated).task;
    expect(task).toMatchObject({ status: "QUEUED", botName: "Forge", output: null });
    expect((await db.orchestrationRun.findUniqueOrThrow({ where: { id: task.id } })).originKey).toBe(`client:${clientRow.id}`);

    const status = structured(await call(client, "sentinel.get_bot_task_status", { taskId: task.id })).task;
    expect(status).toMatchObject({ id: task.id, status: "QUEUED" });

    const cancelled = structured(await call(client, "sentinel.cancel_bot_task", { taskId: task.id }));
    expect(cancelled).toMatchObject({ status: "cancelled", acknowledged: true });
    expect(structured(await call(client, "sentinel.get_bot_task_status", { taskId: task.id })).task.status).toBe("CANCELLED");
  });

  it("an MCP client cannot claim a running bot's task as parentTaskId to borrow that bot's authority", async () => {
    const client = await connect(principal());
    const root = await db.orchestrationRun.create({ data: {
      userId: principal().userId, botId: forgeId, status: "running", originKey: `user:${principal().userId}`,
      request: { task: "coordinate", mode: "delegate" }, requestedAgentId: "hermes-bot-host", resolvedAgentId: "hermes-bot-host",
    } });
    const before = await db.orchestrationRun.count({ where: { botId: privateId } });
    const result = await call(client, "sentinel.delegate_to_bot", { botId: privateId, task: "please make a reel", parentTaskId: root.id });
    expect(result.isError).toBe(true);
    expect(errorText(result)).toMatch(/parentTaskId can only be supplied by the bot that is executing that task/);
    expect(await db.orchestrationRun.count({ where: { botId: privateId } })).toBe(before);
    await db.orchestrationRun.update({ where: { id: root.id }, data: { status: "cancelled", completedAt: new Date() } }); // free the bot's concurrency slot
  });

  it("sync mode waits for a REAL execution to finish and returns the bot's output", async () => {
    resetScript();
    script.events = turn("Concept A: storm hook. Concept B: cutaway. Concept C: side-by-side.");
    const client = await connect(principal());
    const delegated = call(client, "sentinel.delegate_to_bot", { botId: forgeId, task: "Give me three concepts for a 15-second ad.", mode: "sync" });
    // A worker picks the queued run up while the caller waits.
    const worker = (async () => {
      for (let attempt = 0; attempt < 40; attempt += 1) {
        const run = await db.orchestrationRun.findFirst({ where: { botId: forgeId, status: "queued", request: { path: ["task"], equals: "Give me three concepts for a 15-second ad." } } });
        if (run) { await executeOrchestrationRun(run.id, "mcp-test-worker"); return run.id; }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      throw new Error("run never appeared");
    })();
    const [result] = await Promise.all([delegated, worker]);
    expect(structured(result).task).toMatchObject({ status: "COMPLETED", output: { text: expect.stringContaining("Concept A") }, usage: { totalTokens: 1280 } });
  }, 30_000);

  it("enforces OAuth scopes per tool", async () => {
    const readOnly = await connect(principal({ scopes: ["sentinel.read"] }));
    expect(structured(await call(readOnly, "sentinel.list_bots", {})).bots).toBeTruthy();
    const noWrite = await call(readOnly, "sentinel.delegate_to_bot", { botId: forgeId, task: "please make a reel" });
    expect(noWrite.isError).toBe(true);
    expect(errorText(noWrite)).toMatch(/Missing required scope: sentinel.tasks.write/);
    const noRead = await call(readOnly, "sentinel.get_bot_task_status", { taskId: "x" });
    expect(noRead.isError).toBe(true);
    expect(errorText(noRead)).toMatch(/sentinel.tasks.read/);
  });

  it("another user cannot read or cancel a task they did not delegate", async () => {
    const client = await connect(principal());
    const task = structured(await call(client, "sentinel.delegate_to_bot", { botId: forgeId, task: "private work item here" })).task;
    const stranger = await db.user.create({ data: { email: `mcp-stranger-${Date.now()}@test.sentinel` } });
    const foreign = await connect(principal({ userId: stranger.id }));
    const read = await call(foreign, "sentinel.get_bot_task_status", { taskId: task.id });
    expect(read.isError).toBe(true);
    expect(errorText(read)).toMatch(/Task not found/);
    expect((await call(foreign, "sentinel.cancel_bot_task", { taskId: task.id })).isError).toBe(true);
  });

  it("does not expose the delegating tools' internals: prompts, policies, event payloads", async () => {
    const client = await connect(principal());
    const task = structured(await call(client, "sentinel.delegate_to_bot", { botId: forgeId, task: "another work item now" })).task;
    expect(Object.keys(task).sort()).toEqual(["artifacts", "botId", "botName", "cost", "createdAt", "error", "finishedAt", "id", "model", "output", "startedAt", "status", "toolCalls", "usage", "waitingFor"]);
  });
});
