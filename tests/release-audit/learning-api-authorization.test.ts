import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { createFeatureFlag } from "@/lib/learning/feature-flags";
import { PATCH as patchFeatureFlag } from "@/app/api/learning/feature-flags/[id]/route";
import { PATCH as patchReflection } from "@/app/api/learning/reflections/[id]/route";
import { GET as getTrustProfile } from "@/app/api/learning/trust/route";
import { POST as postBenchmarkResult } from "@/app/api/learning/benchmarks/[id]/results/route";
import { POST as postShadowSample } from "@/app/api/learning/candidates/[id]/shadow/route";
import { POST as postCandidateRollback } from "@/app/api/neural/learning-candidates/[id]/rollback/route";
import {
  makeUser,
  makeWorkspace,
  uid,
} from "../neural-engine/db-setup";

const auth = vi.hoisted(() => ({ requireUser: vi.fn() }));

vi.mock("@/lib/current-user", () => ({ requireUser: auth.requireUser }));

afterAll(async () => {
  await db.$disconnect();
});

beforeEach(() => {
  auth.requireUser.mockReset();
});

async function makeTenantFixture() {
  const owner = await makeUser();
  const outsider = await makeUser();
  const workspace = await makeWorkspace(owner.id, "Release audit tenant");
  const agent = await db.agent.create({
    data: {
      name: uid("tenant-agent"),
      role: "tester",
      avatar: "shield",
      color: "#6366f1",
      model: "test-model",
      toolPermissions: [],
      workspaceId: workspace.id,
    },
  });
  return { owner, outsider, workspace, agent };
}

describe("release audit — /api/learning tenant authorization", () => {
  it("does not let an outsider mutate another workspace's feature flag", async () => {
    const { outsider, workspace } = await makeTenantFixture();
    const flag = await createFeatureFlag({
      key: uid("tenant-flag"),
      name: "Tenant flag",
      scopeType: "workspace",
      scopeId: workspace.id,
      enabled: false,
    });
    auth.requireUser.mockResolvedValue(outsider);

    const response = await patchFeatureFlag(
      new Request(`http://localhost/api/learning/feature-flags/${flag.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled: true, rolloutPercentage: 100 }),
      }),
      { params: Promise.resolve({ id: flag.id }) },
    );

    expect(response.status).toBe(404);
    expect((await db.featureFlag.findUniqueOrThrow({ where: { id: flag.id } })).enabled)
      .toBe(false);
  });

  it("does not let an outsider modify another workspace's reflection", async () => {
    const { outsider, workspace, agent } = await makeTenantFixture();
    const reflection = await db.reflection.create({
      data: {
        agentId: agent.id,
        workspaceId: workspace.id,
        reflectionType: "manual",
        summary: "tenant-private reflection",
      },
    });
    auth.requireUser.mockResolvedValue(outsider);

    const response = await patchReflection(
      new Request(`http://localhost/api/learning/reflections/${reflection.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: "dismissed" }),
      }),
      { params: Promise.resolve({ id: reflection.id }) },
    );

    expect(response.status).toBe(404);
    expect((await db.reflection.findUniqueOrThrow({ where: { id: reflection.id } })).status)
      .toBe("open");
  });

  it("does not expose another workspace agent's trust history", async () => {
    const { outsider, agent } = await makeTenantFixture();
    await db.trustEvent.create({
      data: {
        agentId: agent.id,
        domain: "workflow",
        eventType: "successful_candidate_applied",
        delta: 0.02,
        reason: "tenant-private evidence",
      },
    });
    auth.requireUser.mockResolvedValue(outsider);

    const response = await getTrustProfile(
      new Request(`http://localhost/api/learning/trust?agentId=${agent.id}`),
    );

    expect(response.status).toBe(404);
    expect(JSON.stringify(await response.json())).not.toContain("tenant-private evidence");
  });

  it("does not let an outsider fabricate another workspace's benchmark result", async () => {
    const { outsider, workspace } = await makeTenantFixture();
    const benchmark = await db.benchmarkDefinition.create({
      data: {
        name: uid("tenant-benchmark"),
        category: "release-audit",
        workspaceId: workspace.id,
        scoringMethod: "weighted",
      },
    });
    auth.requireUser.mockResolvedValue(outsider);

    const response = await postBenchmarkResult(
      new Request(`http://localhost/api/learning/benchmarks/${benchmark.id}/results`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          metrics: {
            accuracy: 1,
            completionRate: 1,
            userAcceptance: 1,
            hallucinationRate: 0,
            latency: 1,
            cost: 0,
            safetyViolations: 0,
          },
        }),
      }),
      { params: Promise.resolve({ id: benchmark.id }) },
    );

    expect(response.status).toBe(404);
    expect(await db.benchmarkResult.count({ where: { benchmarkId: benchmark.id } })).toBe(0);
  });

  it("does not let an outsider run shadow work for another workspace's candidate", async () => {
    const { outsider, workspace, agent } = await makeTenantFixture();
    const experience = await db.experience.create({
      data: {
        agentId: agent.id,
        workspaceId: workspace.id,
        objective: "private fixture",
        outcomeStatus: "success",
        completedAt: new Date(),
      },
    });
    const candidate = await db.learningCandidate.create({
      data: {
        experienceId: experience.id,
        type: "memory",
        proposedPayload: { content: "private candidate" },
        riskLevel: "low",
        status: "proposed",
      },
    });
    auth.requireUser.mockResolvedValue(outsider);

    const response = await postShadowSample(
      new Request(`http://localhost/api/learning/candidates/${candidate.id}/shadow`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sourceExperienceId: experience.id }),
      }),
      { params: Promise.resolve({ id: candidate.id }) },
    );

    expect(response.status).toBe(404);
    expect(await db.experimentRun.count({ where: { candidateId: candidate.id } })).toBe(0);
  });

  it("does not let an outsider roll back another workspace's candidate", async () => {
    const { outsider, workspace, agent } = await makeTenantFixture();
    const experience = await db.experience.create({
      data: {
        agentId: agent.id,
        workspaceId: workspace.id,
        objective: "private rollback fixture",
        outcomeStatus: "success",
        completedAt: new Date(),
      },
    });
    const candidate = await db.learningCandidate.create({
      data: {
        experienceId: experience.id,
        type: "memory",
        proposedPayload: { content: "private applied candidate" },
        appliedTargetId: null,
        riskLevel: "low",
        status: "approved",
      },
    });
    auth.requireUser.mockResolvedValue(outsider);

    const response = await postCandidateRollback(
      new Request(`http://localhost/api/neural/learning-candidates/${candidate.id}/rollback`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason: "unauthorized" }),
      }),
      { params: Promise.resolve({ id: candidate.id }) },
    );

    expect(response.status).toBe(404);
    expect((await db.learningCandidate.findUniqueOrThrow({ where: { id: candidate.id } })).status)
      .toBe("approved");
  });
});
