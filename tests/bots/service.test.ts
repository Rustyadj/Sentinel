import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { adapter, resetScript, script, serviceMock } from "./fake-runtime";

vi.mock("@/lib/agents/runtime/service", async () => (await import("./fake-runtime")).serviceMock);
vi.mock("@/lib/orchestration/queue", () => ({ enqueueOrchestrationRun: vi.fn().mockResolvedValue(undefined) }));

import { db } from "@/lib/db";
import { BotConfigError } from "@/lib/bots/models";
import {
  assignSkill, createBot, deleteBot, disableBot, duplicateBot, enableBot, getBotRow, grantToolPermission, removeSkill,
  revokeToolPermission, toBotRecord, updateBot, updateMemoryPolicy,
} from "@/lib/bots/service";
import { BOT_TEMPLATES } from "@/lib/bots/templates";
import { approveSkill, parseHermesSkill, proposeSkill, rejectSkill, sha256 } from "@/lib/bots/skills";
import { HERMES_BUILTIN_SERVER_ID, SENTINEL_SERVER_ID } from "@/lib/bots/catalog";
import { listBotVersions, restoreBotVersion } from "@/lib/bots/versions";
import { botInput, makeWorkspace } from "./fixtures";

void adapter; void serviceMock;
beforeEach(() => resetScript());

let owner: { id: string }; let workspace: { id: string };
beforeAll(async () => { ({ owner, workspace } = await makeWorkspace()); });

describe("bot creation and persistence", () => {
  it("creates a bot, persists every field, and reads it back from the database", async () => {
    const created = await createBot(botInput(workspace.id, {
      name: "Forge", role: "Creative Production Director", tags: ["creative"], capabilities: ["video-generation"],
      systemPrompt: "Be bold.", responsibilities: ["Hooks"], constraints: ["No fake assets"],
      workflow: [{ id: "s1", label: "Brief", kind: "llm" }, { id: "s2", label: "Assemble", kind: "deterministic" }],
      modelConfig: { primary: "gpt-5.6-luna", fast: "gpt-5.6-luna", effort: "low" },
      memoryPolicy: { readScopes: ["bot", "project"], writeScopes: ["bot"], maxItems: 5, minRelevance: 0.3, retentionDays: 30 },
      limits: { maxConcurrentTasks: 3 },
    }), owner.id);
    expect(created).toMatchObject({ name: "Forge", slug: "forge", status: "draft" });

    const reloaded = toBotRecord((await db.bot.findUniqueOrThrow({ where: { id: created.id } })));
    expect(reloaded.workflow).toHaveLength(2);
    expect(reloaded.memoryPolicy).toMatchObject({ maxItems: 5, minRelevance: 0.3, retentionDays: 30, consolidation: "standard" });
    expect(reloaded.modelConfig).toMatchObject({ primary: "gpt-5.6-luna", effort: "low" });
    expect(reloaded.delegationPolicy.allowedCallers).toEqual(["user"]);
    expect(reloaded.limits.maxConcurrentTasks).toBe(3);
    const audit = await db.auditLog.findFirst({ where: { entityType: "Bot", entityId: created.id, action: "bot.created" } });
    expect(audit?.userId).toBe(owner.id);
  });

  it("gives each bot a unique slug within its workspace", async () => {
    const a = await createBot(botInput(workspace.id, { name: "Twin" }), owner.id);
    const b = await createBot(botInput(workspace.id, { name: "Twin" }), owner.id);
    expect([a.slug, b.slug]).toEqual(["twin", "twin-2"]);
  });

  it("rejects invalid input with a readable message instead of storing it", async () => {
    await expect(createBot(botInput(workspace.id, { name: "" }), owner.id)).rejects.toThrow(/name/);
    await expect(createBot(botInput(workspace.id, { memoryPolicy: { readScopes: ["nope" as never] } }), owner.id)).rejects.toThrow(/readScopes/);
  });

  it("only allows a Hermes runtime as host", async () => {
    await expect(createBot(botInput(workspace.id, { runtimeAgentId: "codex" }), owner.id)).rejects.toThrow(/not an enabled Hermes runtime/);
  });

  it("validates model ids against the same rules as agent model settings", async () => {
    await expect(createBot(botInput(workspace.id, { modelConfig: { primary: "bad model!!" } }), owner.id)).rejects.toThrow(/modelConfig\.primary/);
  });

  it("refuses to create as active when the host has no verified execution contract", async () => {
    script.verified = false;
    await expect(createBot(botInput(workspace.id, { status: "active" }), owner.id)).rejects.toThrow(/no verified execution contract/);
    const draft = await createBot(botInput(workspace.id), owner.id);
    await expect(enableBot(draft.id, owner.id)).rejects.toThrow(/cannot be activated/);
    script.verified = true;
    await expect(enableBot(draft.id, owner.id)).resolves.toMatchObject({ status: "active" });
  });

  it("updates, enables/disables, and audits", async () => {
    const bot = await createBot(botInput(workspace.id), owner.id);
    const updated = await updateBot(bot.id, { role: "Renamed", memoryPolicy: { ...bot.memoryPolicy, maxItems: 3 } }, owner.id);
    expect(updated).toMatchObject({ role: "Renamed", memoryPolicy: expect.objectContaining({ maxItems: 3 }) });
    expect((await enableBot(bot.id, owner.id)).status).toBe("active");
    expect((await disableBot(bot.id, owner.id)).status).toBe("disabled");
    const actions = (await db.auditLog.findMany({ where: { entityType: "Bot", entityId: bot.id } })).map((entry) => entry.action);
    expect(actions).toEqual(expect.arrayContaining(["bot.updated", "bot.enabled", "bot.disabled"]));
  });

  it("keeps immutable checkpoints and restores configuration plus explicit grants", async () => {
    const bot = await createBot(botInput(workspace.id, { name: "Versioned", role: "Original" }), owner.id, {
      toolGrants: [{ serverId: HERMES_BUILTIN_SERVER_ID, toolName: "read_file", permission: "read" }],
    });
    const initial = (await listBotVersions(bot.id)).find((entry) => entry.reason === "created")!;
    await updateBot(bot.id, { role: "Changed" }, owner.id);
    await grantToolPermission(bot.id, { serverId: HERMES_BUILTIN_SERVER_ID, toolName: "web_search", permission: "approval" }, owner.id);
    await restoreBotVersion(bot.id, initial.version, owner.id);

    expect((await db.bot.findUniqueOrThrow({ where: { id: bot.id } })).role).toBe("Original");
    expect((await db.botToolPermission.findMany({ where: { botId: bot.id }, orderBy: { toolName: "asc" } })).map((grant) => grant.toolName)).toEqual(["read_file"]);
    expect((await listBotVersions(bot.id))[0].reason).toBe(`rollback:${initial.version}`);
    expect(await db.auditLog.findFirst({ where: { entityId: bot.id, action: "bot.version_restored" } })).not.toBeNull();
  });
});

describe("duplicate and delete", () => {
  it("duplicates config, grants and skills, but the copy starts as a draft with only 'user' as caller", async () => {
    const source = await createBot(botInput(workspace.id, { name: "Original", delegationPolicy: { allowedCallers: ["agent:hermes-lisa"], allowedChildBots: [], canDelegate: false, maxDepth: 1 } }), owner.id, {
      toolGrants: [{ serverId: HERMES_BUILTIN_SERVER_ID, toolName: "read_file", permission: "read" }],
    });
    await enableBot(source.id, owner.id);
    const copy = await duplicateBot(source.id, owner.id);
    expect(copy).toMatchObject({ name: "Original (copy)", status: "draft" });
    expect(copy.delegationPolicy.allowedCallers).toEqual(["user"]);
    const grants = await db.botToolPermission.findMany({ where: { botId: copy.id } });
    expect(grants.map((grant) => [grant.serverId, grant.toolName, grant.permission])).toEqual([[HERMES_BUILTIN_SERVER_ID, "read_file", "read"]]);
  });

  it("refuses to delete a bot with tasks in progress, then deletes with its config", async () => {
    const bot = await createBot(botInput(workspace.id, {}), owner.id, { toolGrants: [{ serverId: SENTINEL_SERVER_ID, toolName: "sentinel.get_task", permission: "read" }] });
    const run = await db.orchestrationRun.create({ data: { userId: owner.id, workspaceId: workspace.id, botId: bot.id, request: { task: "x" }, status: "running" } });
    await expect(deleteBot(bot.id, owner.id)).rejects.toThrow(/in progress/);
    await db.orchestrationRun.update({ where: { id: run.id }, data: { status: "succeeded" } });
    await deleteBot(bot.id, owner.id);
    expect(await db.bot.findUnique({ where: { id: bot.id } })).toBeNull();
    expect(await db.botToolPermission.count({ where: { botId: bot.id } })).toBe(0);
    // History outlives the bot.
    expect(await db.orchestrationRun.findUnique({ where: { id: run.id } })).not.toBeNull();
  });
});

describe("tool permissions", () => {
  it("grants, upserts and revokes, with no access by default", async () => {
    const bot = await createBot(botInput(workspace.id), owner.id);
    expect(await db.botToolPermission.count({ where: { botId: bot.id } })).toBe(0);
    await grantToolPermission(bot.id, { serverId: HERMES_BUILTIN_SERVER_ID, toolName: "*", permission: "read" }, owner.id);
    await grantToolPermission(bot.id, { serverId: HERMES_BUILTIN_SERVER_ID, toolName: "*", permission: "approval" }, owner.id);
    const rows = await db.botToolPermission.findMany({ where: { botId: bot.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0].permission).toBe("approval");
    expect(await revokeToolPermission(bot.id, HERMES_BUILTIN_SERVER_ID, "*", owner.id)).toBe(true);
    expect(await revokeToolPermission(bot.id, HERMES_BUILTIN_SERVER_ID, "*", owner.id)).toBe(false);
  });

  it("refuses grants on servers or tools that do not exist", async () => {
    const bot = await createBot(botInput(workspace.id), owner.id);
    await expect(grantToolPermission(bot.id, { serverId: "ghost", toolName: "*", permission: "read" }, owner.id)).rejects.toThrow(/Unknown tool server/);
    await expect(grantToolPermission(bot.id, { serverId: HERMES_BUILTIN_SERVER_ID, toolName: "rm_rf", permission: "execute" }, owner.id)).rejects.toThrow(/no tool named/);
    await expect(createBot(botInput(workspace.id), owner.id, { toolGrants: [{ serverId: "ghost", toolName: "*", permission: "read" }] })).rejects.toThrow(/Unknown tool server/);
  });

  it("offers no tool that can create bots", async () => {
    const { SENTINEL_MCP_TOOLS } = await import("@/lib/bots/catalog");
    expect(SENTINEL_MCP_TOOLS.some((tool) => /create_bot|update_bot|delete_bot|grant/i.test(tool.name))).toBe(false);
  });
});

describe("memory policy", () => {
  it("merges a partial update and validates it", async () => {
    const bot = await createBot(botInput(workspace.id), owner.id);
    const next = await updateMemoryPolicy(bot.id, { writeScopes: ["bot", "project"], retentionDays: 14 }, owner.id);
    expect(next).toMatchObject({ writeScopes: ["bot", "project"], retentionDays: 14, readScopes: ["bot", "project"] });
    await expect(updateMemoryPolicy(bot.id, { minRelevance: 5 }, owner.id)).rejects.toThrow(/minRelevance/);
    expect(toBotRecord(await db.bot.findUniqueOrThrow({ where: { id: bot.id } })).memoryPolicy.retentionDays).toBe(14);
  });

  it("an unreadable stored delegation policy denies rather than widens", async () => {
    const bot = await createBot(botInput(workspace.id), owner.id);
    await db.bot.update({ where: { id: bot.id }, data: { delegationPolicy: { allowedCallers: "everyone" } } });
    expect(toBotRecord(await db.bot.findUniqueOrThrow({ where: { id: bot.id } })).delegationPolicy.allowedCallers).toEqual([]);
  });
});

describe("templates", () => {
  it("every template produces a valid bot, and the resulting bot is an ordinary one", async () => {
    for (const template of BOT_TEMPLATES) {
      const bot = await createBot({ ...template.fields, name: `${template.fields.name || "Blank"} ${template.id}`, workspaceId: workspace.id, runtimeAgentId: "hermes-bot-host", templateId: template.id }, owner.id, {
        toolGrants: template.suggestedGrants.map(({ serverId, toolName, permission }) => ({ serverId, toolName, permission })),
      });
      expect(bot.status).toBe("draft");
      expect((await getBotRow(bot.id))?.toolPermissions.length).toBe(template.suggestedGrants.length);
    }
  });

  it("the creative template carries the full production workflow with deterministic steps", () => {
    const creative = BOT_TEMPLATES.find((template) => template.id === "creative-production")!;
    const ids = (creative.fields.workflow ?? []).map((step) => step.id);
    expect(ids).toEqual(["brief", "audience", "concepts", "hooks", "script", "storyboard", "assets", "video", "assembly", "qc", "variants", "export"]);
    expect((creative.fields.workflow ?? []).filter((step) => step.kind === "deterministic").map((step) => step.id)).toEqual(["assembly", "export"]);
    // Nothing in the template is coupled to a specific provider.
    expect(JSON.stringify(creative)).not.toMatch(/higgsfield/i);
  });
});

describe("skills: propose, review, approve", () => {
  const SKILL = `---\nname: hook-writer\ndescription: Writes scroll-stopping hooks\nversion: 2\ntools: [web_search]\n---\n# Hook writer\nWrite three hooks under 8 words each.\n`;

  it("parses a Hermes SKILL.md and rejects things that are not one", () => {
    expect(parseHermesSkill(SKILL)).toMatchObject({ name: "hook-writer", version: "2", requiredTools: ["web_search"] });
    expect(() => parseHermesSkill("just markdown")).toThrow(/frontmatter/);
    expect(() => parseHermesSkill("---\nname: x\n---\nbody")).toThrow(/description/);
    expect(() => parseHermesSkill("---\nname: x\ndescription: y\n---\n")).toThrow(/no instructions/);
  });

  it("a proposed skill cannot be assigned until it has been approved against the reviewed digest", async () => {
    const bot = await createBot(botInput(workspace.id), owner.id);
    const review = await proposeSkill(workspace.id, { kind: "inline", content: SKILL }, owner.id);
    expect(review.status).toBe("proposed");
    expect(review.sha256).toBe(sha256(SKILL.trim()));
    await expect(assignSkill(bot.id, review.skillId, owner.id)).rejects.toThrow(/must be reviewed and approved/);

    await expect(approveSkill(review.skillId, workspace.id, "0".repeat(64), owner.id)).rejects.toThrow(/changed since it was reviewed/);
    // A body edited after review, outside the API, must not ride the approval.
    const original = (await db.skill.findUniqueOrThrow({ where: { id: review.skillId } })).body;
    await db.skill.update({ where: { id: review.skillId }, data: { body: "# tampered" } });
    await expect(approveSkill(review.skillId, workspace.id, review.sha256, owner.id)).rejects.toThrow(/no longer matches/);
    await db.skill.update({ where: { id: review.skillId }, data: { body: original } });
    const approved = await approveSkill(review.skillId, workspace.id, review.sha256, owner.id);
    expect(approved.status).toBe("active");
    expect((await db.skill.findUniqueOrThrow({ where: { id: review.skillId } })).reviewedByUserId).toBe(owner.id);

    const result = await assignSkill(bot.id, review.skillId, owner.id);
    expect(result.unmetTools).toEqual(["web_search"]); // needs a grant the bot does not have; reported, not silently granted
    expect(await db.botToolPermission.count({ where: { botId: bot.id } })).toBe(0);
    expect(await removeSkill(bot.id, review.skillId, owner.id)).toBe(true);
  });

  it("a rejected skill is deprecated and detached", async () => {
    const bot = await createBot(botInput(workspace.id), owner.id);
    const review = await proposeSkill(workspace.id, { kind: "inline", content: SKILL.replace("hook-writer", "second") }, owner.id);
    await approveSkill(review.skillId, workspace.id, review.sha256, owner.id);
    await assignSkill(bot.id, review.skillId, owner.id);
    await rejectSkill(review.skillId, workspace.id, owner.id);
    expect((await db.skill.findUniqueOrThrow({ where: { id: review.skillId } })).status).toBe("deprecated");
    expect(await db.botSkill.count({ where: { botId: bot.id } })).toBe(0);
  });

  it("does not assign a skill from another workspace", async () => {
    const other = await makeWorkspace();
    const bot = await createBot(botInput(workspace.id), owner.id);
    const review = await proposeSkill(other.workspace.id, { kind: "inline", content: SKILL.replace("hook-writer", "foreign") }, other.owner.id);
    await approveSkill(review.skillId, other.workspace.id, review.sha256, other.owner.id);
    await expect(assignSkill(bot.id, review.skillId, owner.id)).rejects.toBeInstanceOf(BotConfigError);
  });

  it("never fetches a non-https or private URL", async () => {
    await expect(proposeSkill(workspace.id, { kind: "url", url: "http://example.com/SKILL.md" }, owner.id)).rejects.toThrow(/https/);
    await expect(proposeSkill(workspace.id, { kind: "url", url: "https://127.0.0.1/SKILL.md" }, owner.id)).rejects.toThrow(/private or loopback/);
  });
});
