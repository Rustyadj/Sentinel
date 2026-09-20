// The selective-persistence gate, on the real write path.
//
// `classifyForIngestion` had no callers. Every Memory row was written by a
// direct db.memory.create that asked no questions, so the gate decided nothing
// and rejections left no trace. These tests exercise remember(), which is now
// the governed way an observation becomes memory.

import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { remember, recentIngestionDecisions } from "@/lib/neural-engine/memory-ingestion";
import { MemoryScopeError } from "@/lib/knowledge/memory-scope";

const OWNER = "gate-user";
const OTHER = "gate-other";
const PROJECT = "gate-project";
const WORKSPACE = "gate-workspace";

async function cleanup() {
  await db.memoryIngestionDecision.deleteMany({ where: { owner: { in: [OWNER, OTHER] } } });
  await db.memoryReconsolidation.deleteMany({ where: { memory: { owner: { in: [OWNER, OTHER] } } } });
  await db.memory.deleteMany({ where: { owner: { in: [OWNER, OTHER] } } });
  await db.project.deleteMany({ where: { id: PROJECT } });
  await db.workspace.deleteMany({ where: { id: WORKSPACE } });
  await db.user.deleteMany({ where: { id: { in: [OWNER, OTHER] } } });
}

beforeEach(async () => {
  await cleanup();
  await db.user.create({ data: { id: OWNER, email: "gate@sentinel.test", name: "Gate" } });
  await db.user.create({ data: { id: OTHER, email: "other@sentinel.test", name: "Other" } });
  await db.workspace.create({ data: { id: WORKSPACE, slug: WORKSPACE, name: "W", ownerId: OWNER } });
  await db.project.create({ data: { id: PROJECT, name: "P", userId: OWNER, workspaceId: WORKSPACE } });
});

afterAll(cleanup);

const offer = (content: string, extra: Partial<Parameters<typeof remember>[0]> = {}) =>
  remember({ content, owner: OWNER, speaker: "user", scope: "project", projectId: PROJECT,
    workspaceId: WORKSPACE, ...extra });

describe("what is kept", () => {
  it("keeps a durable project fact and records why", async () => {
    const result = await offer("The Sentinel API gateway is deployed behind Traefik on port 3000.");
    expect(result.accepted).toBe(true);
    expect(result.memoryId).not.toBeNull();

    const decision = await db.memoryIngestionDecision.findUniqueOrThrow({ where: { id: result.decisionId } });
    expect(decision.accepted).toBe(true);
    expect(decision.memoryId).toBe(result.memoryId);
    expect((decision.reasons as string[]).length).toBeGreaterThan(0);
  });

  it("keeps a stated preference", async () => {
    const result = await offer("I prefer concise answers with no preamble.");
    expect(result.accepted).toBe(true);
  });
});

describe("what is rejected", () => {
  it("never stores secret-shaped content, and does not store it in the audit trail either", async () => {
    const result = await offer('The deploy token is ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.');
    expect(result.accepted).toBe(false);
    expect(result.memoryId).toBeNull();

    const decision = await db.memoryIngestionDecision.findUniqueOrThrow({ where: { id: result.decisionId } });
    expect(decision.content).toBe("[redacted: secret-shaped content]");
    expect(decision.content).not.toContain("ghp_");
  });

  it("rejects transient chatter", async () => {
    const result = await offer("ok thanks that worked");
    expect(result.accepted).toBe(false);
  });

  it("rejects a duplicate of something already stored", async () => {
    await offer("Sentinel deploys via docker compose on the Hostinger VPS.");
    const second = await offer("Sentinel deploys via docker compose on the Hostinger VPS.");
    expect(second.accepted).toBe(false);
    expect(second.verdict.reasons.join(" ")).toMatch(/duplicate/i);
  });

  it("declines to duplicate something an authoritative source answers", async () => {
    const result = await offer("The memories table has a workspaceId column.", {
      authoritativeSources: ["schema"],
    });
    expect(result.accepted).toBe(false);
    expect(result.verdict.reasons.join(" ")).toMatch(/authoritative source/i);
  });

  it("but keeps it when no such source is available to look it up in", async () => {
    const result = await offer("The memories table has a workspaceId column.");
    expect(result.accepted).toBe(true);
  });

  it("records every rejection so the rules can be reviewed", async () => {
    await offer("ok thanks");
    await offer("The Sentinel API gateway is deployed behind Traefik on port 3000.");
    const rejected = await recentIngestionDecisions({ owner: OWNER, accepted: false });
    expect(rejected.length).toBeGreaterThan(0);
    for (const decision of rejected) expect(decision.memoryId).toBeNull();
  });
});

describe("authorization", () => {
  it("refuses a write into a workspace the caller is not a member of", async () => {
    await expect(
      remember({ content: "A durable fact about the platform's deployment.", owner: OTHER,
        scope: "workspace", workspaceId: WORKSPACE }),
    ).rejects.toThrow(MemoryScopeError);
    expect(await db.memory.count({ where: { owner: OTHER } })).toBe(0);
  });

  it("checks authorization before the gate, so a rejection cannot leak another tenant's corpus", async () => {
    // If the gate ran first, an unauthorised caller could learn that a given
    // sentence is already stored by observing a "duplicate" rejection.
    await offer("Sentinel deploys via docker compose on the Hostinger VPS.");
    await expect(
      remember({ content: "Sentinel deploys via docker compose on the Hostinger VPS.", owner: OTHER,
        scope: "workspace", workspaceId: WORKSPACE }),
    ).rejects.toThrow(/Not authorised/);
  });
});

describe("reconsolidation on the write path", () => {
  it("assesses a correction against what it corrects as it is stored", async () => {
    const first = await offer("The project uses provider-a for embeddings.");
    expect(first.accepted).toBe(true);

    const correction = await offer(
      "Correction: the project uses provider-b for embeddings, not provider-a.",
      { tags: ["correction"], reconsolidationMode: "apply" },
    );
    expect(correction.accepted).toBe(true);

    const original = await db.memory.findUniqueOrThrow({ where: { id: first.memoryId! } });
    expect(original.supersededById).toBe(correction.memoryId);
    expect(original.validTo).not.toBeNull();
  });

  it("defaults to shadow, so storing a correction records the judgement without acting on it", async () => {
    const first = await offer("The project uses provider-a for embeddings.");
    const correction = await offer(
      "Correction: the project uses provider-b for embeddings, not provider-a.",
      { tags: ["correction"] },
    );

    const original = await db.memory.findUniqueOrThrow({ where: { id: first.memoryId! } });
    expect(original.supersededById).toBeNull();

    const recorded = await db.memoryReconsolidation.findFirstOrThrow({
      where: { memoryId: first.memoryId!, relatedMemoryId: correction.memoryId! },
    });
    expect(recorded.action).toBe("SUPERSEDE");
    expect(recorded.shadow).toBe(true);
    expect(recorded.applied).toBe(false);
  });
});
