import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/current-user";
import { getReadableProjectIds } from "@/lib/knowledge/access";

export async function GET() {
  const user = await requireUser().catch(() => null);
  if (!user) return NextResponse.json({ error: "Unauthorized", nodes: [], edges: [] }, { status: 401 });
  const projectIds = await getReadableProjectIds(user.id);
  const notes = await db.obsidianNote.findMany({
    where: {
      OR: [
        { projectId: null, userId: user.id },
        ...(projectIds.length ? [{ projectId: { in: projectIds } }] : []),
      ],
    },
    select: { id: true, title: true, tags: true, backlinks: true, projectId: true },
  });
  const projects = await db.project.findMany({ where: { id: { in: projectIds } }, select: { id: true, name: true } });

  const nodes = [
    ...notes.map((n) => ({
      id: n.id,
      type: "note",
      data: { label: n.title, tags: n.tags, projectId: n.projectId },
    })),
    ...projects.map((p) => ({
      id: `project-${p.id}`,
      type: "project",
      data: { label: p.name },
    })),
  ];

  const edges: { id: string; source: string; target: string }[] = [];
  const noteIds = new Set(notes.map((note) => note.id));

  // Wiki link edges between notes
  for (const note of notes) {
    for (const backlinkId of note.backlinks) {
      if (noteIds.has(backlinkId)) {
        edges.push({ id: `bl-${backlinkId}-${note.id}`, source: backlinkId, target: note.id });
      }
    }
  }

  // Project → note edges
  for (const note of notes) {
    if (note.projectId) {
      edges.push({ id: `pn-${note.id}`, source: `project-${note.projectId}`, target: note.id });
    }
  }

  return NextResponse.json({ nodes, edges });
}
