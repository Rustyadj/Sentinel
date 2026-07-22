// Sentinel Neural Engine — Contradiction handling
//
// Competing claims are never silently overwritten. A Contradiction groups
// Claims (each with its own confidence/source), which can each carry
// Evidence. Resolution marks a winner but keeps every claim on record.

import { db } from "@/lib/db";
import { emitNeuralEvent } from "./event-service";

export interface ClaimInput {
  statement: string;
  sourceType: string;
  sourceId: string;
  confidence?: number;
}

export interface RecordContradictionParams {
  subject: string;
  claims: ClaimInput[];
}

/** Open a new contradiction with its initial competing claims. */
export async function recordContradiction(params: RecordContradictionParams) {
  const contradiction = await db.contradiction.create({
    data: {
      subject: params.subject,
      claims: {
        create: params.claims.map((c) => ({
          statement: c.statement,
          sourceType: c.sourceType,
          sourceId: c.sourceId,
          confidence: c.confidence ?? 0.5,
        })),
      },
    },
    include: { claims: true },
  });

  await emitNeuralEvent({
    type: "contradiction.detected",
    payload: { contradictionId: contradiction.id, subject: contradiction.subject },
  });

  return contradiction;
}

/** Add another competing claim to an existing contradiction. */
export async function addClaim(contradictionId: string, claim: ClaimInput) {
  return db.claim.create({
    data: {
      contradictionId,
      statement: claim.statement,
      sourceType: claim.sourceType,
      sourceId: claim.sourceId,
      confidence: claim.confidence ?? 0.5,
    },
  });
}

/**
 * Resolve a contradiction by accepting one claim. Every other claim on the
 * contradiction is marked `superseded` — not deleted — so disagreement
 * history is preserved and retrievable.
 */
export async function resolveContradiction(
  contradictionId: string,
  acceptedClaimId: string,
  resolvedBy: string,
  resolutionNote?: string,
) {
  const claims = await db.claim.findMany({ where: { contradictionId } });
  if (!claims.some((c) => c.id === acceptedClaimId)) {
    throw new Error(`Claim ${acceptedClaimId} does not belong to contradiction ${contradictionId}.`);
  }

  await db.$transaction([
    db.claim.update({
      where: { id: acceptedClaimId },
      data: { status: "accepted" },
    }),
    ...claims
      .filter((c) => c.id !== acceptedClaimId)
      .map((c) =>
        db.claim.update({ where: { id: c.id }, data: { status: "superseded" } }),
      ),
    db.contradiction.update({
      where: { id: contradictionId },
      data: {
        status: "resolved",
        resolvedBy,
        resolvedAt: new Date(),
        resolutionNote: resolutionNote ?? null,
      },
    }),
  ]);

  await emitNeuralEvent({
    type: "contradiction.resolved",
    payload: { contradictionId, acceptedClaimId, resolvedBy },
  });

  return db.contradiction.findUniqueOrThrow({
    where: { id: contradictionId },
    include: { claims: true },
  });
}

export async function listOpenContradictions() {
  return db.contradiction.findMany({
    where: { status: "open" },
    include: { claims: true },
    orderBy: { createdAt: "desc" },
  });
}

/**
 * For retrieval preference: given a subject's claims, prefer the resolved
 * winner if any, else the highest-confidence competing claim — but always
 * return the full set so callers can still surface disagreement.
 */
export async function getPreferredClaim(contradictionId: string) {
  const claims = await db.claim.findMany({ where: { contradictionId } });
  const accepted = claims.find((c) => c.status === "accepted");
  if (accepted) return { preferred: accepted, all: claims };
  const ranked = [...claims].sort((a, b) => b.confidence - a.confidence);
  return { preferred: ranked[0] ?? null, all: claims };
}
