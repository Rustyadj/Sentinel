import { afterAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { runExperiment } from "@/lib/learning/experiment-orchestrator";
import { recordFitness } from "@/lib/learning/evolution";
import { checkLearningBudget } from "@/lib/learning/budgets";
import { decayStaleTrust } from "@/lib/learning/trust";
import { requestWeightAdaptation, WEIGHT_ADAPTATION_ENABLED } from "@/lib/learning/weight-adaptation";
import { uid } from "../neural-engine/db-setup";

afterAll(async () => {
  await db.$disconnect();
});

describe("Experiment Orchestrator — stop conditions", () => {
  it("stops immediately with stopReason='budget_exceeded' when the daily experiment budget is already spent", async () => {
    const workspaceId = uid("ws");
    await db.learningSettings.create({
      data: { scopeType: "workspace", scopeId: workspaceId, dailyExperimentBudget: 0 },
    });
    const candidate = await db.learningCandidate.create({
      data: { type: "procedure", proposedPayload: { strategy: "x" }, riskLevel: "low" },
    });

    const manifest = await runExperiment({
      candidateId: candidate.id,
      budgetScopes: [{ scopeType: "workspace", scopeId: workspaceId }],
      workspaceId,
    });
    expect(manifest.stage).toBe("stopped");
    expect(manifest.stopReason).toBe("budget_exceeded");
  });

  it("stops with stopReason='unsafe_candidate' for a candidate already marked unsafe — never runs the pipeline on it", async () => {
    const candidate = await db.learningCandidate.create({
      data: { type: "procedure", proposedPayload: { strategy: "y" }, riskLevel: "low", survivalStatus: "unsafe" },
    });
    const manifest = await runExperiment({ candidateId: candidate.id, budgetScopes: [] });
    expect(manifest.stopReason).toBe("unsafe_candidate");
  });

  it("a Tier 3 candidate without human authorization stops for guardian review, never silently promotes", async () => {
    const candidate = await db.learningCandidate.create({
      data: { type: "confidence_update", proposedPayload: { agentId: uid("a"), knowledgeObjectId: uid("k"), outcome: "success" }, riskLevel: "high", status: "approved" },
    });
    // Pre-seed positive fitness evidence from an earlier stage so the pipeline
    // clears the "no meaningful improvement" gate and actually reaches
    // Guardian — this test is specifically about the Guardian gate, not fitness.
    await recordFitness(candidate.id, { taskSuccess: 0.8, safety: 0.9 });

    const manifest = await runExperiment({ candidateId: candidate.id, budgetScopes: [], runAdversarial: false });
    expect(manifest.stage).toBe("stopped");
    expect(manifest.stopReason).toBe("guardian_block");
  });
});

describe("Learning budget", () => {
  it("reports withinBudget=false with a specific reason once the daily experiment budget is spent", async () => {
    const workspaceId = uid("ws");
    await db.learningSettings.create({
      data: { scopeType: "workspace", scopeId: workspaceId, dailyExperimentBudget: 0 },
    });
    const status = await checkLearningBudget([{ scopeType: "workspace", scopeId: workspaceId }]);
    expect(status.withinBudget).toBe(false);
    expect(status.reasons.join(" ")).toMatch(/daily experiment budget/);
  });

  it("reports withinBudget=true when no limits are configured for the scope", async () => {
    const status = await checkLearningBudget([{ scopeType: "workspace", scopeId: uid("ws-unconfigured") }]);
    expect(status.withinBudget).toBe(true);
  });
});

describe("Capability-specific trust decay", () => {
  it("decays a stale domain score toward neutral rather than toward zero", async () => {
    const agentId = uid("agent");
    const domain = `decay_test_${uid("d")}`;
    await db.agentCompetency.create({
      data: { agentId, domain, score: 0.9, evidenceCount: 5, successRate: 1, lastEvaluatedAt: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000) },
    });
    const result = await decayStaleTrust(2000);
    expect(result.scanned).toBeGreaterThan(0);
    const after = await db.agentCompetency.findUniqueOrThrow({ where: { agentId_domain: { agentId, domain } } });
    expect(after.score).toBeLessThan(0.9);
    expect(after.score).toBeGreaterThan(0.5);
  });
});

describe("Weight adaptation boundary — experimental, disabled by default", () => {
  it("is disabled by default", () => {
    expect(WEIGHT_ADAPTATION_ENABLED).toBe(false);
  });

  it("always rejects a weight-adaptation request while disabled", async () => {
    await expect(
      requestWeightAdaptation({
        modelId: "test-model",
        datasetRef: "ref",
        method: "lora",
        humanApproverId: "user_1",
        reason: "test",
      }),
    ).rejects.toThrow(/disabled/i);
  });
});
