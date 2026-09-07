import { afterAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { startExperience, completeExperience } from "@/lib/neural-engine/experience-service";
import { autoEvaluateExperience } from "@/lib/neural-engine/evaluator";
import { captureAgentTurn } from "@/lib/neural-engine/chat-capture";
import { claudeResultTokenUsage } from "@/lib/agents/runtime/claude-code";
import { codexTokenUsage } from "@/lib/agents/runtime/codex";
import { makeAgent, makeKnowledgeObject } from "./db-setup";

afterAll(async () => {
  await db.$disconnect();
});

/** Run one full "used this object, succeeded" turn and return the evaluation result. */
async function runSuccessfulTurnUsing(agentId: string, objectId: string) {
  const exp = await startExperience({
    agentId,
    objective: "Answer using the runbook",
    knowledgeUsed: [objectId],
  });
  await completeExperience({
    experienceId: exp.id,
    outcome: { status: "success" },
    latencyMs: 800,
  });
  return autoEvaluateExperience(exp.id);
}

describe("Phase B — auto-evaluator + learning loop (integration)", () => {
  it("creates an Evaluation and updates agent competency when a completed experience is evaluated", async () => {
    const agent = await makeAgent("B Evaluator Agent");
    const exp = await startExperience({ agentId: agent.id, objective: "Draft the release notes" });
    await completeExperience({ experienceId: exp.id, outcome: { status: "success" }, latencyMs: 1200 });

    const result = await autoEvaluateExperience(exp.id);
    const evaluation = await db.evaluation.findUnique({ where: { id: result.evaluationId } });
    expect(evaluation).not.toBeNull();
    expect(evaluation?.successScore).toBe(1);

    const competency = await db.agentCompetency.findFirst({ where: { agentId: agent.id } });
    expect(competency).not.toBeNull();
    expect(competency?.evidenceCount).toBeGreaterThanOrEqual(1);
  });

  it("refuses to evaluate an experience that is still in_progress", async () => {
    const agent = await makeAgent("B InProgress Agent");
    const exp = await startExperience({ agentId: agent.id, objective: "Half-done task" });
    await expect(autoEvaluateExperience(exp.id)).rejects.toThrow(/in_progress/);
  });

  it("does NOT auto-strengthen on a single success — the first candidate stays queued for review", async () => {
    const agent = await makeAgent("B OneOff Agent");
    const object = await makeKnowledgeObject({ title: "Runbook A" });

    const result = await runSuccessfulTurnUsing(agent.id, object.id);
    expect(result.proposedCandidateIds).toHaveLength(1);
    // One observation ⇒ evidenceCount 1 ⇒ below the auto-approve threshold.
    expect(result.autoAppliedCandidateIds).toHaveLength(0);

    const candidate = await db.learningCandidate.findUnique({
      where: { id: result.proposedCandidateIds[0] },
    });
    expect(candidate?.status).toBe("proposed");

    // No trust weight was written, because nothing was applied.
    const weight = await db.agentKnowledgeWeight.findUnique({
      where: { agentId_knowledgeObjectId: { agentId: agent.id, knowledgeObjectId: object.id } },
    });
    expect(weight).toBeNull();
  });

  it("auto-strengthens only once repeated evidence crosses the threshold (no one-off learning)", async () => {
    const agent = await makeAgent("B Repeated Agent");
    const object = await makeKnowledgeObject({ title: "Runbook B" });

    // 1st and 2nd successes: evidenceCount 1 then 2 — still queued.
    const r1 = await runSuccessfulTurnUsing(agent.id, object.id);
    const r2 = await runSuccessfulTurnUsing(agent.id, object.id);
    expect(r1.autoAppliedCandidateIds).toHaveLength(0);
    expect(r2.autoAppliedCandidateIds).toHaveLength(0);

    // 3rd success: prior successful uses = 3 ⇒ crosses the evidence threshold
    // AND confidence clears 0.75 ⇒ auto-approves and strengthens.
    const r3 = await runSuccessfulTurnUsing(agent.id, object.id);
    expect(r3.autoAppliedCandidateIds).toHaveLength(1);

    const weight = await db.agentKnowledgeWeight.findUnique({
      where: { agentId_knowledgeObjectId: { agentId: agent.id, knowledgeObjectId: object.id } },
    });
    expect(weight).not.toBeNull();
    expect(weight!.trustWeight).toBeGreaterThan(0.5);
  });

  it("captureAgentTurn records an Experience+Outcome+Evaluation for a real chat turn and never throws", async () => {
    const agent = await makeAgent("B Chat Agent");

    const experienceId = await captureAgentTurn({
      agentId: agent.id,
      userContent: "What is our deploy process?",
      model: "test-model",
      startedAtMs: Date.now() - 1500,
      fullContent: "Our deploy process is: build, migrate, ship.",
    });

    expect(experienceId).not.toBeNull();
    const exp = await db.experience.findUnique({
      where: { id: experienceId! },
      include: { outcome: true, evaluations: true },
    });
    expect(exp?.outcomeStatus).toBe("success");
    expect(exp?.outcome?.status).toBe("success");
    expect(exp?.evaluations.length).toBeGreaterThanOrEqual(1);
    expect(exp?.latencyMs).toBeGreaterThan(0);
  });

  it("records Claude Code stream-json result usage as a non-null Experience cost", async () => {
    const agent = await makeAgent("B Claude Cost Agent");
    const tokenUsage = claudeResultTokenUsage({
      type: "result",
      usage: {
        input_tokens: 1_000,
        output_tokens: 200,
        cache_read_input_tokens: 500,
        cache_creation_input_tokens: 150,
        cache_creation: { ephemeral_5m_input_tokens: 100, ephemeral_1h_input_tokens: 50 },
      },
    });
    expect(tokenUsage).not.toBeNull();

    const experienceId = await captureAgentTurn({
      agentId: agent.id,
      userContent: "Implement the requested Claude change",
      model: "claude-opus-5",
      startedAtMs: Date.now() - 500,
      fullContent: "Implemented and tested.",
      tokenUsage: tokenUsage!,
    });

    const experience = await db.experience.findUniqueOrThrow({ where: { id: experienceId! } });
    expect(experience.cost).toBeCloseTo(0.011375, 8);
  });

  it("records Codex transcript usage as a non-null Experience cost", async () => {
    const agent = await makeAgent("B Codex Cost Agent");
    const tokenUsage = codexTokenUsage({
      input_tokens: 1_400,
      cached_input_tokens: 400,
      cache_write_input_tokens: 100,
      output_tokens: 200,
      reasoning_output_tokens: 50,
      total_tokens: 1_600,
    });
    expect(tokenUsage).not.toBeNull();

    const experienceId = await captureAgentTurn({
      agentId: agent.id,
      userContent: "Implement the requested Codex change",
      model: "gpt-6-astra",
      startedAtMs: Date.now() - 500,
      fullContent: "Implemented and tested.",
      tokenUsage: tokenUsage!,
    });

    const experience = await db.experience.findUniqueOrThrow({ where: { id: experienceId! } });
    expect(experience.cost).toBeCloseTo(0.02065, 8);
  });

  it.each([
    ["Hermes usage is absent", "gpt-5.6-luna", undefined],
    ["the reported model is not priced", "future-unlisted-model", {
      inputTokens: 1_000,
      outputTokens: 200,
      cachedInputTokens: 500,
      cacheWrite5mInputTokens: 100,
      cacheWrite1hInputTokens: 50,
    }],
  ])("keeps Experience.cost null (not zero) when %s", async (_reason, model, tokenUsage) => {
    const agent = await makeAgent("B Unknown Cost Agent");
    const experienceId = await captureAgentTurn({
      agentId: agent.id,
      userContent: "Run a turn with unknown cost",
      model,
      startedAtMs: Date.now() - 100,
      fullContent: "Completed without billable telemetry.",
      ...(tokenUsage ? { tokenUsage } : {}),
    });

    const experience = await db.experience.findUniqueOrThrow({ where: { id: experienceId! } });
    expect(experience.cost).toBeNull();
    expect(experience.cost).not.toBe(0);
  });

  it("captureAgentTurn records a failed turn (empty response) as a failure outcome", async () => {
    const agent = await makeAgent("B Chat Fail Agent");
    const experienceId = await captureAgentTurn({
      agentId: agent.id,
      userContent: "This one produced nothing",
      model: "test-model",
      startedAtMs: Date.now() - 500,
      fullContent: "",
    });
    const exp = await db.experience.findUnique({ where: { id: experienceId! }, include: { outcome: true } });
    expect(exp?.outcomeStatus).toBe("failure");
    expect(exp?.outcome?.status).toBe("failure");
  });

  it("captureAgentTurn returns null (does not throw) when given no agent", async () => {
    const experienceId = await captureAgentTurn({
      agentId: "",
      userContent: "orphan",
      model: "test-model",
      startedAtMs: Date.now(),
      fullContent: "hello",
    });
    expect(experienceId).toBeNull();
  });
});
