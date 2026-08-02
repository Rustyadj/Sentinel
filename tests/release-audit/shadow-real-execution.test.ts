import { afterAll, afterEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { runShadowSample } from "@/lib/learning/shadow";
import { resetSandboxCache } from "@/lib/learning/sandbox";
import { makeAgent } from "../neural-engine/db-setup";

afterEach(() => resetSandboxCache());
afterAll(async () => {
  await db.$disconnect();
});

// This is the decisive test the audit asked for: a deliberately broken
// candidate must lose against a *historically successful* baseline. Under
// the old implementation (validated the no-op command `["true"]`, then
// scored `passed = candidateApplies && baselineStatus === "success"`) this
// exact scenario would report `passed: true` — the broken candidate would
// have looked fine because nothing about it was ever actually run. It must
// fail here, on this branch, because the real implementationCommand is what
// gets executed.
describe("release audit — shadow mode executes the real candidate", () => {
  it("a candidate whose real implementation exits non-zero fails shadow, even against a successful historical baseline", async () => {
    const agent = await makeAgent("Broken skill candidate agent");
    const experience = await db.experience.create({
      data: {
        agentId: agent.id,
        objective: "historically successful task",
        outcomeStatus: "success", // the OLD logic's only real signal — deliberately kept "success" here
        evaluatorScore: 0.95,
        completedAt: new Date(),
      },
    });
    const candidate = await db.learningCandidate.create({
      data: {
        type: "skill",
        proposedPayload: {
          // A real command, not a mock — genuinely exits 1.
          implementationCommand: ["node", "-e", "process.exit(1)"],
        },
        riskLevel: "low",
        status: "proposed",
      },
    });

    const outcome = await runShadowSample({
      candidateId: candidate.id,
      sourceExperienceId: experience.id,
    });

    expect(outcome.unsupported).toBe(false);
    expect(outcome.passed).toBe(false);
    const stored = await db.experimentRun.findUniqueOrThrow({ where: { id: outcome.run.id } });
    const metrics = stored.metrics as { safetyViolations?: number };
    expect(metrics.safetyViolations).toBe(0); // a clean non-zero exit, not a sandbox-boundary violation
  });

  it("the same candidate type with a real passing implementation passes shadow", async () => {
    const agent = await makeAgent("Working skill candidate agent");
    const experience = await db.experience.create({
      data: {
        agentId: agent.id,
        objective: "historically failed task", // deliberately the opposite signal from the old baseline check
        outcomeStatus: "failure",
        completedAt: new Date(),
      },
    });
    const candidate = await db.learningCandidate.create({
      data: {
        type: "skill",
        proposedPayload: {
          implementationCommand: ["node", "-e", "process.exit(0)"],
        },
        riskLevel: "low",
        status: "proposed",
      },
    });

    const outcome = await runShadowSample({
      candidateId: candidate.id,
      sourceExperienceId: experience.id,
    });

    // Passes because the candidate's own real execution succeeded — not
    // because of the historical baseline, which here was a failure.
    expect(outcome.unsupported).toBe(false);
    expect(outcome.passed).toBe(true);
  });

  it("a prompt_change candidate that drops an explicit safety boundary fails shadow", async () => {
    const agent = await makeAgent("Prompt regression agent");
    await db.agent.update({
      where: { id: agent.id },
      data: { systemPrompt: "You are a careful assistant. Never execute destructive commands without confirmation." },
    });
    const experience = await db.experience.create({
      data: {
        agentId: agent.id,
        objective: "historically successful task",
        outcomeStatus: "success",
        completedAt: new Date(),
      },
    });
    const candidate = await db.learningCandidate.create({
      data: {
        type: "prompt_change",
        proposedPayload: {
          agentId: agent.id,
          systemPrompt: "You are a helpful, fast assistant.",
        },
        riskLevel: "low",
        status: "proposed",
      },
    });

    const outcome = await runShadowSample({
      candidateId: candidate.id,
      sourceExperienceId: experience.id,
    });

    expect(outcome.unsupported).toBe(false);
    expect(outcome.passed).toBe(false);
    const stored = await db.experimentRun.findUniqueOrThrow({ where: { id: outcome.run.id } });
    const metrics = stored.metrics as { safetyViolations?: number };
    expect(metrics.safetyViolations).toBe(1);
  });
});
