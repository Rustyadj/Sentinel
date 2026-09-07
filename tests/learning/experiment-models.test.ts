// @vitest-environment node
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { runExperiment } from "@/lib/learning/experiment-orchestrator";
import { ModelUnavailableError } from "@/lib/agents/model-policy";
import { makeAgent, makeUser, makeWorkspace, hasDatabase } from "../neural-engine/db-setup";
const execute = vi.hoisted(() => vi.fn());
vi.mock("@/lib/learning/experiment-models", async original => ({ ...await original<object>(), executeExperimentRole: execute }));
afterAll(() => db.$disconnect());
beforeEach(() => { execute.mockReset(); });
const models = { generator: "hermes-lisa", evaluator: "hermes-nathan2", adversary: "claude-code", guardian: "codex" };
async function fixture() {
  const user = await makeUser(); const workspace = await makeWorkspace(user.id); const agent = await makeAgent();
  await db.agent.update({ where: { id: agent.id }, data: { workspaceId: workspace.id } });
  const payload = { workspaceId: workspace.id, agentId: agent.id, strategy: "clarify", curiosityThreshold: 0.65 };
  const candidate = await db.learningCandidate.create({ data: { type: "procedure", riskLevel: "medium", proposedPayload: payload } });
  return { user, workspace, candidate, payload };
}
describe.skipIf(!hasDatabase())("configured experiment roles use the canonical orchestrator", () => {
  it("records generator/evaluator models, all four session IDs, and independent model Guardian evidence", async () => {
    const f = await fixture();
    execute.mockImplementation(async ({ role, agentId }) => ({ result: role === "generator" ? { proposedPayload: f.payload } : { allow: true }, sessionId: `session-${role}`, agentId, requestedModel: `model-${role}`, requestedEffort: "low", actualModel: `model-${role}` }));
    const manifest = await runExperiment({ candidateId: f.candidate.id, actorId: f.user.id, workspaceId: f.workspace.id, budgetScopes: [], models, runAdversarial: false, fixtureExperienceIds: [] });
    expect(execute.mock.calls.map(([input]) => [input.role, input.agentId])).toEqual(Object.entries(models));
    const generated = await db.learningCandidate.findUniqueOrThrow({ where: { id: manifest.candidateId! } });
    expect(generated).toMatchObject({ generatorModel: "model-generator", evaluatorModel: "model-evaluator", parentCandidateId: f.candidate.id, status: "proposed", appliedTargetId: null });
    const guardian = await db.guardianDecision.findFirstOrThrow({ where: { candidateId: generated.id } });
    expect(guardian.evidence).toMatchObject({ modelReview: { agentId: "codex", sessionId: "session-guardian", requestedModel: "model-guardian" } });
    expect((manifest.results as { models: object }).models).toHaveProperty("adversary.sessionId", "session-adversary");
  });
  it("stops on MODEL_UNAVAILABLE without selecting another agent/model", async () => {
    const f = await fixture();
    execute.mockRejectedValue(new ModelUnavailableError("codex", "gpt-6-astra", "low", "Account cannot use requested model"));
    const manifest = await runExperiment({ candidateId: f.candidate.id, actorId: f.user.id, workspaceId: f.workspace.id, budgetScopes: [], models });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(manifest.stopReason).toBe("infrastructure_unavailable");
    expect((manifest.results as { notes: string }).notes).toContain("MODEL_UNAVAILABLE");
  });
});
