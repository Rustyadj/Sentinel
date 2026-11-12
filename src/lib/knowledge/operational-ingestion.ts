import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { userHasWorkspacePermission, WorkspaceAccessError } from "@/lib/workspaces/authorization";
import { remember } from "@/lib/neural-engine/memory-ingestion";
import { classifyForIngestion } from "@/lib/neural-engine/ingestion-gate";
import { embedAndStore } from "@/lib/neural-engine/embedding-store";
import { operationalEventSchema, operationalMetadata, type OperationalEvent } from "./operational-types";

export function operationalId(...parts: string[]): string {
  return `op_${createHash("sha256").update(JSON.stringify(parts)).digest("hex")}`;
}
export async function requireOperationalAccess(userId: string, workspaceId: string, write = false) {
  if (!await userHasWorkspacePermission(userId, workspaceId, write ? "project.write" : "project.read")) throw new WorkspaceAccessError("Workspace not found", 404);
}
export async function operationalTransaction<T>(run: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try { return await db.$transaction(run, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 20000 }); }
    catch (error) {
      if (attempt >= 3 || !(error instanceof Prisma.PrismaClientKnownRequestError) || !["P2034", "P2002"].includes(error.code)) throw error;
    }
  }
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  return JSON.stringify(value);
}
const json = (value: unknown) => value as Prisma.InputJsonValue;

/** Existing graph projection plus immutable event ledger; the transaction is the replay boundary. */
export async function ingestOperationalEvent(userId: string, workspaceId: string, input: unknown) {
  await requireOperationalAccess(userId, workspaceId, true);
  const event = operationalEventSchema.parse(input);
  // Apply the existing sensitivity gate to the complete envelope, including evidence and identifiers.
  if (classifyForIngestion({ content: JSON.stringify(event) }).signals.sensitivity === 1) throw new WorkspaceAccessError("Sensitive operational payload rejected", 400);
  const eventId = operationalId(workspaceId, event.source, event.sourceEventId);
  const result = await operationalTransaction(async tx => {
    const existing = await tx.knowledgeEvent.findUnique({ where: { id: eventId } });
    if (existing) {
      const original = existing.payload as { event: OperationalEvent };
      if (canonical(original.event) !== canonical(event)) throw new WorkspaceAccessError("Source event identity reused with different payload", 400);
      return { eventId, duplicate: true, memories: [] as { memoryId: string; text: string }[] };
    }
    const memories: { memoryId: string; text: string }[] = [];
    const ids = new Map<string, string>();
    for (const entity of event.entities) {
      if (entity.objectId) {
        const existingNode = await tx.knowledgeObject.findFirst({ where: { id: entity.objectId, workspaceId, type: entity.type, validTo: null, OR: [{ sourceType: { startsWith: "operational:" } }, { metadata: { path: ["operational"], equals: true } }] }, select: { id: true } });
        if (!existingNode) throw new WorkspaceAccessError("Canonical entity not found", 404);
      }
      ids.set(entity.sourceId, entity.objectId ?? operationalId(workspaceId, event.source, entity.sourceId));
    }
    if (new Set(ids.values()).size !== ids.size) throw new WorkspaceAccessError("Duplicate canonical entity in envelope", 400);
    for (const entity of event.entities) {
      const id = ids.get(entity.sourceId)!;
      const prior = await tx.knowledgeObject.findUnique({ where: { id } });
      if (prior && prior.type !== entity.type) throw new WorkspaceAccessError("Entity identity cannot change type", 400);
      const previous = operationalMetadata(prior?.metadata);
      // Imported history is preserved in the ledger without rolling the current projection back.
      if (previous && (Date.parse(previous.eventTime) > Date.parse(event.eventTime) || (Date.parse(previous.eventTime) === Date.parse(event.eventTime) && previous.sourceEventId >= eventId))) continue;
      let memoryId = previous?.memoryId ?? null;
      if (entity.type === "Incident") {
        const related = event.relationships.filter(edge => edge.from === entity.sourceId || edge.to === entity.sourceId);
        const participants = related.map(edge => {
          const other = event.entities.find(item => item.sourceId === (edge.from === entity.sourceId ? edge.to : edge.from))!;
          return `${edge.type}: ${other.title}${other.facts.outcome ? ` (${other.facts.outcome})` : ""}${other.summary ? ` — ${other.summary}` : ""}`;
        });
        const text = `Incident ${entity.title} happened at ${entity.facts.startedAt ?? event.eventTime}. ${entity.summary ?? ""} Root cause: ${entity.facts.rootCauseConfirmed ? entity.facts.rootCause ?? "unknown" : "unconfirmed"}. Status: ${entity.facts.status ?? "unknown"}. Resolved at: ${entity.facts.resolvedAt ?? "unknown"}. ${participants.join("; ")}. Evidence: ${event.evidence.join(" ")}. Source: ${event.source}/${entity.sourceId}.`;
        const admission = await remember({ owner: userId, scope: "workspace", workspaceId, eventKind: "incident", content: text, source: `operational:${eventId}`, speaker: "system", eventTime: new Date(event.eventTime), tags: ["operational", "incident", id], skipReconsolidation: true }, tx);
        memoryId = admission.memoryId;
        if (memoryId) memories.push({ memoryId, text });
      }
      const metadata = { ...(prior?.metadata as object ?? {}), operational: true, source: event.source, sourceId: entity.sourceId, sourceEventId: eventId, eventTime: event.eventTime, evidence: event.evidence, facts: entity.facts, memoryId };
      const data = { title: entity.title, summary: entity.summary, metadata: json(metadata), sourceEventId: eventId, changedBy: userId, version: (prior?.version ?? 0) + 1 };
      await tx.knowledgeObject.upsert({ where: { id }, create: { ...data, id, type: entity.type, sourceType: `operational:${workspaceId}:${event.source}`, sourceId: entity.sourceId, workspaceId, userId, scope: "workspace", validFrom: new Date(event.eventTime) }, update: data });
    }
    for (const relation of event.relationships) {
      const fromObjectId = ids.get(relation.from)!;
      const toObjectId = ids.get(relation.to)!;
      const key = { fromObjectId, toObjectId, type: relation.type };
      const previous = await tx.knowledgeEdge.findUnique({ where: { fromObjectId_toObjectId_type: key } });
      const meta = previous?.metadata as { eventTime?: string; status?: string } | undefined;
      // A rejected/confirmed proposal is not silently reset by a source replay.
      if (meta?.eventTime && Date.parse(meta.eventTime) >= Date.parse(event.eventTime)) continue;
      const data = { weight: relation.confidence, metadata: json({ operational: true, eventTime: event.eventTime, source: event.source, sourceId: event.sourceEventId, evidence: relation.evidence, confidence: relation.confidence, status: relation.type === "SERVICE_CORRELATED_WITH_SERVICE" ? "proposed" : "observed" }), validFrom: new Date(relation.validFrom), validTo: relation.validTo ? new Date(relation.validTo) : null, sourceEventId: eventId, changedBy: userId, version: (previous?.version ?? 0) + 1 };
      await tx.knowledgeEdge.upsert({ where: { fromObjectId_toObjectId_type: key }, create: { ...key, ...data }, update: data });
    }
    await tx.knowledgeEvent.create({ data: { id: eventId, type: "operational.ingested", workspaceId, userId, payload: json({ event, entityIds: Object.fromEntries(ids), memoryIds: memories.map(item => item.memoryId) }) } });
    return { eventId, duplicate: false, memories };
  });
  // Provider outages do not roll back authoritative ingestion. Replaying can be followed by embedding backfill.
  const embeddings = await embedAndStore(result.memories);
  return { eventId: result.eventId, duplicate: result.duplicate, memoriesAdmitted: result.memories.length, embeddingsStored: embeddings.stored };
}
