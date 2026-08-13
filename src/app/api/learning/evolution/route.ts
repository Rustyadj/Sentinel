import { NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";
import { getEvolutionArchive, getChampion, listChallengers } from "@/lib/learning/evolution";
import { db } from "@/lib/db";

export async function GET(req: Request) {
  const user = await requireUser().catch(() => null);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const championGroup = searchParams.get("championGroup") ?? undefined;
  const limit = searchParams.get("limit") ? Number(searchParams.get("limit")) : undefined;

  const [archive, championGroups] = await Promise.all([
    getEvolutionArchive({ championGroup, limit }),
    db.learningCandidate.findMany({
      where: { championGroup: { not: null } },
      distinct: ["championGroup"],
      select: { championGroup: true },
    }),
  ]);

  const groups = await Promise.all(
    championGroups.map(async (g) => ({
      championGroup: g.championGroup!,
      champion: await getChampion(g.championGroup!),
      challengers: await listChallengers(g.championGroup!),
    })),
  );

  return NextResponse.json({ archive, groups });
}
