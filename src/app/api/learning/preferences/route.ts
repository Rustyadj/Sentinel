import { NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";
import {
  listPreferenceEvidence,
  recordPreferenceEvidence,
  type PreferenceEvidenceSourceType,
} from "@/lib/learning/preferences";
import { MemoryScopeError } from "@/lib/knowledge/memory-scope";

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

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const text = (key: string) => (typeof body?.[key] === "string" ? (body[key] as string) : undefined);
  const key = text("key"), value = text("value"), sourceType = text("sourceType"), evidence = text("evidence");
  if (!key || !value || !sourceType || !evidence) {
    return NextResponse.json(
      { error: "key, value, sourceType, and evidence are required" },
      { status: 400 },
    );
  }
  // Explicit allowlist: the body never chooses the owner, and an agentId or
  // workspaceId it names is authorised by recordPreferenceEvidence, not trusted.
  const observedAt = text("observedAt") ? new Date(text("observedAt")!) : undefined;
  const expiresAt = text("expiresAt") ? new Date(text("expiresAt")!) : undefined;
  const input = {
    key, value, evidence,
    sourceType: sourceType as PreferenceEvidenceSourceType,
    userId: user.id,
    workspaceId: text("workspaceId") ?? null,
    sourceId: text("sourceId") ?? null,
    ...(typeof body?.supportsPreference === "boolean" ? { supportsPreference: body.supportsPreference } : {}),
    ...(observedAt && !Number.isNaN(observedAt.getTime()) ? { observedAt } : {}),
    ...(expiresAt && !Number.isNaN(expiresAt.getTime()) ? { expiresAt } : {}),
    ...(body?.metadata && typeof body.metadata === "object" && !Array.isArray(body.metadata) ? { metadata: body.metadata as Record<string, unknown> } : {}),
  };

  try {
    const result = await recordPreferenceEvidence(input);
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    const status = error instanceof MemoryScopeError && error.code === "forbidden" ? 403 : 400;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status },
    );
  }
}
