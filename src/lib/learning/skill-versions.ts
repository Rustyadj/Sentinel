import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";

export type SkillApprovalLevel = 1 | 2 | 3;

export interface CreateSkillVersionInput {
  implementationType?: string;
  implementation?: unknown;
  dependencies?: string[];
  inputSchema?: unknown;
  outputSchema?: unknown;
  permissions?: unknown;
  tests?: unknown;
  benchmarkResultIds?: string[];
  approvalLevel?: SkillApprovalLevel;
}

function toJson(value: unknown): Prisma.InputJsonValue {
  return (value ?? {}) as Prisma.InputJsonValue;
}

function normalizeApprovalLevel(value: number | undefined): SkillApprovalLevel {
  if (value === undefined) return 2;
  if (value === 1 || value === 2 || value === 3) return value;
  throw new Error("approvalLevel must be 1, 2, or 3");
}

/**
 * Append a SkillVersion without mutating history. A skill's first version is
 * made active so every skill has a usable baseline. After that, only Level 1
 * versions activate immediately; Level 2/3 versions remain drafts until an
 * explicit activation step. Approval level is an input policy decision, not
 * version state, so it is deliberately not persisted as a second authority.
 */
export async function createSkillVersion(skillId: string, input: CreateSkillVersionInput) {
  const approvalLevel = normalizeApprovalLevel(input.approvalLevel);

  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`skill-version:${skillId}`})) IS NULL AS locked`;
    const skill = await tx.skill.findUniqueOrThrow({ where: { id: skillId } });
    const [latest, currentActive] = await Promise.all([
      tx.skillVersion.findFirst({
        where: { skillId },
        orderBy: { version: "desc" },
      }),
      tx.skillVersion.findFirst({ where: { skillId, status: "active" } }),
    ]);
    const version = latest ? latest.version + 1 : Math.max(1, skill.version);
    const activateImmediately = !latest || approvalLevel === 1;
    const implementation = input.implementation ?? currentActive?.implementation;
    const inputSchema = input.inputSchema ?? currentActive?.inputSchema ?? skill.inputSchema;
    const outputSchema = input.outputSchema ?? currentActive?.outputSchema ?? skill.outputSchema;

    const created = await tx.skillVersion.create({
      data: {
        skillId,
        version,
        implementationType:
          input.implementationType?.trim() || currentActive?.implementationType || null,
        ...(implementation != null
          ? { implementation: toJson(implementation) }
          : {}),
        dependencies: input.dependencies ?? currentActive?.dependencies ?? [],
        ...(inputSchema != null ? { inputSchema: toJson(inputSchema) } : {}),
        ...(outputSchema != null ? { outputSchema: toJson(outputSchema) } : {}),
        permissions: toJson(input.permissions ?? currentActive?.permissions ?? skill.permissions ?? []),
        tests: toJson(input.tests ?? currentActive?.tests ?? skill.tests ?? []),
        benchmarkResultIds: input.benchmarkResultIds ?? [],
        status: activateImmediately ? "active" : "draft",
        activatedAt: activateImmediately ? new Date() : null,
      },
    });

    if (!activateImmediately) return created;

    await retireOtherActiveVersions(tx, skillId, created.id);
    await syncSkillConvenienceFields(tx, skillId, created);
    return created;
  });
}

/** Activate one immutable version and retire the previously-active version. */
export async function activateSkillVersion(id: string) {
  return db.$transaction(async (tx) => {
    const requested = await tx.skillVersion.findUniqueOrThrow({ where: { id } });
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`skill-version:${requested.skillId}`})) IS NULL AS locked`;
    const version = await tx.skillVersion.findUniqueOrThrow({ where: { id } });
    if (version.status === "rolled_back" || version.status === "retired") {
      throw new Error(`A ${version.status} skill version cannot be activated`);
    }

    const activatedAt = version.activatedAt ?? new Date();
    await retireOtherActiveVersions(tx, version.skillId, version.id);
    const activated = await tx.skillVersion.update({
      where: { id: version.id },
      data: { status: "active", activatedAt, retiredAt: null },
    });
    await syncSkillConvenienceFields(tx, version.skillId, activated);
    return activated;
  });
}

export async function listSkillVersions(skillId: string) {
  if (!skillId.trim()) throw new Error("skillId is required");
  return db.skillVersion.findMany({
    where: { skillId },
    orderBy: { version: "desc" },
  });
}

export async function listSkillsForVersioning() {
  return db.skill.findMany({
    select: {
      id: true,
      name: true,
      domain: true,
      status: true,
      version: true,
      _count: { select: { versions: true } },
    },
    orderBy: [{ updatedAt: "desc" }, { name: "asc" }],
  });
}

async function retireOtherActiveVersions(
  tx: Prisma.TransactionClient,
  skillId: string,
  activeVersionId: string,
) {
  await tx.skillVersion.updateMany({
    where: { skillId, status: "active", id: { not: activeVersionId } },
    data: { status: "retired", retiredAt: new Date() },
  });
}

async function syncSkillConvenienceFields(
  tx: Prisma.TransactionClient,
  skillId: string,
  version: {
    version: number;
    inputSchema: Prisma.JsonValue;
    outputSchema: Prisma.JsonValue;
    permissions: Prisma.JsonValue;
    tests: Prisma.JsonValue;
  },
) {
  await tx.skill.update({
    where: { id: skillId },
    data: {
      version: version.version,
      status: "active",
      inputSchema: version.inputSchema === null ? Prisma.DbNull : version.inputSchema,
      outputSchema: version.outputSchema === null ? Prisma.DbNull : version.outputSchema,
      permissions: version.permissions === null ? Prisma.JsonNull : version.permissions,
      tests: version.tests === null ? Prisma.JsonNull : version.tests,
    },
  });
}
