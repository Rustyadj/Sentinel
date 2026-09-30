import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/agents/runtime/service", async () => (await import("./fake-runtime")).serviceMock);
vi.mock("@/lib/orchestration/queue", () => ({ enqueueOrchestrationRun: vi.fn().mockResolvedValue(undefined) }));

import { db } from "@/lib/db";
import { HERMES_BUILTIN_SERVER_ID } from "@/lib/bots/catalog";
import { getRegistryBot, listBotSummaries, listRegistryBots, tokenize } from "@/lib/bots/registry";
import { createBot, disableBot } from "@/lib/bots/service";
import { getBotTemplate } from "@/lib/bots/templates";
import { botInput, makeOutsider, makeWorkspace } from "./fixtures";

let owner: { id: string }; let workspace: { id: string };
const ids: Record<string, string> = {};

async function fromTemplate(templateId: string, name: string, extra: Record<string, unknown> = {}) {
  const template = getBotTemplate(templateId)!;
  return createBot({ ...template.fields, name, workspaceId: workspace.id, runtimeAgentId: "hermes-bot-host", templateId, status: "active", ...extra } as never, owner.id, {
    toolGrants: template.suggestedGrants.map(({ serverId, toolName, permission }) => ({ serverId, toolName, permission })),
  });
}

beforeAll(async () => {
  ({ owner, workspace } = await makeWorkspace());
  ids.forge = (await fromTemplate("creative-production", "Forge", { delegationPolicy: { allowedCallers: ["user", "agent:hermes-lisa"], allowedChildBots: [], canDelegate: false, maxDepth: 1 } })).id;
  ids.scout = (await fromTemplate("research", "Scout")).id;
  ids.beacon = (await fromTemplate("marketing", "Beacon")).id;
  ids.wrench = (await fromTemplate("coding", "Wrench", { delegationPolicy: { allowedCallers: ["agent:hermes-nathan2"], allowedChildBots: [], canDelegate: false, maxDepth: 1 } })).id;
  ids.retired = (await fromTemplate("blank", "Retired", { capabilities: ["video-generation"] })).id;
  await disableBot(ids.retired, owner.id);
});

describe("Bot Registry discovery", () => {
  it("finds the creative bot for the reel request without any bot name being wired anywhere", async () => {
    const found = await listRegistryBots({ userId: owner.id, query: "Make a badass 20-second Titan ICF Reel showing why ICF survives severe weather better than conventional framing", callableBy: `user:${owner.id}` });
    expect(found[0]).toMatchObject({ id: ids.forge, name: "Forge", role: "Creative Production Director" });
    expect(found[0].matchedOn).toEqual(expect.arrayContaining(["responsibility"]));
  });

  it("ranks by what the job is: research goes to the research bot, code to the coding bot", async () => {
    expect((await listRegistryBots({ userId: owner.id, query: "research competitor pricing on the web and cite sources", callableBy: `user:${owner.id}` }))[0].id).toBe(ids.scout);
    expect((await listRegistryBots({ userId: owner.id, query: "debug this repository and refactor the code" }))[0].id).toBe(ids.wrench);
    expect((await listRegistryBots({ userId: owner.id, query: "plan an SEO content campaign" }))[0].id).toBe(ids.beacon);
  });

  it("returns nothing when nothing matches, instead of the least-bad bot", async () => {
    expect(await listRegistryBots({ userId: owner.id, query: "quantum chromodynamics lattice simulation" })).toEqual([]);
  });

  it("filters by exact capability", async () => {
    const found = await listRegistryBots({ userId: owner.id, capability: "video-generation" });
    expect(found.map((bot) => bot.id)).toEqual([ids.forge]); // the disabled bot with the same capability is not discoverable
  });

  it("only shows a caller the bots that would accept it", async () => {
    const lisa = await listRegistryBots({ userId: owner.id, callableBy: "agent:hermes-lisa" });
    expect(lisa.map((bot) => bot.name)).toEqual(["Forge"]);
    const nathan = await listRegistryBots({ userId: owner.id, callableBy: "agent:hermes-nathan2" });
    expect(nathan.map((bot) => bot.name)).toEqual(["Wrench"]);
    const anyone = await listRegistryBots({ userId: owner.id });
    expect(anyone.map((bot) => bot.name).sort()).toEqual(["Beacon", "Forge", "Scout", "Wrench"]);
  });

  it("hides inactive bots from discovery but not from admin views", async () => {
    expect((await listRegistryBots({ userId: owner.id })).some((bot) => bot.id === ids.retired)).toBe(false);
    expect((await listRegistryBots({ userId: owner.id, includeInactive: true })).some((bot) => bot.id === ids.retired)).toBe(true);
    expect(await getRegistryBot(owner.id, ids.retired)).toBeNull();
    expect(await getRegistryBot(owner.id, ids.retired, true)).toMatchObject({ status: "disabled" });
  });

  it("exposes the fields an agent needs to choose: capabilities, skills, tools, model, memory, delegation, host, load", async () => {
    const forge = await getRegistryBot(owner.id, ids.forge);
    expect(forge).toMatchObject({
      capabilities: expect.arrayContaining(["image-generation", "video-generation", "ad-creative"]),
      memory: { enabled: true, read: expect.arrayContaining(["bot", "project"]), write: ["bot"] },
      delegation: { canDelegate: false, allowedChildBots: [] },
      host: { agentId: "hermes-bot-host", dispatchable: true },
      load: { inFlight: 0, maxConcurrent: 2 },
      status: "active",
    });
    expect(forge!.tools).toEqual(expect.arrayContaining([expect.objectContaining({ server: "Hermes built-in tools", serverId: HERMES_BUILTIN_SERVER_ID, tool: "read_file", permission: "read" })]));
    expect(forge!.mcpServers).toEqual(["Hermes built-in tools"]);
  });

  it("does not reveal prompts or policy internals in the registry view", async () => {
    const forge = await getRegistryBot(owner.id, ids.forge);
    expect(JSON.stringify(forge)).not.toMatch(/systemPrompt|allowedCallers|creative production director\. You turn/i);
  });

  it("does not show a workspace's bots to someone outside it, or bots from another workspace to its members", async () => {
    const outsider = await makeOutsider();
    expect(await listRegistryBots({ userId: outsider.id })).toEqual([]);
    const other = await makeWorkspace();
    await createBot(botInput(other.workspace.id, { name: "Elsewhere", status: "active", capabilities: ["video-generation"] }), other.owner.id);
    expect((await listRegistryBots({ userId: owner.id, capability: "video-generation" })).map((bot) => bot.name)).toEqual(["Forge"]);
    expect(await getRegistryBot(outsider.id, ids.forge)).toBeNull();
  });

  it("reports load as tasks are queued", async () => {
    await db.orchestrationRun.create({ data: { userId: owner.id, workspaceId: workspace.id, botId: ids.scout, request: { task: "busy" }, status: "running" } });
    expect((await getRegistryBot(owner.id, ids.scout))!.load.inFlight).toBe(1);
  });
});

describe("Bots screen summaries", () => {
  it("reports the card fields from real state", async () => {
    const summaries = await listBotSummaries([workspace.id]);
    const scout = summaries.find((entry) => entry.bot.id === ids.scout)!;
    expect(scout).toMatchObject({
      host: { agentId: "hermes-bot-host", enabled: true, executionVerified: true },
      memory: { enabled: true },
      currentTask: expect.objectContaining({ status: "running", task: "busy" }),
      usageToday: { tokens: 0, costUsd: 0 },
    });
    expect(scout.servers).toEqual([{ id: HERMES_BUILTIN_SERVER_ID, name: "Hermes built-in tools", tools: 3 }]);
    expect(scout.lastActiveAt).not.toBeNull();
    expect(summaries.find((entry) => entry.bot.id === ids.beacon)!.lastActiveAt).toBeNull();
  });
});

describe("tokenize", () => {
  it("drops filler and short words", () => {
    expect(tokenize("Please make a badass 20-second Titan ICF Reel")).toEqual(["badass", "second", "titan", "icf", "reel"]);
  });
});
