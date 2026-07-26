import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requireAdaptiveScope } from "./scope";

export async function searchEpisodes(input: {
  query: string; actorUserId: string; organizationId?: string; workspaceId?: string; projectId?: string; limit?: number;
}) {
  await requireAdaptiveScope({ ...input, permission: "run.read" });
  const limit = Math.max(1, Math.min(100, input.limit ?? 30));
  const tenant = input.projectId
    ? Prisma.sql`e."projectId" = ${input.projectId}`
    : input.workspaceId
      ? Prisma.sql`e."workspaceId" = ${input.workspaceId}`
      : input.organizationId
        ? Prisma.sql`e."organizationId" = ${input.organizationId}`
        : Prisma.sql`e."actingUserId" = ${input.actorUserId}`;
  const experiences = await db.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
    SELECT e.*, o."errors", o."externalSignals",
      coalesce(json_agg(json_build_object('id', v."id", 'critique', v."critique", 'evidence', v."evidence"))
        FILTER (WHERE v."id" IS NOT NULL), '[]') AS evaluations
    FROM "neural_experiences" e
    LEFT JOIN "neural_outcomes" o ON o."experienceId" = e."id"
    LEFT JOIN "neural_evaluations" v ON v."experienceId" = e."id"
    WHERE ${tenant} AND (
      to_tsvector('english', coalesce(e."objective", '') || ' ' || coalesce(e."actionsTaken"::text, '') || ' ' ||
        coalesce(array_to_string(e."toolsUsed", ' '), '') || ' ' || coalesce(e."userFeedback", '') || ' ' ||
        coalesce(e."evaluatorSummary", '') || ' ' || coalesce(o."errors"::text, '') || ' ' ||
        coalesce(v."critique", '') || ' ' || coalesce(v."evidence"::text, ''))
      @@ plainto_tsquery('english', ${input.query})
    )
    GROUP BY e."id", o."id"
    ORDER BY e."createdAt" DESC LIMIT ${limit}
  `);
  const roomWhere = input.projectId ? { projectId: input.projectId } : { userId: input.actorUserId };
  const messages = await db.message.findMany({ where: {
    chatRoom: roomWhere,
    content: { contains: input.query, mode: "insensitive" },
  }, include: { chatRoom: { select: { id: true, name: true, projectId: true } } }, orderBy: { createdAt: "desc" }, take: limit });
  return { experiences, messages };
}
