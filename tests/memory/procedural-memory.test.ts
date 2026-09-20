// The procedural lane's promotion lifecycle.
//
// The failure mode this guards against is specific: as a row, a workflow that
// worked once is indistinguishable from one that has worked twenty times. If
// the first can reach a prompt as established practice, a single lucky run
// becomes a universal rule.

import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import {
  assessPromotion, recordProcedureOutcome, shadowedProcedures,
  PROMOTION_MIN_SUCCESSES,
} from "@/lib/neural-engine/procedural-memory";
import { remember } from "@/lib/neural-engine/memory-ingestion";
import { retrieveContext } from "@/lib/knowledge/retrieval";

const OWNER = "proc-user";
const PROJECT = "proc-project";

const row = (over: Partial<Parameters<typeof assessPromotion>[0]> = {}) => ({
  id: "p", shadowOnly: true, state: "active",
  confirmationCount: 0, disconfirmationCount: 0, supportingExperienceIds: [],
  ...over,
});

describe("assessPromotion", () => {
  it("holds a procedure that has worked once", () => {
    const result = assessPromotion(row({ confirmationCount: 1 }));
    expect(result.action).toBe("HOLD");
    expect(result.reason).toMatch(/one success is not a rule/);
  });

  it("promotes only after enough independent successes", () => {
    expect(assessPromotion(row({ confirmationCount: PROMOTION_MIN_SUCCESSES - 1 })).action).toBe("HOLD");
    expect(assessPromotion(row({ confirmationCount: PROMOTION_MIN_SUCCESSES })).action).toBe("PROMOTE");
  });

  it("holds a procedure that succeeds often but fails too often", () => {
    expect(assessPromotion(row({ confirmationCount: 4, disconfirmationCount: 2 })).action).toBe("HOLD");
  });

  it("demotes a promoted procedure that starts failing", () => {
    const result = assessPromotion(row({ shadowOnly: false, confirmationCount: 4, disconfirmationCount: 4 }));
    expect(result.action).toBe("DEMOTE");
  });

  it("checks failure before success, so a failing procedure cannot be promoted on its way down", () => {
    // Enough successes to clear the bar, and failing half the time.
    const result = assessPromotion(row({ confirmationCount: 5, disconfirmationCount: 5 }));
    expect(result.action).not.toBe("PROMOTE");
  });

  it("does not judge a procedure with no evidence", () => {
    expect(assessPromotion(row()).action).toBe("HOLD");
    expect(assessPromotion(row({ shadowOnly: false })).action).toBe("NO_CHANGE");
  });
});

describe("evidence independence", () => {
  const MEMORY_ID = "proc-mem";

  async function cleanup() {
    await db.memoryReconsolidation.deleteMany({ where: { memory: { owner: OWNER } } });
    await db.memoryIngestionDecision.deleteMany({ where: { owner: OWNER } });
    await db.memory.deleteMany({ where: { owner: OWNER } });
    await db.project.deleteMany({ where: { id: PROJECT } });
    await db.user.deleteMany({ where: { id: OWNER } });
  }

  beforeEach(async () => {
    await cleanup();
    await db.user.create({ data: { id: OWNER, email: "proc@sentinel.test", name: "P" } });
    await db.project.create({ data: { id: PROJECT, name: "P", userId: OWNER } });
    await db.memory.create({
      data: {
        id: MEMORY_ID, owner: OWNER, scope: "project", projectId: PROJECT, type: "skill",
        source: "test", content: "To deploy Sentinel, build the image, run migrations, then restart the stack.",
        shadowOnly: true, provenanceClass: "INFERRED", derivedFromExperienceIds: ["exp-origin"],
      },
    });
  });

  afterAll(cleanup);

  it("refuses to count the execution the procedure was derived from", async () => {
    const result = await recordProcedureOutcome({ memoryId: MEMORY_ID, experienceId: "exp-origin", succeeded: true });
    expect(result.counted).toBe(false);
    expect(result.reason).toMatch(/derive/);
    const after = await db.memory.findUniqueOrThrow({ where: { id: MEMORY_ID } });
    expect(after.confirmationCount).toBe(0);
  });

  it("counts one execution once, however many times it is reported", async () => {
    await recordProcedureOutcome({ memoryId: MEMORY_ID, experienceId: "exp-1", succeeded: true });
    const second = await recordProcedureOutcome({ memoryId: MEMORY_ID, experienceId: "exp-1", succeeded: true });
    expect(second.counted).toBe(false);
    const after = await db.memory.findUniqueOrThrow({ where: { id: MEMORY_ID } });
    expect(after.confirmationCount).toBe(1);
    expect(after.supportingExperienceIds).toEqual(["exp-1"]);
  });

  it("leaves shadow only after enough distinct executions, and then becomes retrievable", async () => {
    const query = "What are the steps to deploy Sentinel?";
    const visible = async () =>
      (await retrieveContext({ userId: OWNER, projectId: PROJECT, query, scopePolicy: "user-context" }))
        .memories.map((memory) => memory.id);

    expect(await visible()).not.toContain(MEMORY_ID);

    for (let i = 1; i <= PROMOTION_MIN_SUCCESSES; i += 1) {
      await recordProcedureOutcome({ memoryId: MEMORY_ID, experienceId: `exp-${i}`, succeeded: true, mode: "apply" });
    }

    const promoted = await db.memory.findUniqueOrThrow({ where: { id: MEMORY_ID } });
    expect(promoted.shadowOnly).toBe(false);
    expect(await visible()).toContain(MEMORY_ID);
  });

  it("records what it would do without promoting, in shadow mode", async () => {
    for (let i = 1; i <= PROMOTION_MIN_SUCCESSES; i += 1) {
      await recordProcedureOutcome({ memoryId: MEMORY_ID, experienceId: `exp-${i}`, succeeded: true, mode: "shadow" });
    }
    const still = await db.memory.findUniqueOrThrow({ where: { id: MEMORY_ID } });
    expect(still.shadowOnly).toBe(true);

    const decision = await db.memoryReconsolidation.findFirstOrThrow({
      where: { memoryId: MEMORY_ID, origin: "procedural-promotion" },
    });
    expect(decision.shadow).toBe(true);
    expect(decision.reason).toMatch(/procedural promote/);
  });

  it("demotes back to shadow rather than deleting when a procedure stops working", async () => {
    for (let i = 1; i <= PROMOTION_MIN_SUCCESSES; i += 1) {
      await recordProcedureOutcome({ memoryId: MEMORY_ID, experienceId: `exp-${i}`, succeeded: true, mode: "apply" });
    }
    for (let i = 1; i <= 4; i += 1) {
      await recordProcedureOutcome({ memoryId: MEMORY_ID, experienceId: `fail-${i}`, succeeded: false, mode: "apply" });
    }
    const demoted = await db.memory.findUniqueOrThrow({ where: { id: MEMORY_ID } });
    expect(demoted.shadowOnly).toBe(true);
    expect(demoted.state).toBe("disputed");
    // The evidence that disproved it is kept — a later revision needs it.
    expect(demoted.supportingExperienceIds).toHaveLength(PROMOTION_MIN_SUCCESSES + 4);
  });

  it("lists what is waiting on evidence", async () => {
    expect((await shadowedProcedures(OWNER)).map((p) => p.id)).toContain(MEMORY_ID);
  });
});

describe("ingestion puts observed procedures in shadow", () => {
  async function cleanup() {
    await db.memoryReconsolidation.deleteMany({ where: { memory: { owner: OWNER } } });
    await db.memoryIngestionDecision.deleteMany({ where: { owner: OWNER } });
    await db.memory.deleteMany({ where: { owner: OWNER } });
    await db.project.deleteMany({ where: { id: PROJECT } });
    await db.user.deleteMany({ where: { id: OWNER } });
  }

  beforeEach(async () => {
    await cleanup();
    await db.user.create({ data: { id: OWNER, email: "proc@sentinel.test", name: "P" } });
    await db.project.create({ data: { id: PROJECT, name: "P", userId: OWNER } });
  });

  afterAll(cleanup);

  const PROCEDURE = "To rotate the gateway certificate, first stop the proxy, then renew, then restart it.";

  it("holds a procedure the agent merely observed", async () => {
    const result = await remember({
      content: PROCEDURE, owner: OWNER, speaker: "agent", scope: "project", projectId: PROJECT,
    });
    expect(result.accepted).toBe(true);
    const memory = await db.memory.findUniqueOrThrow({ where: { id: result.memoryId! } });
    expect(memory.type).toBe("skill");
    expect(memory.shadowOnly).toBe(true);
  });

  it("does not hold one the user stated outright", async () => {
    const result = await remember({
      content: PROCEDURE, owner: OWNER, speaker: "user", scope: "project", projectId: PROJECT,
    });
    const memory = await db.memory.findUniqueOrThrow({ where: { id: result.memoryId! } });
    expect(memory.shadowOnly).toBe(false);
  });
});
