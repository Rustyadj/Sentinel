import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { estimateTokens } from "./active-memory";
import { proposeMemoryCandidate } from "./memory-candidate-service";
import { requireAdaptiveScope } from "./scope";
import { assertInputSize } from "./security";

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

export function canonicalizeText(value: string) {
  return value.normalize("NFKC").replace(/\r\n/g, "\n").replace(/[ \t]+$/gm, "").trim();
}

export function deterministicChunks(value: string, targetChars = 3200) {
  const paragraphs = canonicalizeText(value).split(/\n{2,}/);
  const chunks: string[] = [];
  let current = "";
  for (const paragraph of paragraphs) {
    if (current && current.length + paragraph.length + 2 > targetChars) { chunks.push(current); current = ""; }
    current += `${current ? "\n\n" : ""}${paragraph}`;
  }
  if (current) chunks.push(current);
  return chunks;
}

export async function ingestSource(input: {
  sourceSystem: string; sourceId: string; sourceUri?: string; originalAuthor?: string;
  sourceTimestamp?: string; title: string; mimeType?: string; content: string;
  organizationId?: string; workspaceId?: string; projectId?: string; userId?: string;
  importedByAgentId?: string; sensitivity?: string; actorUserId: string;
}) {
  assertInputSize(input.content, 5_000_000);
  await requireAdaptiveScope({ ...input, actorUserId: input.actorUserId, permission: "knowledge.write" });
  const canonicalText = canonicalizeText(input.content);
  const checksum = sha256(canonicalText);
  const unchanged = await db.sourceDocument.findUnique({ where: {
    sourceSystem_sourceId_checksum: { sourceSystem: input.sourceSystem, sourceId: input.sourceId, checksum },
  }, include: { chunks: true } });
  if (unchanged) return { document: unchanged, unchanged: true, candidate: null };
  const previous = await db.sourceDocument.findFirst({ where: { sourceSystem: input.sourceSystem, sourceId: input.sourceId }, orderBy: { version: "desc" } });
  const chunks = deterministicChunks(canonicalText);
  const document = await db.sourceDocument.create({ data: {
    organizationId: input.organizationId, workspaceId: input.workspaceId, projectId: input.projectId,
    userId: input.userId, importedByAgentId: input.importedByAgentId,
    sourceSystem: input.sourceSystem, sourceId: input.sourceId, sourceUri: input.sourceUri,
    originalAuthor: input.originalAuthor, sourceTimestamp: input.sourceTimestamp ? new Date(input.sourceTimestamp) : undefined,
    retrievedAt: new Date(), checksum, version: (previous?.version ?? 0) + 1,
    accessScope: { organizationId: input.organizationId, workspaceId: input.workspaceId, projectId: input.projectId, userId: input.userId } as Prisma.InputJsonValue,
    sensitivity: input.sensitivity ?? "internal", title: input.title, mimeType: input.mimeType,
    canonicalText, metadata: { previousDocumentId: previous?.id ?? null },
    chunks: { create: chunks.map((content, ordinal) => ({ ordinal, content, checksum: sha256(content), tokenEstimate: estimateTokens(content) })) },
  }, include: { chunks: true } });
  if (previous) await db.sourceDocument.update({ where: { id: previous.id }, data: { status: "superseded" } });
  const candidate = await proposeMemoryCandidate({
    organizationId: input.organizationId, workspaceId: input.workspaceId, projectId: input.projectId,
    userId: input.userId, agentId: input.importedByAgentId, candidateType: "summary",
    content: `Source available for review: ${input.title}. ${canonicalText.slice(0, 800)}`,
    structuredPayload: { documentId: document.id, chunkIds: document.chunks.map((chunk) => chunk.id) },
    sourceType: "external_document", sourceTrust: 0.5, confidence: 0.5, importance: 0.5,
    risk: input.sensitivity === "restricted" ? 0.8 : 0.4,
    provenance: { sourceIds: [document.id], evidenceIds: document.chunks.map((chunk) => chunk.id),
      sourceUri: input.sourceUri, sourceAuthor: input.originalAuthor, capturedAt: new Date().toISOString() },
    proposedBy: input.importedByAgentId ?? input.actorUserId,
  }, input.actorUserId);
  return { document, unchanged: false, candidate };
}
