// @vitest-environment node
import { afterAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { proposeEvolutionCandidate, promoteChallenger } from "@/lib/learning/evolution";
import { reviewCandidate, applyLearningCandidate, rollbackCandidate } from "@/lib/neural-engine/learning-service";
import { evaluateGuardian, resolveGuardianReview } from "@/lib/learning/guardian";
import { createFeatureFlag, updateFeatureFlag } from "@/lib/learning/feature-flags";
import { getEffectiveLearningSettings } from "@/lib/learning/settings";
import { makeAgent, makeUser, makeWorkspace, uid, hasDatabase } from "../neural-engine/db-setup";

afterAll(() => db.$disconnect());
describe.skipIf(!hasDatabase())("governed clarification champion application", () => {
  it("requires approval, promotion, Guardian and a canary; rollback restores the preceding policy", async () => {
    const user = await makeUser(); const workspace = await makeWorkspace(user.id); const agent = await makeAgent();
    await db.agent.update({ where: { id: agent.id }, data: { workspaceId: workspace.id } });
    const group = uid("clarification");
    let priorId: string | undefined;
    for (const [index, threshold] of [0.7, 0.8].entries()) {
      const key = uid("clarification-flag");
      const { candidate } = await proposeEvolutionCandidate({ type: "procedure", riskLevel: "medium", championGroup: group, workspaceId: workspace.id,
        proposedPayload: { strategy: "clarify", curiosityThreshold: threshold, agentId: agent.id, workspaceId: workspace.id, featureFlagKey: key }, evidenceCount: 1, confidence: 0.8 });
      await expect(applyLearningCandidate(candidate.id)).rejects.toThrow();
      await reviewCandidate(candidate.id, "approve", user.id);
      expect((await db.learningCandidate.findUniqueOrThrow({ where: { id: candidate.id } })).appliedTargetId).toBeNull();
      await db.learningCandidate.update({ where: { id: candidate.id }, data: { fitnessScore: index + 1 } });
      expect((await promoteChallenger(candidate.id, { actorId: user.id, workspaceId: workspace.id })).promoted).toBe(true);
      await expect(applyLearningCandidate(candidate.id)).rejects.toThrow("Guardian");
      const guardian = await evaluateGuardian({ action: "Apply clarification threshold", actor: agent.id, candidateId: candidate.id, candidateType: "procedure", riskLevel: "medium", workspaceId: workspace.id });
      await resolveGuardianReview({ decisionId: guardian.decision.id, reviewerId: user.id, approve: true });
      await expect(applyLearningCandidate(candidate.id)).rejects.toThrow("Feature flag");
      const flag = await createFeatureFlag({ key, name: key, scopeType: "agent", scopeId: agent.id, learningCandidateId: candidate.id, enabled: false, rolloutPercentage: 0 }, { authorizedByUserId: user.id });
      await applyLearningCandidate(candidate.id);
      expect((await getEffectiveLearningSettings(agent.id)).curiosityThreshold).toBe(index ? 0.7 : 0.6);
      await updateFeatureFlag(flag.id, { enabled: true, rolloutPercentage: 100 }, { authorizedByUserId: user.id });
      expect((await getEffectiveLearningSettings(agent.id)).curiosityThreshold).toBe(threshold);
      if (priorId) {
        await rollbackCandidate(candidate.id, user.id, "Regression detected");
        expect((await getEffectiveLearningSettings(agent.id)).curiosityThreshold).toBe(0.7);
        expect((await db.featureFlag.findUniqueOrThrow({ where: { id: flag.id } })).enabled).toBe(false);
      }
      priorId = candidate.id;
    }
    expect(await db.learningSettings.findUnique({ where: { scopeType_scopeId: { scopeType: "agent", scopeId: agent.id } } })).toBeNull();
  });
});
