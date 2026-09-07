import { getAccessibleLearningScope, learningCandidateScopeWhere } from "@/lib/learning/authorization";
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";
import { getEvolutionArchive } from "@/lib/learning/evolution";
import { db } from "@/lib/db";

export async function GET(req: Request) {
  const user = await requireUser().catch(() => null);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const championGroup = searchParams.get("championGroup") ?? undefined;
  const limit = searchParams.get("limit") ? Number(searchParams.get("limit")) : undefined;

  const scopeWhere = learningCandidateScopeWhere(await getAccessibleLearningScope(user.id));
  const [archive, championGroups] = await Promise.all([
    getEvolutionArchive({ championGroup, limit, scopeWhere }),
    db.learningCandidate.findMany({
      where: { AND: [scopeWhere, { championGroup: { not: null } }] },
      distinct: ["championGroup"],
      select: { championGroup: true },
    }),
  ]);

  const groups = await Promise.all(
    championGroups.map(async (g) => ({
      championGroup: g.championGroup!,
      champion: await db.learningCandidate.findFirst({ where: { AND: [scopeWhere, { championGroup: g.championGroup!, survivalStatus: "champion" }] } }),
      challengers: await db.learningCandidate.findMany({ where: { AND: [scopeWhere, { championGroup: g.championGroup!, survivalStatus: "challenger" }] } }),
    })),
  );

  return NextResponse.json({ archive, groups });
}
