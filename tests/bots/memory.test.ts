import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/agents/runtime/service", async () => (await import("./fake-runtime")).serviceMock);
vi.mock("@/lib/orchestration/queue", () => ({ enqueueOrchestrationRun: vi.fn().mockResolvedValue(undefined) }));

import { db } from "@/lib/db";
import { readBotMemory, writeBotMemory } from "@/lib/bots/memory";
import { createBot, toBotRecord, type BotRecord } from "@/lib/bots/service";
import type { BotMemoryPolicy } from "@/lib/bots/schema";
import { botInput, makeWorkspace } from "./fixtures";

const QUERY = "hurricane ICF framing";
let owner: { id: string }; let workspace: { id: string }; let project: { id: string };
let botA: BotRecord; let botB: BotRecord;
const ids: Record<string, string> = {};

const mem = (over: Record<string, unknown>) => db.memory.create({ data: { type: "semantic", owner: owner.id, tags: [], source: "test", ...over } as never });
const withPolicy = (bot: BotRecord, policy: Partial<BotMemoryPolicy>): BotRecord => ({ ...bot, memoryPolicy: { ...bot.memoryPolicy, ...policy } });
async function retrievedFor(bot: BotRecord, policy: Partial<BotMemoryPolicy>, userId = owner.id, runId = `run-${Math.random()}`) {
  const result = await readBotMemory(withPolicy(bot, policy), { userId, query: QUERY, projectId: project.id, workspaceId: workspace.id, runId });
  const found = Object.entries(ids).filter(([, id]) => result.text.includes(`[${id}]`) || false).map(([name]) => name);
  return { result, found, text: result.text };
}

beforeAll(async () => {
  ({ owner, workspace } = await makeWorkspace());
  project = await db.project.create({ data: { name: "Titan", userId: owner.id, workspaceId: workspace.id } });
  botA = await createBot(botInput(workspace.id, { name: "MemA" }), owner.id);
  botB = await createBot(botInput(workspace.id, { name: "MemB" }), owner.id);
  ids.user = (await mem({ scope: "user", content: "Titan ICF walls survive hurricane wind loads better than wood framing in every test." })).id;
  ids.global = (await mem({ scope: "global", content: "Hurricane guidance: ICF framing outperforms conventional wood framing in storms." })).id;
  ids.project = (await mem({ scope: "project", projectId: project.id, content: "Project Titan hurricane reel: lead with the ICF versus wood framing comparison." })).id;
  ids.workspace = (await mem({ scope: "workspace", workspaceId: workspace.id, content: "Workspace brand rule: hurricane ICF framing claims must cite the testing." })).id;
  ids.botA = (await mem({ scope: "bot", botId: botA.id, content: "Bot A private note: hurricane ICF framing hooks tested best with storm footage." })).id;
  ids.botB = (await mem({ scope: "bot", botId: botB.id, content: "Bot B private note: hurricane ICF framing needs a calmer voiceover." })).id;
  ids.banana = (await mem({ scope: "user", content: "Banana bread recipe uses three ripe bananas and walnuts." })).id;
});

/** The assembled block cites memories by content; match on distinctive phrases. */
const PHRASES: Record<string, string> = {
  user: "wind loads", global: "Hurricane guidance", project: "Project Titan hurricane reel", workspace: "brand rule",
  botA: "Bot A private note", botB: "Bot B private note", banana: "Banana bread",
};
const seen = (text: string) => Object.keys(PHRASES).filter((name) => text.includes(PHRASES[name]));

describe("bot memory READ scopes", () => {
  it("bot scope: only this bot's own private memory, never another bot's or shared memory", async () => {
    const { text } = await retrievedFor(botA, { readScopes: ["bot"] });
    expect(seen(text)).toEqual(["botA"]);
  });

  it("another bot never sees this bot's private memory", async () => {
    const { text } = await retrievedFor(botB, { readScopes: ["bot"] });
    expect(seen(text)).toEqual(["botB"]);
  });

  it("each shared scope is opened only by naming it", async () => {
    expect(seen((await retrievedFor(botA, { readScopes: ["user"] })).text)).toEqual(expect.arrayContaining(["user"]));
    expect(seen((await retrievedFor(botA, { readScopes: ["user"] })).text)).not.toEqual(expect.arrayContaining(["global", "project", "workspace", "botA", "botB"]));
    expect(seen((await retrievedFor(botA, { readScopes: ["global"] })).text)).toEqual(["global"]);
    expect(seen((await retrievedFor(botA, { readScopes: ["project"] })).text)).toEqual(["project"]);
    expect(seen((await retrievedFor(botA, { readScopes: ["workspace"] })).text)).toEqual(["workspace"]);
  });

  it("all scopes together include shared and own-private memory, but still not another bot's", async () => {
    const { text } = await retrievedFor(botA, { readScopes: ["bot", "session", "project", "workspace", "organization", "user", "global"], maxItems: 20 });
    expect(seen(text)).toEqual(expect.arrayContaining(["user", "global", "project", "workspace", "botA"]));
    expect(seen(text)).not.toContain("botB");
  });

  it("no scopes, or memory disabled, reads nothing and says why", async () => {
    const none = await retrievedFor(botA, { readScopes: [] });
    expect(none.text).toBe("");
    expect(none.result.skipped).toMatch(/no read scopes/);
    const off = await retrievedFor(botA, { enabled: false, readScopes: ["bot", "user"] });
    expect(off.text).toBe("");
    expect(off.result.skipped).toMatch(/disabled/);
  });

  it("naming a workspace the user cannot read yields nothing, however the policy is set", async () => {
    const stranger = await makeWorkspace();
    const result = await readBotMemory(withPolicy(botA, { readScopes: ["workspace"] }), { userId: owner.id, query: QUERY, workspaceId: stranger.workspace.id, runId: "r-x" });
    expect(seen(result.text)).toEqual([]);
  });

  it("another user of the same bot does not inherit this user's bot memory", async () => {
    const other = await db.user.create({ data: { email: `mem-other-${Date.now()}@test.sentinel` } });
    const result = await readBotMemory(withPolicy(botA, { readScopes: ["bot", "user"] }), { userId: other.id, query: QUERY, runId: "r-y" });
    expect(seen(result.text)).toEqual([]);
  });

  it("relevance threshold is a fraction of the best possible score", async () => {
    const loose = await retrievedFor(botA, { readScopes: ["user"], minRelevance: 0, maxItems: 10 });
    expect(seen(loose.text)).toContain("user");
    const strict = await retrievedFor(botA, { readScopes: ["user"], minRelevance: 0.99, maxItems: 10 });
    expect(strict.text).toBe("");
  });

  it("respects maxItems", async () => {
    const one = await retrievedFor(botA, { readScopes: ["bot", "user", "global", "project", "workspace"], maxItems: 1 });
    expect(one.result.retrieved).toBe(1);
  });

  it("governance still applies: quarantined, expired and archived bot memory is not read", async () => {
    const quarantined = await mem({ scope: "bot", botId: botA.id, state: "quarantined", content: "Quarantined bot note: hurricane ICF framing is a myth." });
    const expired = await mem({ scope: "bot", botId: botA.id, expiresAt: new Date(Date.now() - 86_400_000), content: "Expired bot note: hurricane ICF framing rule from last year." });
    const superseded = await mem({ scope: "bot", botId: botA.id, validTo: new Date(Date.now() - 86_400_000), content: "Superseded bot note: hurricane ICF framing rule replaced." });
    const archived = await mem({ scope: "bot", botId: botA.id, archived: true, content: "Archived bot note: hurricane ICF framing old draft." });
    const { text } = await retrievedFor(botA, { readScopes: ["bot"], maxItems: 20 });
    for (const row of [quarantined, expired, superseded, archived]) expect(text).not.toContain(row.content.slice(0, 20));
    expect(seen(text)).toEqual(["botA"]);
  });

  it("records what it retrieved against the run, attributable to the consumer", async () => {
    const runId = "run-attributed-1";
    await retrievedFor(botA, { readScopes: ["bot"] }, owner.id, runId);
    const rows = await db.memoryRetrieval.findMany({ where: { runId } });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.consumer === "orchestration")).toBe(true);
  });
});

describe("bot memory WRITE scopes", () => {
  const FACT = "The Titan ICF wall system is rated for sustained 250 mph winds, and this is the claim brand copy must cite.";

  it("writes to the bot's own scope, attributed, with retention applied", async () => {
    const write = await writeBotMemory(withPolicy(botA, { writeScopes: ["bot"], retentionDays: 30 }), { userId: owner.id, runId: "w1", content: FACT, tags: ["reel"] });
    expect(write, JSON.stringify(write)).toMatchObject({ attempted: true, scope: "bot", accepted: true });
    const row = await db.memory.findUniqueOrThrow({ where: { id: write.memoryId! } });
    expect(row).toMatchObject({ scope: "bot", botId: botA.id, owner: owner.id, source: `bot:${botA.id}` });
    expect(row.tags).toEqual(expect.arrayContaining(["reel", `bot:${botA.slug}`, "run:w1"]));
    // Retention is its own deadline. validTo means "superseded", and every current-truth read excludes it.
    expect(row.validTo).toBeNull();
    const days = (row.expiresAt!.getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(29); expect(days).toBeLessThan(31);
  });

  it("a retained memory is readable until it expires, and not after", async () => {
    const policy = withPolicy(botA, { writeScopes: ["bot"], readScopes: ["bot"], retentionDays: 30 });
    const fact = "The Titan ICF retention probe says hurricane ICF framing reels must open on the storm-surge shot.";
    const write = await writeBotMemory(policy, { userId: owner.id, runId: "ret-1", content: fact });
    expect(write.accepted, JSON.stringify(write)).toBe(true);

    const fresh = await readBotMemory(policy, { userId: owner.id, query: QUERY, runId: "ret-read-1" });
    expect(fresh.text).toContain("retention probe");

    // 31 days on, the same row is past its deadline.
    await db.memory.update({ where: { id: write.memoryId! }, data: { expiresAt: new Date(Date.now() - 60_000) } });
    const expired = await readBotMemory(policy, { userId: owner.id, query: QUERY, runId: "ret-read-2" });
    expect(expired.text).not.toContain("retention probe");
  });

  it("a retention deadline never makes a superseded, quarantined, forgotten or shadow memory readable", async () => {
    const future = new Date(Date.now() + 30 * 86_400_000);
    const rows = {
      superseded: await mem({ scope: "bot", botId: botA.id, expiresAt: future, validTo: new Date(Date.now() - 1_000), supersededById: "newer", content: "Governance probe superseded: hurricane ICF framing." }),
      quarantined: await mem({ scope: "bot", botId: botA.id, expiresAt: future, state: "quarantined", content: "Governance probe quarantined: hurricane ICF framing." }),
      forgotten: await mem({ scope: "bot", botId: botA.id, expiresAt: future, state: "forgotten", content: "Governance probe forgotten: hurricane ICF framing." }),
      shadow: await mem({ scope: "bot", botId: botA.id, expiresAt: future, shadowOnly: true, content: "Governance probe shadow: hurricane ICF framing." }),
      current: await mem({ scope: "bot", botId: botA.id, expiresAt: future, content: "Governance probe current: hurricane ICF framing is retained." }),
    };
    const { text } = await retrievedFor(botA, { readScopes: ["bot"], maxItems: 30 });
    expect(text).toContain("Governance probe current");
    for (const name of ["superseded", "quarantined", "forgotten", "shadow"] as const) expect(text, name).not.toContain(rows[name].content.slice(0, 26));
  });

  it("denies a scope the policy does not grant, before anything is stored", async () => {
    const before = await db.memory.count();
    const write = await writeBotMemory(withPolicy(botA, { writeScopes: ["bot"] }), { userId: owner.id, runId: "w2", content: FACT, scope: "workspace", workspaceId: workspace.id });
    expect(write).toMatchObject({ attempted: false, accepted: false, scope: "workspace" });
    expect(write.denied).toMatch(/not permitted by this bot's memory policy/);
    expect(await db.memory.count()).toBe(before);
  });

  it("disabled memory and empty write scopes write nothing", async () => {
    expect((await writeBotMemory(withPolicy(botA, { enabled: false }), { userId: owner.id, runId: "w3", content: FACT })).denied).toMatch(/disabled/);
    expect((await writeBotMemory(withPolicy(botA, { writeScopes: [] }), { userId: owner.id, runId: "w4", content: FACT })).denied).toMatch(/no write scopes/);
  });

  it("scopes that need a project/workspace/room are refused when the task has none", async () => {
    expect((await writeBotMemory(withPolicy(botA, { writeScopes: ["project"] }), { userId: owner.id, runId: "w5", content: FACT })).denied).toMatch(/needs a project/);
    expect((await writeBotMemory(withPolicy(botA, { writeScopes: ["workspace"] }), { userId: owner.id, runId: "w6", content: FACT })).denied).toMatch(/needs a workspace/);
    expect((await writeBotMemory(withPolicy(botA, { writeScopes: ["session"] }), { userId: owner.id, runId: "w7", content: FACT })).denied).toMatch(/chat room/);
  });

  it("a shared-scope write stays attributable to the bot, and other bots then retrieve it through normal retrieval", async () => {
    const write = await writeBotMemory(withPolicy(botA, { writeScopes: ["workspace"] }), {
      userId: owner.id, runId: "w8", workspaceId: workspace.id,
      content: "Titan's preferred reel length is 20 seconds, and the brand voice is blunt and confident.",
    });
    expect(write).toMatchObject({ scope: "workspace", accepted: true });
    const row = await db.memory.findUniqueOrThrow({ where: { id: write.memoryId! } });
    expect(row).toMatchObject({ scope: "workspace", workspaceId: workspace.id, botId: botA.id });
    const other = await readBotMemory(withPolicy(botB, { readScopes: ["workspace"], maxItems: 10 }), { userId: owner.id, query: "Titan preferred reel length brand voice", workspaceId: workspace.id, runId: "r-shared" });
    expect(other.text).toContain("preferred reel length is 20 seconds");
  });

  it("a write from a user without workspace write access is refused by the existing scope check", async () => {
    const outsider = await db.user.create({ data: { email: `mem-out-${Date.now()}@test.sentinel` } });
    const write = await writeBotMemory(withPolicy(botA, { writeScopes: ["workspace"] }), { userId: outsider.id, runId: "w9", workspaceId: workspace.id, content: FACT });
    expect(write.accepted).toBe(false);
    expect(write.denied).toMatch(/Not authorised/);
  });

  it("the ingestion gate still declines junk, and the bot is told", async () => {
    const write = await writeBotMemory(withPolicy(botA, { writeScopes: ["bot"] }), { userId: owner.id, runId: "w10", content: "ok" });
    expect(write.attempted).toBe(true);
    expect(write.accepted).toBe(false);
    expect(write.denied).toBeUndefined();
    expect(write.reasons.length).toBeGreaterThan(0);
  });
});

describe("stored policy round-trips", () => {
  it("memory policy survives persistence unchanged", async () => {
    const reread = toBotRecord(await db.bot.findUniqueOrThrow({ where: { id: botA.id } }));
    expect(reread.memoryPolicy).toEqual(botA.memoryPolicy);
  });
});
