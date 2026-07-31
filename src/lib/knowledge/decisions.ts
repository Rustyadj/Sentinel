// Knowledge Engine — Decision CRUD used by the authenticated Decision API.

import { db } from "@/lib/db";
import type { Prisma } from "@prisma/client";
import type { ApprovalEvent, DecisionStatus } from "./types";
import { removeDecisionFromGraph, syncDecisionToGraph } from "./decisiongraph";

function toInputJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

export interface CreateDecisionParams {
  title: string;
  summary: string;
  rationale?: string;
  alternatives?: string[];
  sourceLinks?: string[];
  projectId?: string;
  supersedesDecisionId?: string;
  createdBy: string;
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

export async function listDecisions(filter: {
  projectId?: string;
  status?: DecisionStatus;
}) {
  return db.decision.findMany({
    where: {
      ...(filter.projectId ? { projectId: filter.projectId } : {}),
      ...(filter.status ? { status: filter.status } : {}),
    },
    orderBy: { createdAt: "desc" },
  });
}

export async function getDecision(id: string) {
  return db.decision.findUnique({ where: { id } });
}
