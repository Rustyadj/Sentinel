import { NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";
import { getCandidateLineage } from "@/lib/learning/evolution";
import { learningAccessErrorResponse, requireLearningCandidateAccess } from "@/lib/learning/authorization";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser().catch(() => null);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  try {
    await requireLearningCandidateAccess(user.id, id, "workspace.read");
    const lineage = await getCandidateLineage(id);
    return NextResponse.json(lineage);
  } catch (error) {
    return learningAccessErrorResponse(error);
  }
}
