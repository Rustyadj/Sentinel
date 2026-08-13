import { db } from "@/lib/db";
import type { Prisma } from "@prisma/client";
import { appendEvolutionEvent, lifecycleStageFor } from "./evolution";
import { removeSkillFromGraph, syncSkillToGraph } from "./graph";

const SKILL_TRANSITIONS: Record<string, string[]> = {
  proposed: ["testing", "deprecated"],
  testing: ["approved", "deprecated"],
  approved: ["installed", "deprecated"],
  installed: ["deprecated"],
  deprecated: [],
};

export function skillGate(approvalLevel: number, trustScore = 50) {
  if (approvalLevel === 3) return { next: "human_approval", reason: "Level 3 always requires human approval" };
  if (approvalLevel === 2) {
    return trustScore >= 80
      ? { next: "shadow_auto_promote", reason: "Level 2 and trust is at least 80" }
      : { next: "human_approval", reason: "Level 2 requires approval at this trust score" };
  }
  return trustScore >= 40
    ? { next: "auto_deploy", reason: "Level 1 and trust is at least 40" }
    : { next: "human_approval", reason: "Trust below 40 blocks autonomous deployment" };
}

export async function createSkill(input: {
  name: string;
  description: string;
  dependencies?: string[];
  tests?: unknown;
  benchmarks?: unknown;
  ownerId?: string;
  version?: string;
  approvalLevel?: number;
}) {
  const approvalLevel = input.approvalLevel ?? 1;
  if (![1, 2, 3].includes(approvalLevel)) throw new Error("approvalLevel must be 1, 2, or 3");
  const skill = await db.skill.create({
    data: {
      name: input.name,
      description: input.description,
      dependencies: input.dependencies ?? [],
      tests: (input.tests ?? []) as Prisma.InputJsonValue,
      benchmarks: (input.benchmarks ?? []) as Prisma.InputJsonValue,
      ownerId: input.ownerId ?? null,
      version: input.version ?? "0.1.0",
      approvalLevel,
    },
  });
  await syncSkillToGraph(skill);
  await appendEvolutionEvent({
    title: `Skill proposed: ${skill.name}`,
    stage: "created",
    relatedType: "skill",
    relatedId: skill.id,
    metadata: { approvalLevel: skill.approvalLevel, version: skill.version },
  });
  return skill;
}

export async function updateSkill(
  id: string,
  input: Partial<{
    name: string;
    description: string;
    dependencies: string[];
    tests: unknown;
    benchmarks: unknown;
    ownerId: string | null;
    version: string;
    approvalLevel: number;
    status: string;
  }>,
  approval?: { humanUserId?: string },
) {
  const existing = await db.skill.findUniqueOrThrow({ where: { id } });
  if (input.approvalLevel !== undefined && ![1, 2, 3].includes(input.approvalLevel)) {
    throw new Error("approvalLevel must be 1, 2, or 3");
  }
  if (input.status && input.status !== existing.status && !SKILL_TRANSITIONS[existing.status]?.includes(input.status)) {
    throw new Error(`Invalid skill transition: ${existing.status} → ${input.status}`);
  }
  if (input.status === "approved" && existing.approvalLevel >= 2 && !approval?.humanUserId) {
    throw new Error(`Level ${existing.approvalLevel} skills require explicit human approval`);
  }

  const { tests, benchmarks, approvalLevel, ...fields } = input;
  const skill = await db.skill.update({
    where: { id },
    data: {
      ...fields,
      ...(tests !== undefined ? { tests: tests as Prisma.InputJsonValue } : {}),
      ...(benchmarks !== undefined ? { benchmarks: benchmarks as Prisma.InputJsonValue } : {}),
      // Level 3 is sticky even if a later edit asks for a lower value.
      ...(approvalLevel !== undefined
        ? { approvalLevel: Math.max(existing.approvalLevel, approvalLevel) }
        : {}),
    },
  });
  await syncSkillToGraph(skill);
  if (input.status && input.status !== existing.status) {
    await appendEvolutionEvent({
      title: `Skill ${input.status}: ${skill.name}`,
      stage: lifecycleStageFor("skill", input.status),
      relatedType: "skill",
      relatedId: skill.id,
      metadata: { from: existing.status, to: input.status, approvedByUserId: approval?.humanUserId },
    });
  }
  return skill;
}

export async function listSkills(params?: { status?: string; approvalLevel?: number; limit?: number }) {
  return db.skill.findMany({
    where: {
      ...(params?.status ? { status: params.status } : {}),
      ...(params?.approvalLevel ? { approvalLevel: params.approvalLevel } : {}),
    },
    orderBy: { updatedAt: "desc" },
    take: params?.limit ?? 100,
  });
}

export async function getSkill(id: string) {
  return db.skill.findUnique({ where: { id } });
}

export async function deleteSkill(id: string) {
  const skill = await db.skill.delete({ where: { id } });
  await removeSkillFromGraph(id);
  return skill;
}
