import { afterAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import {
  createBenchmarkDefinition,
  recordBenchmarkResult,
} from "@/lib/learning/benchmarks";
import {
  detectSkillOpportunity,
  proposeSkillFromPattern,
  runSkillGenerationPipeline,
} from "@/lib/learning/skill-generation";
import { classifySkillPermissionRisk } from "@/lib/neural-engine/policy-service";
import {
  applyLearningCandidate,
  reviewCandidate,
} from "@/lib/neural-engine/learning-service";
import { makeAgent, makeUser, makeWorkspace, uid } from "./db-setup";

afterAll(async () => {
  await db.$disconnect();
});

async function makeSkillReflections(input: {
  agentId: string;
  workspaceId: string;
  topic: string;
}) {
  await Promise.all([1, 2].map((sequence) => db.reflection.create({
    data: {
      agentId: input.agentId,
      workspaceId: input.workspaceId,
      reflectionType: "automatic",
      summary: `Reflection ${sequence}`,
      reusableLesson: input.topic,
      shouldCreateSkill: true,
      confidence: 0.9,
    },
  })));
  const opportunities = await detectSkillOpportunity({
    agentId: input.agentId,
    workspaceId: input.workspaceId,
  });
  return opportunities.find((opportunity) => opportunity.topic === input.topic.toLowerCase())!;
}

describe("Learning Core — consolidated executable-skill risk policy", () => {
  it("classifies generated code as Tier 2/3 and rejects wildcard or undeclared grants", () => {
    const readOnly = classifySkillPermissionRisk(["knowledge:read"], ["knowledge:read"]);
    expect(readOnly.riskLevel).toBe("medium");
    expect(readOnly.autoApproveEligible).toBe(false);

    const sensitive = classifySkillPermissionRisk(
      ["knowledge:read", "network:write"],
      ["knowledge:read", "network:write"],
    );
    expect(sensitive.riskLevel).toBe("high");
    expect(sensitive.autoApproveEligible).toBe(false);

    expect(() => classifySkillPermissionRisk(["*"], ["*"]))
      .toThrow("Wildcard permission");
    expect(() => classifySkillPermissionRisk(["knowledge:write"], ["knowledge:read"]))
      .toThrow("was not explicitly requested");
  });

  it("rechecks protected candidate risk at apply time even if status was tampered", async () => {
    const agent = await makeAgent("Protected Apply Target");
    const candidate = await db.learningCandidate.create({
      data: {
        type: "prompt_change",
        riskLevel: "high",
        status: "auto_approved",
        proposedPayload: {
          agentId: agent.id,
          systemPrompt: "This must not apply without human review.",
        },
      },
    });
    await expect(applyLearningCandidate(candidate.id)).rejects.toThrow(
      /explicit human authorization|human-review audit evidence/,
    );

    await db.learningCandidate.update({
      where: { id: candidate.id },
      data: { status: "approved", reviewedBy: "not-a-real-user" },
    });
    await expect(applyLearningCandidate(candidate.id)).rejects.toThrow(
      /explicit human authorization|human-review audit evidence/,
    );
    expect((await db.agent.findUniqueOrThrow({ where: { id: agent.id } })).systemPrompt)
      .not.toBe("This must not apply without human review.");
  });

  it("deduplicates a real reflection pattern and activates only after every gate and human review", async () => {
    const reviewer = await makeUser();
    const workspace = await makeWorkspace(reviewer.id);
    const agent = await makeAgent("Safe Skill Generator");
    const topic = `reuse validated retrieval plan ${uid("topic")}`;
    const opportunity = await makeSkillReflections({
      agentId: agent.id,
      workspaceId: workspace.id,
      topic,
    });
    expect(opportunity.occurrenceCount).toBe(2);

    const proposalInput = {
      ...opportunity,
      name: "Validated retrieval planner",
      description: "Reuses a validated retrieval plan for repeated tasks.",
      domain: "retrieval",
      requestedPermissions: ["knowledge:read"],
      permissions: ["knowledge:read"],
      inputSchema: { type: "object", required: ["query"] },
      outputSchema: { type: "object", required: ["objectIds"] },
      implementationCommand: [process.execPath, "-e", "process.exit(0)"],
      testCommand: [process.execPath, "-e", "process.exit(0)"],
    };
    await expect(proposeSkillFromPattern({
      ...proposalInput,
      reflectionIds: [...opportunity.reflectionIds, "fabricated-reflection-id"],
    })).rejects.toThrow("does not prove the scoped repeated pattern");
    const proposed = await proposeSkillFromPattern(proposalInput);
    const duplicate = await proposeSkillFromPattern(proposalInput);
    expect(proposed.created).toBe(true);
    expect(duplicate.created).toBe(false);
    expect(duplicate.skill.id).toBe(proposed.skill.id);
    expect(proposed.skill.status).toBe("proposed");
    expect(proposed.candidate.riskLevel).toBe("medium");
    await expect(
      reviewCandidate(proposed.candidate.id, "approve", reviewer.id),
    ).rejects.toThrow("before sandbox, benchmark, and shadow gates pass");

    const benchmark = await createBenchmarkDefinition({
      name: uid("skill-benchmark"),
      category: "skill-generation",
      scoringMethod: "weighted",
    });
    await recordBenchmarkResult({
      benchmarkId: benchmark.id,
      metrics: {
        accuracy: 0.8,
        completionRate: 0.8,
        userAcceptance: 0.8,
        hallucinationRate: 0,
        cost: 1,
        latency: 100,
        safetyViolations: 0,
      },
    });
    await recordBenchmarkResult({
      benchmarkId: benchmark.id,
      candidateId: proposed.candidate.id,
      metrics: {
        accuracy: 0.9,
        completionRate: 0.9,
        userAcceptance: 0.9,
        hallucinationRate: 0,
        cost: 1,
        latency: 100,
        safetyViolations: 0,
      },
    });
    const experiences = await Promise.all(Array.from({ length: 10 }, (_, index) =>
      db.experience.create({
        data: {
          agentId: agent.id,
          workspaceId: workspace.id,
          objective: `Successful fixture ${index}`,
          outcomeStatus: "success",
        },
      }),
    ));

    const foreignReviewer = await makeUser();
    const foreignWorkspace = await makeWorkspace(foreignReviewer.id);
    const foreignBenchmark = await createBenchmarkDefinition({
      name: uid("foreign-skill-benchmark"),
      category: "skill-generation",
      workspaceId: foreignWorkspace.id,
      scoringMethod: "weighted",
    });
    await expect(runSkillGenerationPipeline({
      candidateId: proposed.candidate.id,
      benchmarkId: foreignBenchmark.id,
      sourceExperienceIds: experiences.map((experience) => experience.id),
    })).rejects.toThrow("outside the generated skill's workspace");

    const pipeline = await runSkillGenerationPipeline({
      candidateId: proposed.candidate.id,
      benchmarkId: benchmark.id,
      sourceExperienceIds: experiences.map((experience) => experience.id),
    });
    expect(pipeline.passed).toBe(true);
    expect(pipeline.stage).toBe("awaiting_approval");

    const applied = await reviewCandidate(
      proposed.candidate.id,
      "approve",
      reviewer.id,
      "Sandbox, benchmark, and shadow gates passed.",
    );
    expect(applied.appliedTargetId).toBe(proposed.skill.id);
    const [skill, activeVersion] = await Promise.all([
      db.skill.findUniqueOrThrow({ where: { id: proposed.skill.id } }),
      db.skillVersion.findFirstOrThrow({
        where: { skillId: proposed.skill.id, status: "active" },
      }),
    ]);
    expect(skill.status).toBe("active");
    expect(activeVersion.activatedAt).not.toBeNull();
  });

  it("fails closed when sandbox validation rejects generated implementation", async () => {
    const reviewer = await makeUser();
    const workspace = await makeWorkspace(reviewer.id);
    const agent = await makeAgent("Unsafe Skill Generator");
    const topic = `unsafe network shortcut ${uid("topic")}`;
    const opportunity = await makeSkillReflections({
      agentId: agent.id,
      workspaceId: workspace.id,
      topic,
    });
    const proposed = await proposeSkillFromPattern({
      ...opportunity,
      name: "Unsafe shortcut",
      description: "Fixture that must fail closed.",
      domain: "testing",
      requestedPermissions: ["knowledge:read"],
      permissions: ["knowledge:read"],
      inputSchema: { type: "object" },
      outputSchema: { type: "object" },
      implementationCommand: ["curl", "https://example.com"],
      testCommand: [process.execPath, "-e", "process.exit(0)"],
    });

    const result = await runSkillGenerationPipeline({
      candidateId: proposed.candidate.id,
      benchmarkId: "not-reached",
      sourceExperienceIds: [],
    });
    expect(result.passed).toBe(false);
    expect(result.stage).toBe("sandbox_failed");
    await expect(reviewCandidate(proposed.candidate.id, "approve", reviewer.id))
      .rejects.toThrow("before sandbox, benchmark, and shadow gates pass");
    expect((await db.skill.findUniqueOrThrow({ where: { id: proposed.skill.id } })).status)
      .toBe("proposed");
  });
});
