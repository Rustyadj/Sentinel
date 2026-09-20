import { afterAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { recordMemoryRetrieval } from "./memory-usage-service";
import {
  isIndependentEvidence,
  resolveRetrievalOutcomes,
  usefulnessRatio,
} from "./reconsolidation-service";

afterAll(async () => db.$disconnect());

const uniq = () => `recon-${Date.now()}-${Math.random().toString(16).slice(2)}`;

async function makeMemory(overrides: Record<string, unknown> = {}) {
  return db.memory.create({
    data: { type: "fact", scope: "global", owner: uniq(), content: "a memory", source: "chat", ...overrides },
  });
}

async function makeExperience() {
  return db.experience.create({ data: { agentId: "claude-code", objective: uniq() } });
}

/**
 * Record a retrieval that actually reached the worker's prompt.
 *
 * Only injected retrievals count as evidence, so every fixture that expects a
 * memory to be confirmed or disconfirmed has to say it was injected. A bare
 * recordMemoryRetrieval() now models the other case: retrieved, never shown.
 */
async function recordInjectedRetrieval(memoryIds: string[], experienceId: string) {
  return recordMemoryRetrieval({
    memoryIds,
    experienceId,
    consumer: "chat",
    injected: memoryIds.map((memoryId, rank) => ({ memoryId, rank, estimatedTokens: 10 })),
  });
}

describe("independence of evidence", () => {
  it("lets first-hand memories be confirmed by any experience", () => {
    expect(isIndependentEvidence({ provenanceClass: "OBSERVED", derivedFromExperienceIds: ["e1"] }, "e1")).toBe(true);
    expect(isIndependentEvidence({ provenanceClass: "USER_PROVIDED", derivedFromExperienceIds: [] }, "e1")).toBe(true);
  });

  it("refuses to let a derived memory be confirmed by an experience that produced it", () => {
    expect(isIndependentEvidence({ provenanceClass: "GENERALIZED", derivedFromExperienceIds: ["e1", "e2"] }, "e1")).toBe(false);
    expect(isIndependentEvidence({ provenanceClass: "INFERRED", derivedFromExperienceIds: ["e1"] }, "e1")).toBe(false);
  });

  it("allows a derived memory to be confirmed by genuinely new evidence", () => {
    expect(isIndependentEvidence({ provenanceClass: "GENERALIZED", derivedFromExperienceIds: ["e1"] }, "e9")).toBe(true);
  });
});

describe("resolving retrieval outcomes", () => {
  it("confirms a memory that was present for successful work", async () => {
    const memory = await makeMemory();
    const experience = await makeExperience();
    await recordInjectedRetrieval([memory.id], experience.id);

    const result = await resolveRetrievalOutcomes({ experienceId: experience.id, successScore: 0.9 });
    expect(result).toMatchObject({ resolved: 1, confirmed: 1, disconfirmed: 0 });

    const after = await db.memory.findUniqueOrThrow({ where: { id: memory.id } });
    expect(after.confirmationCount).toBe(1);
    expect(after.lastUsefulAt).not.toBeNull(); // the signal decay was always meant to read
    expect(after.disconfirmationCount).toBe(0);
  });

  it("disconfirms without treating failure as contradiction", async () => {
    const memory = await makeMemory();
    const experience = await makeExperience();
    await recordInjectedRetrieval([memory.id], experience.id);

    await resolveRetrievalOutcomes({ experienceId: experience.id, successScore: 0.1 });

    const after = await db.memory.findUniqueOrThrow({ where: { id: memory.id } });
    expect(after.disconfirmationCount).toBe(1);
    expect(after.confirmationCount).toBe(0);
    expect(after.lastUsefulAt).toBeNull();
    // A failed task does not make a memory wrong.
    expect(after.contradictionCount).toBe(0);
  });

  it("counts one experience once, however many times the memory was retrieved", async () => {
    const memory = await makeMemory();
    const experience = await makeExperience();
    await recordInjectedRetrieval([memory.id], experience.id);
    await db.memoryRetrieval.create({ data: { memoryId: memory.id, experienceId: experience.id, injected: true, injectedRank: 1 } });

    const result = await resolveRetrievalOutcomes({ experienceId: experience.id, successScore: 1 });
    expect(result.resolved).toBe(2);
    expect(result.confirmed).toBe(1);
    expect(result.skippedAlreadyCounted).toBe(1);

    const after = await db.memory.findUniqueOrThrow({ where: { id: memory.id } });
    expect(after.confirmationCount).toBe(1);
  });

  it("is idempotent — re-resolving cannot inflate confidence", async () => {
    const memory = await makeMemory();
    const experience = await makeExperience();
    await recordInjectedRetrieval([memory.id], experience.id);

    await resolveRetrievalOutcomes({ experienceId: experience.id, successScore: 1 });
    const second = await resolveRetrievalOutcomes({ experienceId: experience.id, successScore: 1 });

    expect(second.resolved).toBe(0);
    const after = await db.memory.findUniqueOrThrow({ where: { id: memory.id } });
    expect(after.confirmationCount).toBe(1);
  });

  it("will not let a generalized memory confirm itself through its own source episode", async () => {
    const experience = await makeExperience();
    const derived = await makeMemory({
      provenanceClass: "GENERALIZED",
      shadowOnly: true,
      derivedFromExperienceIds: [experience.id],
    });
    await recordInjectedRetrieval([derived.id], experience.id);

    const result = await resolveRetrievalOutcomes({ experienceId: experience.id, successScore: 1 });

    expect(result.skippedNotIndependent).toBe(1);
    expect(result.confirmed).toBe(0);
    const after = await db.memory.findUniqueOrThrow({ where: { id: derived.id } });
    expect(after.confirmationCount).toBe(0);
  });

  it("records the outcome on the retrieval row either way", async () => {
    const memory = await makeMemory();
    const experience = await makeExperience();
    await recordInjectedRetrieval([memory.id], experience.id);

    await resolveRetrievalOutcomes({ experienceId: experience.id, successScore: 0.8 });

    const row = await db.memoryRetrieval.findFirstOrThrow({ where: { experienceId: experience.id } });
    expect(row.contributedToOutcome).toBe(true);
    expect(row.outcomeScore).toBeCloseTo(0.8);
    expect(row.resolvedAt).not.toBeNull();
  });
});

describe("usefulness ratio", () => {
  it("distinguishes 'not useful' from 'not yet known'", () => {
    expect(usefulnessRatio({ confirmationCount: 0, disconfirmationCount: 0 })).toBeNull();
    expect(usefulnessRatio({ confirmationCount: 0, disconfirmationCount: 3 })).toBe(0);
    expect(usefulnessRatio({ confirmationCount: 3, disconfirmationCount: 1 })).toBeCloseTo(0.75);
  });
});

describe("injection gates evidence", () => {
  it("does not let a retrieved-but-never-injected memory count as evidence", async () => {
    const memory = await makeMemory();
    const experience = await makeExperience();
    // Retrieved, but it never made the context budget — so the worker never
    // read it. This is exactly the shape every orchestration retrieval had
    // before the executor injected anything.
    await recordMemoryRetrieval({ memoryIds: [memory.id], experienceId: experience.id, consumer: "orchestration" });

    const result = await resolveRetrievalOutcomes({ experienceId: experience.id, successScore: 1 });

    expect(result.resolved).toBe(1);
    expect(result.skippedNotInjected).toBe(1);
    expect(result.confirmed).toBe(0);

    const after = await db.memory.findUniqueOrThrow({ where: { id: memory.id } });
    expect(after.confirmationCount).toBe(0);
    expect(after.lastUsefulAt).toBeNull();
  });

  it("does not let a non-injected memory be disconfirmed by a failure either", async () => {
    const memory = await makeMemory();
    const experience = await makeExperience();
    await recordMemoryRetrieval({ memoryIds: [memory.id], experienceId: experience.id });

    const result = await resolveRetrievalOutcomes({ experienceId: experience.id, successScore: 0 });

    expect(result.skippedNotInjected).toBe(1);
    expect(result.disconfirmed).toBe(0);
    const after = await db.memory.findUniqueOrThrow({ where: { id: memory.id } });
    expect(after.disconfirmationCount).toBe(0);
  });

  it("still marks non-injected retrievals resolved so they are not reprocessed", async () => {
    const memory = await makeMemory();
    const experience = await makeExperience();
    await recordMemoryRetrieval({ memoryIds: [memory.id], experienceId: experience.id });

    await resolveRetrievalOutcomes({ experienceId: experience.id, successScore: 1 });
    const second = await resolveRetrievalOutcomes({ experienceId: experience.id, successScore: 1 });

    expect(second.resolved).toBe(0);
  });

  it("records the consumer and the injected rank it was shown at", async () => {
    const memory = await makeMemory();
    const experience = await makeExperience();
    await recordInjectedRetrieval([memory.id], experience.id);

    const row = await db.memoryRetrieval.findFirstOrThrow({ where: { memoryId: memory.id, experienceId: experience.id } });
    expect(row.injected).toBe(true);
    expect(row.injectedRank).toBe(0);
    expect(row.consumer).toBe("chat");
    expect(row.contextTokens).toBe(10);
  });
});
