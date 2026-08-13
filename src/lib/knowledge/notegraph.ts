import { db } from "@/lib/db";
import { syncToGraph, removeFromGraph } from "./sync";
import type { GraphEdgeSpec } from "./sync";
import { parseWikiLinks, resolveWikiLinkTargets } from "./wikilinks";

/** Syncs an ObsidianNote row and its outgoing wiki links to the real graph. */
export async function syncNoteToGraph(note: {
  id: string;
  title: string;
  content: string;
  tags: string[];
  projectId: string | null;
  backlinks: string[];
}): Promise<void> {
  const linkedNotes = await resolveWikiLinkTargets(note.id, parseWikiLinks(note.content));
  const linkedNoteIds = linkedNotes.map((linkedNote) => linkedNote.id);
  const edges: GraphEdgeSpec[] = linkedNoteIds.map((linkedNoteId) => ({
    toSourceType: "note",
    toSourceId: linkedNoteId,
    type: "references",
  }));

  if (note.projectId) {
    edges.push({
      toSourceType: "project",
      toSourceId: note.projectId,
      type: "belongs_to",
    });
  }

  const node = await syncToGraph({
    sourceType: "note",
    sourceId: note.id,
    type: "Note",
    title: note.title,
    summary: note.content.slice(0, 80) + (note.content.length > 80 ? "…" : ""),
    scope: note.projectId ? "project" : "global",
    projectId: note.projectId ?? undefined,
    metadata: { tags: note.tags, backlinks: note.backlinks },
    edges,
  });

  // syncToGraph upserts desired edges but deliberately does not delete old
  // ones. Remove note-to-note references no longer present in the content.
  await db.knowledgeEdge.deleteMany({
    where: {
      fromObjectId: node.id,
      type: "references",
      toObject: {
        sourceType: "note",
        ...(linkedNoteIds.length > 0 ? { sourceId: { notIn: linkedNoteIds } } : {}),
      },
    },
  });
  await db.knowledgeEdge.deleteMany({
    where: {
      fromObjectId: node.id,
      type: "belongs_to",
      toObject: {
        sourceType: "project",
        ...(note.projectId ? { sourceId: { not: note.projectId } } : {}),
      },
    },
  });
}

/** Removes an ObsidianNote's graph node and its edges. */
export async function removeNoteFromGraph(noteId: string): Promise<void> {
  await removeFromGraph("note", noteId);
}
