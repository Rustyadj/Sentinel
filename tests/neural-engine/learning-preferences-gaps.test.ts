import { afterAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import {
  PREFERENCE_EVIDENCE_WEIGHTS,
  recordPreferenceEvidence,
} from "@/lib/learning/preferences";
import {
  calculateGapPriority,
  detectKnowledgeGaps,
} from "@/lib/learning/knowledge-gaps";
import { makeUser, uid } from "./db-setup";

afterAll(async () => {
  await db.$disconnect();
});

describe("Learning Core — preference evidence (integration)", () => {
  it("uses the spec's exact evidence weights", () => {
    expect(PREFERENCE_EVIDENCE_WEIGHTS).toEqual({
      explicit_user_statement: 1,
      explicit_correction: 0.9,
      explicit_approval: 0.8,
      repeated_observed_behavior: 0.5,
      single_implicit_behavior: 0.2,
      model_inference: 0.1,
    });
  });

  it("keeps one isolated implicit behavior below established-preference confidence", async () => {
    const user = await makeUser();
    const result = await recordPreferenceEvidence({
      userId: user.id,
      key: uid("response-tone"),
      value: "concise",
      sourceType: "single_implicit_behavior",
      evidence: "The user selected the shorter response once.",
    });

    expect(result.conflict).toBe(false);
    expect(result.evidence.evidenceWeight).toBe(0.2);
    expect(result.memory.type).toBe("preference");
    expect(result.memory.confidence).toBeCloseTo(0.167, 3);
    expect(result.memory.confidence).toBeLessThan(0.5);
  });

  it("records contradictory evidence as a conflict without overwriting the canonical preference", async () => {
    const user = await makeUser();
    const key = uid("meeting-format");
    await recordPreferenceEvidence({
      userId: user.id,
      key,
      value: "written updates",
      sourceType: "explicit_user_statement",
      evidence: "The user explicitly asked for written updates.",
    });
    await recordPreferenceEvidence({
      userId: user.id,
      key,
      value: "written updates",
      sourceType: "explicit_approval",
      evidence: "The user approved the written update format.",
    });

    const contradiction = await recordPreferenceEvidence({
      userId: user.id,
      key,
      value: "live meetings",
      sourceType: "explicit_correction",
      evidence: "The user requested a live meeting instead.",
    });

    expect(contradiction.conflict).toBe(true);
    expect(contradiction.evidence.supportsPreference).toBe(false);
    expect(contradiction.evidence.evidenceWeight).toBe(0.9);
    expect(contradiction.memory.content).toBe("written updates");
    expect(contradiction.evidence.metadata).toMatchObject({
      conflict: true,
      canonicalValue: "written updates",
      observedValue: "live meetings",
    });
  });
});

describe("Learning Core — knowledge-gap detection (integration)", () => {
  it("merges repeated normalized topics and does not double-count a repeated scan", async () => {
    const agentId = uid("gap-agent");
    const topic = `Missing deploy runbook ${uid("topic")}`;
    await db.curiosityEvent.createMany({
      data: [
        {
          agentId,
          triggerType: "low_confidence",
          reason: `  ${topic.toUpperCase()}  `,
          confidenceBefore: 0.2,
          businessImpactScore: 0.8,
          curiosityScore: 0.75,
        },
        {
          agentId,
          triggerType: "missing_constraint",
          reason: topic,
          confidenceBefore: 0.4,
          businessImpactScore: 0.6,
          curiosityScore: 0.7,
        },
      ],
    });
    await db.reflection.create({
      data: {
        agentId,
        reflectionType: "failure",
        summary: "Deployment failed because the runbook was unavailable.",
        whatFailed: topic,
      },
    });

    const firstScan = await detectKnowledgeGaps({
      agentId,
      since: new Date(Date.now() - 60_000),
    });
    expect(firstScan).toHaveLength(1);
    expect(firstScan[0].frequency).toBe(3);
    expect(firstScan[0].businessImpact).toBe(0.8);
    expect(firstScan[0].priorityScore).toBe(calculateGapPriority(3, 0.8));
    expect(firstScan[0].source).toBe("curiosity,reflection");

    const secondScan = await detectKnowledgeGaps({
      agentId,
      since: new Date(Date.now() - 60_000),
    });
    expect(secondScan).toHaveLength(1);
    expect(secondScan[0].id).toBe(firstScan[0].id);
    expect(secondScan[0].frequency).toBe(3);
  });
});
