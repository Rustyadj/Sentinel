import { NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";
import {
  listPreferenceEvidence,
  recordPreferenceEvidence,
  type PreferenceEvidenceSourceType,
} from "@/lib/learning/preferences";

export async function GET(req: Request) {
  const user = await requireUser().catch(() => null);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const sourceType = searchParams.get("sourceType") as PreferenceEvidenceSourceType | null;
  const evidence = await listPreferenceEvidence({
    userId: user.id,
    sourceType: sourceType ?? undefined,
    conflictsOnly: searchParams.get("conflicts") === "true",
    limit: searchParams.get("limit") ? Number(searchParams.get("limit")) : undefined,
  });
  return NextResponse.json(evidence);
}

export async function POST(req: Request) {
  const user = await requireUser().catch(() => null);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  if (!body?.key || !body?.value || !body?.sourceType || !body?.evidence) {
    return NextResponse.json(
      { error: "key, value, sourceType, and evidence are required" },
      { status: 400 },
    );
  }

  try {
    const result = await recordPreferenceEvidence({ ...body, userId: user.id });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 400 },
    );
  }
}
