// Knowledge Engine — Decision CRUD

import { db } from "@/lib/db";
import type { Prisma } from "@prisma/client";
import type { DecisionStatus, DecisionRecord, ApprovalEvent } from "./types";

function toInputJson(value: unknown): Prisma.InputJsonValue {
  return value as unknown as Prisma.InputJsonValue;
}

function toDecisionRecord(record: {
  id: string;
  title: string;
  summary: string;
  status: string;
  rationale: string | null;
  alternatives: unknown;
  sourceLinks: unknown;
  approvalHistory: unknown;
  createdBy: string;
  approvedBy: string | null;
  supersedesDecisionId: string | null;
  createdAt: Date;
  updatedAt: Date;
}): DecisionRecord {
  return {
    id: record.id,
    title: record.title,
    summary: record.summary,
    status: record.status as DecisionStatus,
    rationale: record.rationale ?? undefined,
    alternatives: (record.alternatives as unknown as string[]) ?? [],
    sourceLinks: (record.sourceLinks as unknown as string[]) ?? [],
    approvalHistory: (record.approvalHistory as unknown as ApprovalEvent[]) ?? [],
    createdBy: record.createdBy,
    approvedBy: record.approvedBy ?? undefined,
    supersedesDecisionId: record.supersedesDecisionId ?? undefined,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

export async function createDecision(params: {
  userId: string;
  title: string;
  summary: string;
  rationale?: string;
  alternatives?: string[];
  sourceLinks?: string[];
  projectId?: string;
}): Promise<DecisionRecord> {
  try {
    const initialEvent: ApprovalEvent = {
      actorId: params.createdBy,
      action: "proposed",
      at: new Date().toISOString(),
    };
    const record = await db.decision.create({
      data: {
        title: params.title,
        summary: params.summary,
        rationale: params.rationale ?? null,
        alternatives: toInputJson(params.alternatives ?? []),
        sourceLinks: toInputJson(params.sourceLinks ?? []),
        approvalHistory: toInputJson([initialEvent]),
        createdBy: params.createdBy,
        status: "proposed",
        projectId: params.projectId ?? null,
        userId: params.userId,
      },
    });
    return toDecisionRecord(record);
  } catch (err) {
    throw new Error(
      `createDecision failed: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

export async function createDecision(params: CreateDecisionParams) {
  const initialEvent: ApprovalEvent = {
    actorId: params.createdBy,
    action: "proposed",
    at: new Date().toISOString(),
  };

  return db.decision.create({
    data: {
      title: params.title,
      summary: params.summary,
      status: "proposed",
      rationale: params.rationale ?? null,
      alternatives: toInputJson(params.alternatives ?? []),
      sourceLinks: toInputJson(params.sourceLinks ?? []),
      approvalHistory: toInputJson([initialEvent]),
      createdBy: params.createdBy,
      projectId: params.projectId ?? null,
      supersedesDecisionId: params.supersedesDecisionId ?? null,
    },
  });
}

export async function decideDecision(
  id: string,
  params: {
    status: "approved" | "rejected";
    decidedBy: string;
    note?: string;
  }
) {
  const existing = await db.decision.findUnique({ where: { id } });
  if (!existing) return null;

  const history = Array.isArray(existing.approvalHistory)
    ? existing.approvalHistory
    : [];
  const event: ApprovalEvent = {
    actorId: params.decidedBy,
    action: params.status,
    ...(params.note ? { note: params.note } : {}),
    at: new Date().toISOString(),
  };

  const decision = await db.decision.update({
    where: { id },
    data: {
      status: params.status,
      approvedBy: params.status === "approved" ? params.decidedBy : null,
      approvalHistory: toInputJson([...history, event]),
    },
  });

  // Proposed decisions remain queryable for review/context, but the graph is
  // authoritative: approval adds the node and rejection removes stale graph
  // presence if an already-approved decision is later reconsidered.
  if (params.status === "approved") {
    await syncDecisionToGraph(decision);
  } else {
    await removeDecisionFromGraph(decision.id);
  }

  return decision;
}

export async function rejectDecision(
  id: string,
  rejectedBy: string,
  note?: string
): Promise<DecisionRecord> {
  try {
    const existing = await db.decision.findUniqueOrThrow({ where: { id } });
    const history = (existing.approvalHistory as unknown as ApprovalEvent[]) ?? [];
    const event: ApprovalEvent = {
      actorId: rejectedBy,
      action: "rejected",
      ...(note ? { note } : {}),
      at: new Date().toISOString(),
    };
    const record = await db.decision.update({
      where: { id },
      data: {
        status: "rejected",
        approvalHistory: toInputJson([...history, event]),
      },
    });
    return toDecisionRecord(record);
  } catch (err) {
    throw new Error(
      `rejectDecision failed: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

export async function supersedeDecision(
  id: string,
  newDecisionId: string,
  actorId: string
): Promise<DecisionRecord> {
  try {
    const existing = await db.decision.findUniqueOrThrow({ where: { id } });
    const history = (existing.approvalHistory as unknown as ApprovalEvent[]) ?? [];
    const event: ApprovalEvent = {
      actorId,
      action: "superseded",
      note: `Superseded by ${newDecisionId}`,
      at: new Date().toISOString(),
    };
    const record = await db.decision.update({
      where: { id },
      data: {
        status: "superseded",
        approvalHistory: toInputJson([...history, event]),
      },
    });
    return toDecisionRecord(record);
  } catch (err) {
    throw new Error(
      `supersedeDecision failed: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

export async function listDecisions(filter?: {
  userId: string;
  status?: DecisionStatus;
}): Promise<DecisionRecord[]> {
  try {
    const records = await db.decision.findMany({
      where: { userId: filter?.userId, ...(filter?.status ? { status: filter.status } : {}) },
      orderBy: { createdAt: "desc" },
    });
    return records.map(toDecisionRecord);
  } catch (err) {
    throw new Error(
      `listDecisions failed: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

export async function getDecision(id: string, userId: string): Promise<DecisionRecord | null> {
  try {
    const record = await db.decision.findFirst({ where: { id, userId } });
    if (!record) return null;
    return toDecisionRecord(record);
  } catch (err) {
    throw new Error(
      `getDecision failed: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}
