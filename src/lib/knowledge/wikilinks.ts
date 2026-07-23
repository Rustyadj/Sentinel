// Knowledge Engine — wiki-link ([[Note Title]]) parsing and backlink resolution

import { db } from "@/lib/db";

export function parseWikiLinks(content: string): string[] {
  const matches = content.matchAll(/\[\[([^\]]+)\]\]/g);
  const titles = [...matches].map((m) => m[1].trim()).filter(Boolean);
  return [...new Set(titles)];
}

// Reconcile backlinks on target notes after `noteId`'s content changed from
// `previousContent` to `content`. Adds noteId to newly-linked notes' backlinks
// and removes it from notes that are no longer linked.
export async function resolveBacklinks(
  noteId: string,
  content: string,
  previousContent = "",
  boundary: { userId: string; projectId?: string | null }
): Promise<void> {
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
      select: { id: true, backlinks: true },
    });
    for (const target of targets) {
      if (!target.backlinks.includes(noteId)) {
        await db.obsidianNote.update({
          where: { id: target.id },
          data: { backlinks: [...target.backlinks, noteId] },
        });
      }
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
}
