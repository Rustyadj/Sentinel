// Knowledge Engine — wiki-link ([[Note Title]]) parsing and backlink resolution

import { db } from "@/lib/db";
import { getOrCreateKnowledgeObjectForSource } from "@/lib/neural-engine/knowledge-bridge";

export function parseWikiLinks(content: string): string[] {
  const matches = content.matchAll(/\[\[([^\]]+)\]\]/g);
  const titles = [...matches].map((m) => m[1].trim()).filter(Boolean);
  return [...new Set(titles)];
}

/** Bridge a note into KnowledgeObject (idempotent — same sourceId always
 * resolves to the same row) and keep its title in sync, so every note is a
 * real, visible node in the canonical graph the moment it's saved, not only
 * once something happens to retrieve it via RAG. */
async function bridgeNote(
  noteId: string,
  title: string,
  boundary: { userId: string; projectId?: string | null }
): Promise<string> {
  const knowledgeObjectId = await getOrCreateKnowledgeObjectForSource({
    type: "Note",
    title,
    sourceType: "obsidian_note",
    sourceId: noteId,
    scope: boundary.projectId ? "project" : "user",
    projectId: boundary.projectId ?? null,
    userId: boundary.userId,
  });
  await db.knowledgeObject.updateMany({
    where: { sourceType: "obsidian_note", sourceId: noteId },
    data: { title },
  });
  return knowledgeObjectId;
}

// Reconcile backlinks on target notes after `noteId`'s content changed from
// `previousContent` to `content`. Adds noteId to newly-linked notes' backlinks
// and removes it from notes that are no longer linked. Also keeps the
// canonical graph (KnowledgeObject/KnowledgeEdge) in sync: every note bridges
// into a KnowledgeObject on every save, and each [[wikilink]] becomes a real
// `related_to` KnowledgeEdge between the two notes' bridged rows.
export async function resolveBacklinks(
  noteId: string,
  content: string,
  previousContent = "",
  boundary: { userId: string; projectId?: string | null }
): Promise<void> {
  const sourceTitle = (await db.obsidianNote.findUnique({ where: { id: noteId }, select: { title: true } }))?.title ?? "Untitled";
  const sourceKnowledgeObjectId = await bridgeNote(noteId, sourceTitle, boundary);

  const nextTitles = new Set(parseWikiLinks(content));
  const prevTitles = new Set(parseWikiLinks(previousContent));

  const addedTitles = [...nextTitles].filter((t) => !prevTitles.has(t));
  const removedTitles = [...prevTitles].filter((t) => !nextTitles.has(t));

  if (addedTitles.length > 0) {
    const targets = await db.obsidianNote.findMany({
      where: {
        title: { in: addedTitles },
        id: { not: noteId },
        ...(boundary.projectId
          ? { projectId: boundary.projectId }
          : { projectId: null, userId: boundary.userId }),
      },
      select: { id: true, title: true, backlinks: true },
    });
    for (const target of targets) {
      if (!target.backlinks.includes(noteId)) {
        await db.obsidianNote.update({
          where: { id: target.id },
          data: { backlinks: [...target.backlinks, noteId] },
        });
      }
      const targetKnowledgeObjectId = await bridgeNote(target.id, target.title, boundary);
      await db.knowledgeEdge.upsert({
        where: {
          fromObjectId_toObjectId_type: {
            fromObjectId: sourceKnowledgeObjectId,
            toObjectId: targetKnowledgeObjectId,
            type: "related_to",
          },
        },
        create: { fromObjectId: sourceKnowledgeObjectId, toObjectId: targetKnowledgeObjectId, type: "related_to" },
        update: {},
      });
    }
  }

  if (removedTitles.length > 0) {
    const targets = await db.obsidianNote.findMany({
      where: {
        title: { in: removedTitles },
        id: { not: noteId },
        ...(boundary.projectId
          ? { projectId: boundary.projectId }
          : { projectId: null, userId: boundary.userId }),
      },
      select: { id: true, backlinks: true },
    });
    for (const target of targets) {
      if (target.backlinks.includes(noteId)) {
        await db.obsidianNote.update({
          where: { id: target.id },
          data: { backlinks: target.backlinks.filter((b) => b !== noteId) },
        });
      }
      const targetKnowledgeObject = await db.knowledgeObject.findFirst({
        where: { sourceType: "obsidian_note", sourceId: target.id },
        select: { id: true },
      });
      if (targetKnowledgeObject) {
        await db.knowledgeEdge.deleteMany({
          where: { fromObjectId: sourceKnowledgeObjectId, toObjectId: targetKnowledgeObject.id, type: "related_to" },
        });
      }
    }
  }
}

// Remove `noteId` from every other note's backlinks (used on delete).
export async function removeBacklinksTo(
  noteId: string,
  boundary: { userId: string; projectId?: string | null }
): Promise<void> {
  const referencingNotes = await db.obsidianNote.findMany({
    where: {
      backlinks: { has: noteId },
      ...(boundary.projectId
        ? { projectId: boundary.projectId }
        : { projectId: null, userId: boundary.userId }),
    },
    select: { id: true, backlinks: true },
  });
  for (const note of referencingNotes) {
    await db.obsidianNote.update({
      where: { id: note.id },
      data: { backlinks: note.backlinks.filter((b) => b !== noteId) },
    });
  }

  // The bridged KnowledgeObject (if any) is deleted too — its KnowledgeEdge
  // rows cascade via the schema's onDelete: Cascade, so no orphaned node or
  // stale edges are left in the canonical graph pointing at a note that no
  // longer exists.
  await db.knowledgeObject.deleteMany({ where: { sourceType: "obsidian_note", sourceId: noteId } });
}
