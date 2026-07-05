// Knowledge Engine — scoped context retrieval

import { db } from "@/lib/db";
import { redisGet, redisSet } from "@/lib/redis";
import type { RetrievalContext } from "./types";

const SESSION_MEMORY_TTL_SECONDS = 6 * 60 * 60; // 6 hours
const SESSION_MEMORY_MAX_TURNS = 20;

function sessionMemoryKey(roomId: string): string {
  return `session:${roomId}:memory`;
}

interface SessionTurn {
  role: string;
  content: string;
}

// Append a turn to a room's ephemeral Redis-backed session memory, capped to
// the last SESSION_MEMORY_MAX_TURNS turns and expiring after
// SESSION_MEMORY_TTL_SECONDS of inactivity.
export async function appendSessionMemory(
  roomId: string,
  turns: SessionTurn[]
): Promise<void> {
  const key = sessionMemoryKey(roomId);
  const existingRaw = await redisGet(key);
  const existing: SessionTurn[] = existingRaw ? JSON.parse(existingRaw) : [];
  const updated = [...existing, ...turns].slice(-SESSION_MEMORY_MAX_TURNS);
  await redisSet(key, JSON.stringify(updated), SESSION_MEMORY_TTL_SECONDS);
}

async function retrieveSessionMemory(
  roomId?: string
): Promise<Array<{ content: string; scope: string; tags: string[] }>> {
  if (!roomId) return [];
  const raw = await redisGet(sessionMemoryKey(roomId));
  if (!raw) return [];
  try {
    const turns: SessionTurn[] = JSON.parse(raw);
    return turns.map((t) => ({
      content: `${t.role}: ${t.content}`,
      scope: "session",
      tags: [],
    }));
  } catch {
    return [];
  }
}

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
  memories: Array<{ content: string; scope: string; tags: string[] }>;
  notes: Array<{ title: string; content: string; tags: string[] }>;
  decisions: Array<{ title: string; summary: string; status: string }>;
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

    const dbMemories = memoriesRaw.map((m) => ({
      content: m.content,
      scope: m.scope,
      tags: m.tags,
    }));
    const sessionMemories = await retrieveSessionMemory(ctx.roomId);
    const memories = [...sessionMemories, ...dbMemories];

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
