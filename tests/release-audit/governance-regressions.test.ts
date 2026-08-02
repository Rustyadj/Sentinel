import { afterAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import {
  evaluatePromotion,
  recordBenchmarkResult,
} from "@/lib/learning/benchmarks";
import {
  evaluateShadowPromotion,
  runShadowSample,
} from "@/lib/learning/shadow";
import {
  applyLearningCandidate,
  proposeCandidate,
  reviewCandidate,
} from "@/lib/neural-engine/learning-service";
import {
  makeAgent,
  makeUser,
  makeWorkspace,
  uid,
} from "../neural-engine/db-setup";

afterAll(async () => {
  await db.$disconnect();
});

describe("release audit — approval authorization", () => {
  it("fails closed when a Tier-3 candidate has no resolvable workspace", async () => {
    const reviewer = await makeUser();
    const agent = await makeAgent("Unscoped protected target");
    const candidate = await db.learningCandidate.create({
      data: {
        type: "prompt_change",
        proposedPayload: {
          agentId: agent.id,
          systemPrompt: "unscoped protected mutation",
        },
        riskLevel: "low",
        status: "proposed",
      },
    });

    await expect(
      reviewCandidate(candidate.id, "approve", reviewer.id, "must not bypass scope"),
    ).rejects.toThrow(/workspace|tenant|scope/i);

    expect(
      (await db.learningCandidate.findUniqueOrThrow({ where: { id: candidate.id } })).status,
    ).toBe("proposed");
    expect((await db.agent.findUniqueOrThrow({ where: { id: agent.id } })).systemPrompt)
      .not.toBe("unscoped protected mutation");
  });

  it("does not let a user approve another workspace's candidate", async () => {
    const owner = await makeUser();
    const outsider = await makeUser();
    const workspace = await makeWorkspace(owner.id, "Approval owner workspace");
    const agent = await db.agent.create({
      data: {
        name: "Workspace protected target",
        role: "tester",
        avatar: "shield",
        color: "#6366f1",
        model: "test-model",
        toolPermissions: [],
        workspaceId: workspace.id,
      },
    });
    const experience = await db.experience.create({
      data: {
        agentId: agent.id,
        workspaceId: workspace.id,
        objective: "workspace-scoped protected candidate",
      },
    });
    const { candidate } = await proposeCandidate({
      experienceId: experience.id,
      type: "prompt_change",
      proposedPayload: {
        agentId: agent.id,
        workspaceId: workspace.id,
        systemPrompt: "outsider mutation",
      },
      riskLevel: "high",
    });

    await expect(
      reviewCandidate(candidate.id, "approve", outsider.id, "outsider approval"),
    ).rejects.toThrow(/permission|authorized|workspace/i);

    expect(
      (await db.learningCandidate.findUniqueOrThrow({ where: { id: candidate.id } })).status,
    ).toBe("proposed");
  });

  it("rejects direct status tampering even when reviewedBy names a real user", async () => {
    const reviewer = await makeUser();
    const workspace = await makeWorkspace(reviewer.id, "Tamper-resistant approval workspace");
    const agent = await db.agent.create({
      data: {
        name: uid("tamper-target"),
        role: "tester",
        avatar: "shield",
        color: "#6366f1",
        model: "test-model",
        toolPermissions: [],
        workspaceId: workspace.id,
      },
    });
    const candidate = await db.learningCandidate.create({
      data: {
        type: "prompt_change",
        proposedPayload: {
          agentId: agent.id,
          workspaceId: workspace.id,
          systemPrompt: "tampered direct approval",
        },
        riskLevel: "low",
        status: "approved",
        reviewedBy: reviewer.id,
      },
    });

    await expect(applyLearningCandidate(candidate.id)).rejects.toThrow(/approval|audit|review/i);
    expect((await db.agent.findUniqueOrThrow({ where: { id: agent.id } })).systemPrompt)
      .not.toBe("tampered direct approval");
  });
});

describe("release audit — evidence integrity", () => {
  it("does not count duplicate shadow fixtures as independent samples", async () => {
    const agent = await makeAgent("Duplicate shadow fixture agent");
    const experience = await db.experience.create({
      data: {
        agentId: agent.id,
        objective: "one historical fixture",
        outcomeStatus: "success",
        completedAt: new Date(),
      },
    });
    const candidate = await db.learningCandidate.create({
      data: {
        type: "memory",
        proposedPayload: { content: "candidate never actually re-evaluated" },
        riskLevel: "low",
        status: "proposed",
      },
    });

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await runShadowSample({
        candidateId: candidate.id,
        sourceExperienceId: experience.id,
      });
    }

    const promotion = await evaluateShadowPromotion(candidate.id);
    const storedRuns = await db.experimentRun.count({
      where: { candidateId: candidate.id, variant: "shadow" },
    });
    expect(storedRuns).toBe(1);
    expect(promotion.sampleSize).toBe(1);
    expect(promotion.passed).toBe(false);
  });

  it("blocks promotion when hard-guardrail benchmark metrics are missing", async () => {
    const benchmark = await db.benchmarkDefinition.create({
      data: {
        name: uid("incomplete-benchmark"),
        category: "release-audit",
        scoringMethod: "weighted",
      },
    });
    const candidate = await db.learningCandidate.create({
      data: {
        type: "memory",
        proposedPayload: { content: "benchmark fixture" },
        riskLevel: "low",
        status: "proposed",
      },
    });
    await recordBenchmarkResult({
      benchmarkId: benchmark.id,
      metrics: {
        accuracy: 0.9,
        completionRate: 0.9,
        userAcceptance: 0.9,
        hallucinationRate: 0.01,
        latency: 100,
        cost: 1,
        safetyViolations: 0,
      },
    });
    await recordBenchmarkResult({
      benchmarkId: benchmark.id,
      candidateId: candidate.id,
      metrics: {
        userAcceptance: 1,
        safetyViolations: 0,
      },
    });

    const promotion = await evaluatePromotion({
      benchmarkId: benchmark.id,
      candidateId: candidate.id,
    });
    expect(promotion.passed).toBe(false);
    expect(promotion.reasons.join(" ")).toMatch(/missing|incomplete/i);
  });

  it("rejects out-of-range benchmark metrics instead of persisting fabricated evidence", async () => {
    const benchmark = await db.benchmarkDefinition.create({
      data: {
        name: uid("invalid-benchmark"),
        category: "release-audit",
        scoringMethod: "weighted",
      },
    });

    await expect(recordBenchmarkResult({
      benchmarkId: benchmark.id,
      metrics: { accuracy: 1.5, safetyViolations: -10 },
    })).rejects.toThrow(/accuracy|safetyViolations|range/i);

    expect(await db.benchmarkResult.count({ where: { benchmarkId: benchmark.id } })).toBe(0);
  });
});
