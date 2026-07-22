// Knowledge Engine — scoped context retrieval

import { db } from "@/lib/db";
import type { RetrievalContext } from "./types";

// Scope priority order: session → project → workspace → organization → user → global
// Strictly enforced: project-scoped items never leak to other projects.
const SCOPE_ORDER = [
  "session",
  "project",
  "workspace",
  "organization",
  "user",
  "global",
] as const;

type Scope = (typeof SCOPE_ORDER)[number];

function allowedScopes(ctx: RetrievalContext): Scope[] {
  if (ctx.projectId) {
    // When a project is set, return project and broader scopes
    return ["session", "project", "workspace", "organization", "user", "global"];
  }
  if (ctx.workspaceId) {
    return ["session", "workspace", "organization", "user", "global"];
  }
  if (ctx.organizationId) {
    return ["session", "organization", "user", "global"];
  }
  return ["session", "user", "global"];
}

export async function retrieveContext(ctx: RetrievalContext): Promise<{
  memories: Array<{ id: string; content: string; scope: string; tags: string[] }>;
  notes: Array<{ id: string; title: string; content: string; tags: string[] }>;
  decisions: Array<{ id: string; title: string; summary: string; status: string }>;
  totalItems: number;
}> {
  try {
    const maxItems = ctx.maxItems ?? 40;
    const scopes = allowedScopes(ctx);

    // --- Memories ---
    // Project isolation: project-scoped memories must belong to ctx.projectId.
    // Broader scopes (workspace/organization/user/global) are unaffected by project.
    const memoriesRaw = await db.memory.findMany({
      where: {
        scope: { in: scopes },
        archived: false,
        ...(ctx.userId ? { owner: ctx.userId } : {}),
        OR: [
          { scope: { not: "project" } },
          ctx.projectId ? { scope: "project", projectId: ctx.projectId } : { scope: "project", projectId: null },
        ],
      },
      orderBy: [{ pinned: "desc" }, { importanceScore: "desc" }, { createdAt: "desc" }],
      take: maxItems,
    });

    const memories = memoriesRaw.map((m) => ({
      id: m.id,
      content: m.content,
      scope: m.scope,
      tags: m.tags,
    }));

    // --- ObsidianNotes ---
    const notesRaw = await db.obsidianNote.findMany({
      where: {
        // Strict project isolation: if projectId given, only return notes from that project
        // OR notes with no projectId (global notes)
        ...(ctx.projectId
          ? {
              OR: [
                { projectId: ctx.projectId },
                { projectId: null },
              ],
            }
          : { projectId: null }),
      },
      orderBy: { createdAt: "desc" },
      take: Math.floor(maxItems / 2),
    });

    const notes = notesRaw.map((n) => ({
      id: n.id,
      title: n.title,
      content: n.content,
      tags: n.tags,
    }));

    // --- Decisions ---
    // Project isolation: when a project is set, only return decisions scoped to it
    // or unscoped (global) decisions. Never leak decisions from unrelated projects.
    const decisionsRaw = await db.decision.findMany({
      where: {
        status: { in: ["approved", "proposed"] },
        ...(ctx.projectId
          ? { OR: [{ projectId: ctx.projectId }, { projectId: null }] }
          : { projectId: null }),
      },
      orderBy: { createdAt: "desc" },
      take: 10,
    });

    const decisions = decisionsRaw.map((d) => ({
      id: d.id,
      title: d.title,
      summary: d.summary,
      status: d.status,
    }));

    const totalItems = memories.length + notes.length + decisions.length;

    return { memories, notes, decisions, totalItems };
  } catch (err) {
    throw new Error(
      `retrieveContext failed: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}
