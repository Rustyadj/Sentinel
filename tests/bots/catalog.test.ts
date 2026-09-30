import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

vi.mock("@/lib/agents/runtime/service", async () => (await import("./fake-runtime")).serviceMock);
vi.mock("@/lib/orchestration/queue", () => ({ enqueueOrchestrationRun: vi.fn().mockResolvedValue(undefined) }));

import { db } from "@/lib/db";
import { assertSafeMcpUrl, deleteMcpServer, loadCatalog, refreshMcpServer, registerMcpServer, setMcpServerEnabled } from "@/lib/bots/catalog";
import { executeOrchestrationRun } from "@/lib/orchestration/executor";
import { createBot, grantToolPermission } from "@/lib/bots/service";
import { delegateToBot, getBotTask } from "@/lib/bots/tasks";
import { botInput, makeWorkspace } from "./fixtures";
import { resetScript, script, toolCall, turn } from "./fake-runtime";

/** A genuine MCP server over HTTP with annotated tools, standing in for a creative-production provider. */
function buildProvider() {
  const server = new McpServer({ name: "creative-provider", version: "1.0.0" });
  server.registerTool("list_styles", { description: "List visual styles", inputSchema: z.object({}), annotations: { readOnlyHint: true } }, async () => ({ content: [{ type: "text", text: "cinematic, ugc" }] }));
  server.registerTool("generate_video", { description: "Generate a video", inputSchema: z.object({ prompt: z.string() }), annotations: { readOnlyHint: false, destructiveHint: false } }, async () => ({ content: [{ type: "text", text: "queued" }] }));
  server.registerTool("unlabeled_tool", { description: "No annotations", inputSchema: z.object({}) }, async () => ({ content: [{ type: "text", text: "?" }] }));
  return server;
}

let httpServer: http.Server; let baseUrl: string; let requiredAuth: string | null = null; let requests = 0;
let owner: { id: string }; let workspace: { id: string };

beforeAll(async () => {
  process.env.MCP_CATALOG_ALLOW_PRIVATE = "1";
  httpServer = http.createServer(async (req, res) => {
    requests += 1;
    if (requiredAuth && req.headers.authorization !== `Bearer ${requiredAuth}`) { res.writeHead(401).end(); return; }
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    const server = buildProvider();
    await server.connect(transport);
    res.on("close", () => { void transport.close(); void server.close(); });
    await transport.handleRequest(req, res, chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : undefined);
  });
  await new Promise<void>((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}/mcp`;
  ({ owner, workspace } = await makeWorkspace());
});
afterAll(async () => { delete process.env.MCP_CATALOG_ALLOW_PRIVATE; await new Promise((resolve) => httpServer.close(resolve)); });
beforeEach(() => { resetScript(); requiredAuth = null; delete process.env.TEST_PROVIDER_KEY; });

describe("outbound MCP server registration", () => {
  it("refuses private/loopback targets unless the operator has allowed them, and never embeds credentials", async () => {
    delete process.env.MCP_CATALOG_ALLOW_PRIVATE;
    await expect(assertSafeMcpUrl("http://127.0.0.1:9/mcp")).rejects.toThrow(/https/);
    await expect(assertSafeMcpUrl("https://127.0.0.1/mcp")).rejects.toThrow(/private or loopback/);
    await expect(assertSafeMcpUrl("https://169.254.169.254/latest")).rejects.toThrow(/private or loopback/);
    await expect(assertSafeMcpUrl("https://[::1]/mcp")).rejects.toThrow(/private or loopback/);
    await expect(assertSafeMcpUrl("https://user:pass@example.com/mcp")).rejects.toThrow(/credentials/);
    process.env.MCP_CATALOG_ALLOW_PRIVATE = "1";
  });

  it("registers a server and discovers its real tools, with read-only status from the server's own annotations", async () => {
    const row = await registerMcpServer({ workspaceId: workspace.id, name: "Creative Provider", url: baseUrl, capabilityTags: ["Video-Generation", "image-generation"] }, owner.id);
    expect(row).toMatchObject({ slug: "creative-provider", status: "unverified", capabilityTags: ["video-generation", "image-generation"] });
    expect(row.tools).toEqual([]); // nothing is assumed before discovery

    const discovered = await refreshMcpServer(row.id, workspace.id, owner.id);
    expect(discovered.status).toBe("connected");
    const tools = discovered.tools as Array<{ name: string; readOnly: boolean | null }>;
    expect(tools.map((tool) => [tool.name, tool.readOnly]).sort()).toEqual([["generate_video", false], ["list_styles", true], ["unlabeled_tool", null]]);
    expect(discovered.lastDiscoveredAt).not.toBeNull();

    const catalog = await loadCatalog(workspace.id);
    const entry = catalog.find((server) => server.id === row.id)!;
    expect(entry).toMatchObject({ kind: "registered", name: "Creative Provider", enabled: true });
    expect(entry.tools).toHaveLength(3);
    expect(catalog.map((server) => server.kind)).toEqual(expect.arrayContaining(["sentinel", "hermes-builtin"]));
  });

  it("rejects duplicate and reserved names and a non-env secret", async () => {
    await expect(registerMcpServer({ workspaceId: workspace.id, name: "Creative Provider", url: baseUrl }, owner.id)).rejects.toThrow(/already registered/);
    await expect(registerMcpServer({ workspaceId: workspace.id, name: "Sentinel", url: baseUrl }, owner.id)).rejects.toThrow(/reserved/);
    await expect(registerMcpServer({ workspaceId: workspace.id, name: "Keyed", url: baseUrl, authMode: "bearer-env", secretEnvVar: "sk-live-abc123" }, owner.id)).rejects.toThrow(/UPPER_SNAKE_CASE/);
  });

  it("authenticates with a bearer token read from the environment, and stores no secret", async () => {
    requiredAuth = "s3cret-token";
    const row = await registerMcpServer({ workspaceId: workspace.id, name: "Keyed Provider", url: baseUrl, authMode: "bearer-env", secretEnvVar: "TEST_PROVIDER_KEY" }, owner.id);
    const missing = await refreshMcpServer(row.id, workspace.id, owner.id);
    expect(missing).toMatchObject({ status: "error", lastError: expect.stringMatching(/TEST_PROVIDER_KEY is not set/) });
    process.env.TEST_PROVIDER_KEY = "wrong";
    expect((await refreshMcpServer(row.id, workspace.id, owner.id)).status).toBe("error");
    process.env.TEST_PROVIDER_KEY = "s3cret-token";
    const ok = await refreshMcpServer(row.id, workspace.id, owner.id);
    expect(ok.status).toBe("connected");
    expect(JSON.stringify(ok)).not.toContain("s3cret-token");
    // Same tool names as "Creative Provider": remove it so later tests are unambiguous.
    await deleteMcpServer(row.id, workspace.id, owner.id);
  });

  it("when two servers expose the same tool name, a grant on only one of them does not cover the call", async () => {
    const [a, b] = await Promise.all(["Twin A", "Twin B"].map((name) => registerMcpServer({ workspaceId: workspace.id, name, url: baseUrl }, owner.id)));
    await refreshMcpServer(a.id, workspace.id, owner.id); await refreshMcpServer(b.id, workspace.id, owner.id);
    const bot = await createBot(botInput(workspace.id, { name: "Ambiguity", status: "active" }), owner.id);
    await grantToolPermission(bot.id, { serverId: a.id, toolName: "*", permission: "read" }, owner.id);
    script.events = toolCall("list_styles");
    const queued = await delegateToBot(bot.id, { task: "list styles from either twin" }, { kind: "user", userId: owner.id });
    await executeOrchestrationRun(queued.id, "catalog-worker-twin");
    expect((await getBotTask(queued.id, { userId: owner.id, isAdmin: true })).error).toMatch(/list_styles is not permitted/);
    await deleteMcpServer(a.id, workspace.id, owner.id); await deleteMcpServer(b.id, workspace.id, owner.id);
  });
});

describe("granting and enforcing discovered tools", () => {
  it("a read grant on the server allows its read-only tool and denies the rest — enforced on a real run", async () => {
    const server = (await db.mcpServerRegistration.findFirstOrThrow({ where: { workspaceId: workspace.id, slug: "creative-provider" } }));
    const bot = await createBot(botInput(workspace.id, { name: "Uses Provider", status: "active" }), owner.id);
    await grantToolPermission(bot.id, { serverId: server.id, toolName: "*", permission: "read" }, owner.id);

    script.events = [...toolCall("list_styles"), ...turn("styles listed")];
    const queued = await delegateToBot(bot.id, { task: "list the styles please" }, { kind: "user", userId: owner.id });
    await executeOrchestrationRun(queued.id, "catalog-worker-1");
    const ok = await getBotTask(queued.id, { userId: owner.id, isAdmin: true });
    expect(ok.status).toBe("COMPLETED");
    expect(ok.toolCalls[0]).toMatchObject({ tool: "list_styles", server: "Creative Provider", decision: "allowed" });

    resetScript();
    script.events = toolCall("generate_video");
    const second = await delegateToBot(bot.id, { task: "generate a video now" }, { kind: "user", userId: owner.id });
    await executeOrchestrationRun(second.id, "catalog-worker-2");
    const denied = await getBotTask(second.id, { userId: owner.id, isAdmin: true });
    expect(denied.status).toBe("FAILED");
    expect(denied.error).toMatch(/generate_video is not permitted — Read grant does not cover a tool that can change state/);

    // A tool the server never declared as read-only cannot ride a read grant either.
    resetScript();
    script.events = toolCall("unlabeled_tool");
    const third = await delegateToBot(bot.id, { task: "use the unlabeled tool" }, { kind: "user", userId: owner.id });
    await executeOrchestrationRun(third.id, "catalog-worker-3");
    expect((await getBotTask(third.id, { userId: owner.id, isAdmin: true })).error).toMatch(/read-only status is unknown/);
  });

  it("a tool-level execute grant opens exactly one tool of a disabled server grant", async () => {
    const server = (await db.mcpServerRegistration.findFirstOrThrow({ where: { workspaceId: workspace.id, slug: "creative-provider" } }));
    const bot = await createBot(botInput(workspace.id, { name: "Generator", status: "active" }), owner.id);
    await grantToolPermission(bot.id, { serverId: server.id, toolName: "*", permission: "disabled" }, owner.id);
    await grantToolPermission(bot.id, { serverId: server.id, toolName: "generate_video", permission: "execute" }, owner.id);
    script.events = [...toolCall("generate_video"), ...turn("video queued")];
    const queued = await delegateToBot(bot.id, { task: "generate the hero video" }, { kind: "user", userId: owner.id });
    await executeOrchestrationRun(queued.id, "catalog-worker-4");
    expect((await getBotTask(queued.id, { userId: owner.id, isAdmin: true })).status).toBe("COMPLETED");
    resetScript();
    script.events = toolCall("list_styles");
    const other = await delegateToBot(bot.id, { task: "list the styles now" }, { kind: "user", userId: owner.id });
    await executeOrchestrationRun(other.id, "catalog-worker-5");
    expect((await getBotTask(other.id, { userId: owner.id, isAdmin: true })).error).toMatch(/Access is disabled/);
  });

  it("refuses a grant for a tool the server does not expose", async () => {
    const server = (await db.mcpServerRegistration.findFirstOrThrow({ where: { workspaceId: workspace.id, slug: "creative-provider" } }));
    const bot = await createBot(botInput(workspace.id, { name: "Overreach" }), owner.id);
    await expect(grantToolPermission(bot.id, { serverId: server.id, toolName: "delete_everything", permission: "execute" }, owner.id)).rejects.toThrow(/no tool named/);
  });

  it("disabling a server makes its tools ungrantable-in-effect; deleting removes the grants", async () => {
    const server = (await db.mcpServerRegistration.findFirstOrThrow({ where: { workspaceId: workspace.id, slug: "creative-provider" } }));
    const bot = await createBot(botInput(workspace.id, { name: "Loses Server", status: "active" }), owner.id);
    await grantToolPermission(bot.id, { serverId: server.id, toolName: "*", permission: "execute" }, owner.id);
    await setMcpServerEnabled(server.id, workspace.id, false, owner.id);
    script.events = toolCall("list_styles");
    const queued = await delegateToBot(bot.id, { task: "use a disabled server" }, { kind: "user", userId: owner.id });
    await executeOrchestrationRun(queued.id, "catalog-worker-6");
    expect((await getBotTask(queued.id, { userId: owner.id, isAdmin: true })).error).toMatch(/not in any catalog/);

    await deleteMcpServer(server.id, workspace.id, owner.id);
    expect(await db.botToolPermission.count({ where: { botId: bot.id } })).toBe(0);
    expect(requests).toBeGreaterThan(0);
  });
});
