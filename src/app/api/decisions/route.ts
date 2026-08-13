import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";
import { createDecision, listDecisions } from "@/lib/knowledge/decisions";
import type { DecisionStatus } from "@/lib/knowledge/types";

const DECISION_STATUSES = new Set<DecisionStatus>([
  "proposed",
  "approved",
  "rejected",
  "superseded",
]);

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

export async function GET(req: NextRequest) {
  try {
    await requireUser();
    const projectId = req.nextUrl.searchParams.get("projectId") ?? undefined;
    const rawStatus = req.nextUrl.searchParams.get("status");
    if (rawStatus && !DECISION_STATUSES.has(rawStatus as DecisionStatus)) {
      return NextResponse.json({ error: "Invalid decision status" }, { status: 400 });
    }

    const decisions = await listDecisions({
      projectId,
      status: rawStatus as DecisionStatus | undefined,
    });
    return NextResponse.json(decisions);
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[GET /api/decisions]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const body = (await req.json()) as {
      title?: unknown;
      summary?: unknown;
      rationale?: unknown;
      alternatives?: unknown;
      sourceLinks?: unknown;
      projectId?: unknown;
      supersedesDecisionId?: unknown;
    };

    if (typeof body.title !== "string" || !body.title.trim()) {
      return NextResponse.json({ error: "Missing required field: title" }, { status: 400 });
    }
    if (typeof body.summary !== "string" || !body.summary.trim()) {
      return NextResponse.json({ error: "Missing required field: summary" }, { status: 400 });
    }
    if (body.alternatives !== undefined && !isStringArray(body.alternatives)) {
      return NextResponse.json({ error: "alternatives must be an array of strings" }, { status: 400 });
    }
    if (body.sourceLinks !== undefined && !isStringArray(body.sourceLinks)) {
      return NextResponse.json({ error: "sourceLinks must be an array of strings" }, { status: 400 });
    }
    if (body.rationale !== undefined && typeof body.rationale !== "string") {
      return NextResponse.json({ error: "rationale must be a string" }, { status: 400 });
    }
    if (body.projectId !== undefined && typeof body.projectId !== "string") {
      return NextResponse.json({ error: "projectId must be a string" }, { status: 400 });
    }
    if (
      body.supersedesDecisionId !== undefined &&
      typeof body.supersedesDecisionId !== "string"
    ) {
      return NextResponse.json(
        { error: "supersedesDecisionId must be a string" },
        { status: 400 }
      );
    }

    const decision = await createDecision({
      title: body.title.trim(),
      summary: body.summary.trim(),
      rationale: typeof body.rationale === "string" ? body.rationale.trim() : undefined,
      alternatives: body.alternatives as string[] | undefined,
      sourceLinks: body.sourceLinks as string[] | undefined,
      projectId: typeof body.projectId === "string" && body.projectId ? body.projectId : undefined,
      supersedesDecisionId:
        typeof body.supersedesDecisionId === "string" && body.supersedesDecisionId
          ? body.supersedesDecisionId
          : undefined,
      createdBy: user.id,
    });

    return NextResponse.json(decision, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[POST /api/decisions]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
