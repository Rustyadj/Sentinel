import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({ current: null as null | { id: string; role: "owner" | "admin" | "member"; workspaces: string[] } }));
vi.mock("@/lib/agents/permissions", async () => {
  const { canEditConfig } = await import("@/lib/agents/policy");
  const scoped = (workspaceId: string) => session.current && session.current.workspaces.includes(workspaceId) ? { id: session.current.id, email: "t@t", role: session.current.role, workspaceId } : null;
  return {
    canEditConfig,
    getWorkspaceControlPlaneUser: async (workspaceId: string) => scoped(workspaceId),
    getControlPlaneUser: async () => (session.current ? { id: session.current.id, email: "t@t", role: session.current.role, workspaceId: session.current.workspaces[0] } : null),
    getAccessibleWorkspaceIds: async () => session.current?.workspaces ?? [],
  };
});
vi.mock("@/lib/agents/runtime/service", async () => (await import("./fake-runtime")).serviceMock);
vi.mock("@/lib/orchestration/queue", () => ({ enqueueOrchestrationRun: vi.fn().mockResolvedValue(undefined) }));

import { db } from "@/lib/db";
import * as botsRoute from "@/app/api/bots/route";
import * as botRoute from "@/app/api/bots/[id]/route";
import * as actionsRoute from "@/app/api/bots/[id]/actions/route";
import * as toolsRoute from "@/app/api/bots/[id]/tools/route";
import * as memoryRoute from "@/app/api/bots/[id]/memory/route";
import * as skillsRoute from "@/app/api/bots/[id]/skills/route";
import * as testRoute from "@/app/api/bots/[id]/test/route";
import * as tasksRoute from "@/app/api/bots/[id]/tasks/route";
import * as taskRoute from "@/app/api/bots/tasks/[taskId]/route";
import * as skillLibRoute from "@/app/api/bots/skills/route";
import * as skillOneRoute from "@/app/api/bots/skills/[skillId]/route";
import * as generateRoute from "@/app/api/bots/generate/route";
import * as metaRoute from "@/app/api/bots/meta/route";
import * as registryRoute from "@/app/api/bots/registry/route";
import { HERMES_BUILTIN_SERVER_ID } from "@/lib/bots/catalog";
import { botInput, makeOutsider, makeWorkspace } from "./fixtures";
import { resetScript, script } from "./fake-runtime";

let owner: { id: string }; let workspace: { id: string };
const json = (body: unknown, method = "POST") => new Request("http://x/api", { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const ctx = <T extends Record<string, string>>(params: T) => ({ params: Promise.resolve(params) });
const asRole = (role: "owner" | "admin" | "member", workspaces = [workspace.id]) => { session.current = { id: owner.id, role, workspaces }; };

beforeAll(async () => { ({ owner, workspace } = await makeWorkspace()); });
beforeEach(() => { resetScript(); asRole("owner"); });

async function create(over: Record<string, unknown> = {}) {
  const response = await botsRoute.POST(json({ ...botInput(workspace.id), ...over }));
  expect(response.status).toBe(201);
  return (await response.json()).bot as { id: string; name: string; status: string };
}

describe("authorization", () => {
  it("401 signed out, 401 for a non-member, 403 for a plain member, on management routes", async () => {
    session.current = null;
    expect((await botsRoute.POST(json({ ...botInput(workspace.id) }))).status).toBe(401);
    expect((await botsRoute.GET(new Request(`http://x/api/bots?workspaceId=${workspace.id}`))).status).toBe(401);
    session.current = { id: (await makeOutsider()).id, role: "owner", workspaces: [] };
    expect((await botsRoute.POST(json({ ...botInput(workspace.id) }))).status).toBe(401);
    asRole("member");
    expect((await botsRoute.POST(json({ ...botInput(workspace.id) }))).status).toBe(403);
    expect((await botsRoute.GET(new Request(`http://x/api/bots?workspaceId=${workspace.id}`))).status).toBe(403);
    expect((await metaRoute.GET(new Request(`http://x/api/bots/meta?workspaceId=${workspace.id}`))).status).toBe(403);
    expect((await generateRoute.POST(json({ workspaceId: workspace.id, description: "a bot that does things" }))).status).toBe(403);
  });

  it("a member cannot read, edit, delete, grant, test or cancel; a bot in a workspace you are not in reads as 404", async () => {
    const bot = await create();
    asRole("member");
    expect((await botRoute.GET(new Request("http://x"), ctx({ id: bot.id }))).status).toBe(403);
    expect((await botRoute.PUT(json({ role: "x" }, "PUT"), ctx({ id: bot.id }))).status).toBe(403);
    expect((await botRoute.DELETE(new Request("http://x", { method: "DELETE" }), ctx({ id: bot.id }))).status).toBe(403);
    expect((await toolsRoute.PUT(json({ serverId: HERMES_BUILTIN_SERVER_ID, permission: "read" }, "PUT"), ctx({ id: bot.id }))).status).toBe(403);
    expect((await testRoute.POST(json({ prompt: "hello there" }), ctx({ id: bot.id }))).status).toBe(403);
    session.current = { id: owner.id, role: "owner", workspaces: [] };
    expect((await botRoute.GET(new Request("http://x"), ctx({ id: bot.id }))).status).toBe(404);
  });

  it("members can use the registry, and only see bots that accept them", async () => {
    const bot = await create({ status: "active", capabilities: ["reel-making"] });
    asRole("member");
    const listed = await (await registryRoute.GET(new Request("http://x/api/bots/registry?capability=reel-making"))).json();
    expect(listed.bots.map((entry: { id: string }) => entry.id)).toEqual([bot.id]);
    await db.bot.update({ where: { id: bot.id }, data: { delegationPolicy: { allowedCallers: ["agent:someone-else"], allowedChildBots: [], canDelegate: false, maxDepth: 1 } } });
    expect((await (await registryRoute.GET(new Request("http://x/api/bots/registry?capability=reel-making"))).json()).bots).toEqual([]);
  });
});

describe("bot lifecycle over the API", () => {
  it("create → list → get → update → duplicate → enable/disable → delete", async () => {
    const bot = await create({ name: "Lifecycle", toolGrants: [{ serverId: HERMES_BUILTIN_SERVER_ID, toolName: "read_file", permission: "read" }] });
    expect(bot.status).toBe("draft");

    const listed = await (await botsRoute.GET(new Request(`http://x/api/bots?workspaceId=${workspace.id}`))).json();
    expect(listed.bots.find((entry: { bot: { id: string } }) => entry.bot.id === bot.id)).toMatchObject({ host: { executionVerified: true }, servers: [{ id: HERMES_BUILTIN_SERVER_ID, tools: 1 }] });

    const detail = await (await botRoute.GET(new Request("http://x"), ctx({ id: bot.id }))).json();
    expect(detail.grants).toEqual([{ serverId: HERMES_BUILTIN_SERVER_ID, toolName: "read_file", permission: "read" }]);

    const updated = await (await botRoute.PUT(json({ role: "Renamed role" }, "PUT"), ctx({ id: bot.id }))).json();
    expect(updated.bot.role).toBe("Renamed role");

    const copy = await (await actionsRoute.POST(json({ action: "duplicate" }), ctx({ id: bot.id }))).json();
    expect(copy.bot.name).toBe("Lifecycle (copy)");
    expect((await (await actionsRoute.POST(json({ action: "enable" }), ctx({ id: bot.id }))).json()).bot.status).toBe("active");
    expect((await (await actionsRoute.POST(json({ action: "disable" }), ctx({ id: bot.id }))).json()).bot.status).toBe("disabled");
    expect((await actionsRoute.POST(json({ action: "explode" }), ctx({ id: bot.id }))).status).toBe(400);

    expect((await botRoute.DELETE(new Request("http://x", { method: "DELETE" }), ctx({ id: bot.id }))).status).toBe(200);
    expect((await botRoute.GET(new Request("http://x"), ctx({ id: bot.id }))).status).toBe(404);
  });

  it("returns readable 400s for bad input and never a 500 for validation", async () => {
    const response = await botsRoute.POST(json({ ...botInput(workspace.id), name: "" }));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/name/);
    expect((await botsRoute.POST(new Request("http://x", { method: "POST", body: "not json" }))).status).toBe(400);
  });

  it("tool grants and memory policy round-trip", async () => {
    const bot = await create();
    expect((await toolsRoute.PUT(json({ serverId: HERMES_BUILTIN_SERVER_ID, toolName: "*", permission: "approval" }, "PUT"), ctx({ id: bot.id }))).status).toBe(200);
    expect((await toolsRoute.PUT(json({ serverId: "ghost", permission: "read" }, "PUT"), ctx({ id: bot.id }))).status).toBe(400);
    expect((await (await botRoute.GET(new Request("http://x"), ctx({ id: bot.id }))).json()).grants).toHaveLength(1);
    expect((await (await toolsRoute.DELETE(new Request(`http://x?serverId=${HERMES_BUILTIN_SERVER_ID}`, { method: "DELETE" }), ctx({ id: bot.id }))).json()).removed).toBe(true);

    const memory = await (await memoryRoute.PUT(json({ writeScopes: ["bot", "workspace"], minRelevance: 0.4 }, "PUT"), ctx({ id: bot.id }))).json();
    expect(memory.memoryPolicy).toMatchObject({ writeScopes: ["bot", "workspace"], minRelevance: 0.4 });
    expect((await memoryRoute.PUT(json({ readScopes: ["galaxy"] }, "PUT"), ctx({ id: bot.id }))).status).toBe(400);
  });

  it("skill install is two steps: propose, then approve the reviewed digest, then assign", async () => {
    const bot = await create();
    const text = "---\nname: api-skill\ndescription: A skill\n---\nDo the thing carefully.";
    const proposed = await (await skillLibRoute.POST(json({ workspaceId: workspace.id, content: text }))).json();
    expect(proposed.review.status).toBe("proposed");
    expect((await skillsRoute.POST(json({ skillId: proposed.review.skillId }), ctx({ id: bot.id }))).status).toBe(409);
    const review = await (await skillOneRoute.GET(new Request("http://x"), ctx({ skillId: proposed.review.skillId }))).json();
    expect(review.review.body).toBe("Do the thing carefully.");
    expect((await skillOneRoute.POST(json({ action: "approve", sha256: "bad" }), ctx({ skillId: proposed.review.skillId }))).status).toBe(409);
    expect((await skillOneRoute.POST(json({ action: "approve", sha256: review.review.sha256 }), ctx({ skillId: proposed.review.skillId }))).status).toBe(200);
    expect((await skillsRoute.POST(json({ skillId: proposed.review.skillId }), ctx({ id: bot.id }))).status).toBe(201);
    expect((await skillsRoute.PATCH(json({ skillId: proposed.review.skillId, enabled: false }, "PATCH"), ctx({ id: bot.id }))).status).toBe(200);
    expect((await (await skillLibRoute.GET(new Request(`http://x?workspaceId=${workspace.id}`))).json()).skills.find((skill: { id: string }) => skill.id === proposed.review.skillId).assignedBotIds).toEqual([bot.id]);
  });
});

describe("test interface and task control", () => {
  it("runs a draft bot as a real task and returns the inspectable task", async () => {
    const bot = await create({ name: "Testable" });
    const response = await testRoute.POST(json({ prompt: "Create three concepts for a 15-second ICF construction ad." }), ctx({ id: bot.id }));
    expect(response.status).toBe(202);
    const { task } = await response.json();
    expect(task).toMatchObject({ status: "QUEUED", mode: "test", botName: "Testable" });
    const polled = await (await taskRoute.GET(new Request("http://x"), ctx({ taskId: task.id }))).json();
    expect(polled.task.events.map((event: { type: string }) => event.type)).toContain("queued");
    const listing = await (await tasksRoute.GET(new Request("http://x?limit=5"), ctx({ id: bot.id }))).json();
    expect(listing.tasks[0]).toMatchObject({ id: task.id, status: "QUEUED", mode: "test" });
    expect((await (await taskRoute.POST(json({ action: "cancel" }), ctx({ taskId: task.id }))).json())).toMatchObject({ status: "cancelled" });
  });

  it("test needs a prompt", async () => {
    const bot = await create();
    expect((await testRoute.POST(json({}), ctx({ id: bot.id }))).status).toBe(400);
  });
});

describe("meta", () => {
  it("offers real hosts, registry models, templates and the caller choices", async () => {
    const meta = await (await metaRoute.GET(new Request(`http://x/api/bots/meta?workspaceId=${workspace.id}&health=1`))).json();
    expect(meta.hosts).toEqual([{ agentId: "hermes-bot-host", kind: "hermes", executionVerified: true, health: { ready: true } }]);
    expect(meta.models).toMatchObject({ runtimeKind: "hermes", choices: expect.arrayContaining(["gpt-5.6-luna"]), unsupported: ["temperature"] });
    expect(meta.templates.map((template: { id: string }) => template.id)).toEqual(["mobileops-admin", "blank", "research", "creative-production", "coding", "marketing"]);
    expect(meta.memoryScopes).toEqual(["bot", "session", "project", "workspace", "organization", "user", "global"]);
    expect(meta.toolPermissions).toEqual(["disabled", "read", "execute", "approval"]);
    expect(meta.callers.agents).toEqual(["agent:hermes-bot-host"]);
  });
});

describe("Generate Bot Instructions", () => {
  const proposal = {
    name: "Forge", role: "Creative Production Director", description: "Makes ads.", systemPrompt: "Be bold.", mission: "Ship ads.",
    responsibilities: ["Hooks"], constraints: ["No fakes"], outputPreferences: "Concept then script.",
    workflow: [{ id: "brief", label: "Brief", kind: "llm" }, { id: "export", label: "Export", kind: "deterministic" }],
    capabilities: ["video-generation"], tags: ["ads"],
    tools: [
      { server: "Hermes built-in tools", tool: "web_search", permission: "read", why: "references" },
      { server: "Higgsfield", tool: "generate_video", permission: "approval", why: "spends credits" },
      { server: "Hermes built-in tools", tool: "rm_rf", permission: "execute", why: "nope" },
    ],
    skills: ["nonexistent-skill"],
  };

  it("returns a proposal to review, keeps only tools that really exist, and creates and grants nothing", async () => {
    const bots = await db.bot.count(); const grants = await db.botToolPermission.count();
    script.events = [{ type: "assistant_delta", data: { text: `Here you go:\n\`\`\`json\n${JSON.stringify(proposal)}\n\`\`\`` } }, { type: "completed", data: {} }];
    const response = await generateRoute.POST(json({ workspaceId: workspace.id, description: "Create a bot that makes incredible short-form video ads." }));
    expect(response.status).toBe(200);
    const { proposal: result } = await response.json();
    expect(result.fields).toMatchObject({ name: "Forge", role: "Creative Production Director", capabilities: ["video-generation"] });
    expect(result.fields.workflow.map((step: { kind: string }) => step.kind)).toEqual(["llm", "deterministic"]);
    expect(result.suggestedGrants).toEqual([{ serverId: HERMES_BUILTIN_SERVER_ID, serverName: "Hermes built-in tools", toolName: "web_search", permission: "read", why: "references" }]);
    expect(result.dropped).toEqual(expect.arrayContaining(['server "Higgsfield"', "Hermes built-in tools: rm_rf", 'skill "nonexistent-skill"']));
    expect(result.hostAgentId).toBe("hermes-bot-host");
    expect(await db.bot.count()).toBe(bots);
    expect(await db.botToolPermission.count()).toBe(grants);
    // The prompt told the model the catalog and to use no tools.
    expect(script.prompts[0]).toMatch(/Do not call any tools/);
    expect(script.prompts[0]).toContain("Hermes built-in tools: ");
  });

  it("stops the runtime if it reaches for a tool, and says so", async () => {
    script.events = [{ type: "tool_started", data: { name: "terminal" } }];
    const response = await generateRoute.POST(json({ workspaceId: workspace.id, description: "Create a bot that makes incredible short-form video ads." }));
    expect(response.status).toBe(502);
    expect((await response.json()).error).toMatch(/tried to use a tool/);
    expect(script.cancelled).toBe(1);
  });

  it("fails honestly — no invented output — when nothing usable comes back or no runtime is ready", async () => {
    script.events = [{ type: "assistant_delta", data: { text: "I cannot do that." } }];
    expect((await generateRoute.POST(json({ workspaceId: workspace.id, description: "Create a bot that makes incredible short-form video ads." }))).status).toBe(502);
    script.ready = false;
    const notReady = await generateRoute.POST(json({ workspaceId: workspace.id, description: "Create a bot that makes incredible short-form video ads." }));
    expect(notReady.status).toBe(503);
    expect((await notReady.json()).error).toMatch(/not ready|can still start from a template/);
    expect((await generateRoute.POST(json({ workspaceId: workspace.id, description: "short" }))).status).toBe(400);
  });
});
