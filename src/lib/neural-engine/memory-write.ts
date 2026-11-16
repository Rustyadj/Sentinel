// Sentinel — the one place a durable Memory row is written.
//
// Before this module, eleven files wrote `memories` directly. Each made its
// own decision about who may write what, and most made none: the memory API
// stored any `type`/`scope` the request body named, a learning candidate's
// payload chose its own owner, and nothing outside the ingestion gate refused a
// credential. "Every write goes through the gate" was true for one caller.
//
// Two kinds of writer exist, and both are authorised here:
//
//   * A user (`userMemory*`). Writes are checked against what that user may
//     write — ownership for personal memory, `project.update` for project
//     memory, the workspace permission for workspace memory — using the
//     permission system every other tenant resource uses. No request session is
//     read, so the same check holds for a bot run or a worker acting for a user.
//
//   * A named internal service (`memoryWriter(service)`). A service is not a
//     user and has no tenant rights of its own; what bounds it is the set of
//     columns it exists to maintain. The decay sweep may move `state` and
//     `valueScore`; it may not rewrite `content` or move a row between scopes.
//     The allowlist is checked at runtime, so a new call site that reaches for
//     a column its service does not own fails loudly instead of quietly
//     widening what that service can do.
//
// Invariants enforced for every writer:
//
//   1. No secret-shaped content is ever stored (same test as the gate).
//   2. Only listed services may create rows; only listed columns may change.
//   3. Ownership and placement (`owner`, `scope`, `projectId`, `workspaceId`,
//      `botId`) are never changed by an update. Moving memory between tenants
//      is a new memory, written and authorised as one.
//
// tests/memory/write-pipeline-guard.test.ts fails the build if any file other
// than this one calls a write method on the memory model.

import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { assertWritableMemoryScope, MemoryScopeError } from "@/lib/knowledge/memory-scope";
import { userHasProjectPermission } from "@/lib/workspaces/authorization";
import { containsSecretShapedContent } from "./ingestion-gate";

type MemoryClient = Pick<typeof db, "memory">;

export type MemoryService =
  | "ingestion"
  | "consolidation"
  | "learning-candidate"
  | "preferences"
  | "agent-workspace"
  | "temporal"
  | "governance"
  | "usage"
  | "reconsolidation"
  | "procedural";

/** Columns that place a memory in a tenant. Never changed by an update. */
const PLACEMENT_FIELDS = new Set(["owner", "scope", "projectId", "workspaceId", "botId"]);

interface ServicePolicy {
  /** May this service create rows at all. */
  create: boolean;
  /** Columns this service may change on an existing row. */
  update: ReadonlySet<string>;
}

const policy = (create: boolean, update: string[] = []): ServicePolicy => ({ create, update: new Set(update) });

export const SERVICE_POLICIES: Readonly<Record<MemoryService, ServicePolicy>> = {
  // The selective-persistence gate (memory-ingestion.ts). Creates only; what
  // happens to a row afterwards belongs to the lifecycle services below.
  ingestion: policy(true),
  // Generalized beliefs drawn from episodes. Re-running strengthens an
  // existing generalization in place.
  consolidation: policy(true, ["content", "tags", "confidence", "derivedFromExperienceIds"]),
  // A human-approved learning candidate becoming memory, and its rollback.
  "learning-candidate": policy(true, ["archived"]),
  // Canonical preference rows; evidence moves only their confidence.
  preferences: policy(true, ["confidence"]),
  // Short references to durable workspace events. Never edited.
  "agent-workspace": policy(true),
  // Bitemporal supersession: close the old version, create the next.
  temporal: policy(true, ["validTo", "supersededById"]),
  // Decay, quarantine, validation, forgetting.
  governance: policy(false, [
    "state", "poisonRisk", "lastValidatedAt", "archived", "stalenessScore", "valueScore",
    "lastUsefulAt", "confirmationCount", "contradictionCount",
  ]),
  // Retrieval bookkeeping.
  usage: policy(false, ["lastRetrievedAt", "retrievalCount", "provenanceTrust"]),
  // Outcome-driven reinforcement and supersession.
  reconsolidation: policy(false, [
    "validTo", "supersededById", "changeReason", "state", "confirmationCount",
    "disconfirmationCount", "lastValidatedAt",
  ]),
  // Procedure promotion against independent executions.
  procedural: policy(false, [
    "supportingExperienceIds", "confirmationCount", "disconfirmationCount", "lastUsefulAt",
    "lastValidatedAt", "shadowOnly", "state",
  ]),
};

/** Columns a user may change on memory they are authorised to write. */
export const USER_EDITABLE_FIELDS: ReadonlySet<string> = new Set([
  "pinned", "archived", "content", "tags", "confidence", "importanceScore",
]);

export class MemoryWriteDenied extends Error {
  constructor(message: string, public readonly code: string, public readonly status: 400 | 403 | 404 = 403) {
    super(message);
    this.name = "MemoryWriteDenied";
  }
}

function contentOf(data: Record<string, unknown>): string | null {
  const content = data.content;
  if (typeof content === "string") return content;
  if (content && typeof content === "object" && typeof (content as { set?: unknown }).set === "string") {
    return (content as { set: string }).set;
  }
  return null;
}

function assertNoSecret(data: Record<string, unknown>) {
  const content = contentOf(data);
  if (content !== null && containsSecretShapedContent(content)) {
    throw new MemoryWriteDenied("Secret-shaped content is never stored as memory.", "secret_content", 400);
  }
}

function assertUpdateFields(data: Record<string, unknown>, allowed: ReadonlySet<string>, who: string) {
  for (const key of Object.keys(data)) {
    if (PLACEMENT_FIELDS.has(key)) {
      throw new MemoryWriteDenied(`${who} may not move memory between scopes (field "${key}").`, "placement_immutable");
    }
    if (!allowed.has(key)) {
      throw new MemoryWriteDenied(`${who} may not change memory field "${key}".`, "field_not_permitted");
    }
  }
}

function requireCreate(service: MemoryService) {
  if (!SERVICE_POLICIES[service].create) {
    throw new MemoryWriteDenied(`Service "${service}" may not create memory.`, "create_not_permitted");
  }
}

/**
 * The write surface for one internal service.
 *
 * Validation is synchronous, so the returned calls are ordinary Prisma
 * promises: they compose with `$transaction([...])` and interactive
 * transactions exactly as direct client calls did. Pass the transaction client
 * as `client` when writing inside one.
 */
export function memoryWriter(service: MemoryService, client: MemoryClient = db) {
  const who = `Service "${service}"`;
  const allowed = SERVICE_POLICIES[service].update;
  return {
    create<T extends Prisma.MemoryCreateArgs>(args: Prisma.SelectSubset<T, Prisma.MemoryCreateArgs>) {
      requireCreate(service);
      assertNoSecret(args.data as Record<string, unknown>);
      return client.memory.create<T>(args);
    },
    update<T extends Prisma.MemoryUpdateArgs>(args: Prisma.SelectSubset<T, Prisma.MemoryUpdateArgs>) {
      const data = args.data as Record<string, unknown>;
      assertUpdateFields(data, allowed, who);
      assertNoSecret(data);
      return client.memory.update<T>(args);
    },
    updateMany<T extends Prisma.MemoryUpdateManyArgs>(args: Prisma.SelectSubset<T, Prisma.MemoryUpdateManyArgs>) {
      const data = args.data as Record<string, unknown>;
      assertUpdateFields(data, allowed, who);
      assertNoSecret(data);
      return client.memory.updateMany<T>(args);
    },
  };
}

// --- User writes ----------------------------------------------------------

interface MemoryPlacement {
  id: string;
  owner: string;
  scope: string;
  projectId: string | null;
  workspaceId: string | null;
}

/**
 * May this user write this existing memory. Mirrors read placement:
 * personal memory belongs to its owner, project memory to whoever holds
 * `project.update`, workspace memory to whoever may write that workspace.
 */
async function userMayWrite(userId: string, memory: MemoryPlacement, projectCache = new Map<string, boolean>()) {
  if (memory.projectId) {
    let allowed = projectCache.get(memory.projectId);
    if (allowed === undefined) {
      allowed = (await userHasProjectPermission(userId, memory.projectId, "project.update")).allowed;
      projectCache.set(memory.projectId, allowed);
    }
    return allowed;
  }
  if (memory.scope === "workspace") {
    if (!memory.workspaceId) return false; // unresolved is not global
    return assertWritableMemoryScope({ userId, scope: "workspace", workspaceId: memory.workspaceId })
      .then(() => true, () => false);
  }
  return memory.owner === userId;
}

const PLACEMENT_SELECT = { id: true, owner: true, scope: true, projectId: true, workspaceId: true } as const;

async function requireWritable(userId: string, id: string): Promise<MemoryPlacement> {
  const memory = await db.memory.findUnique({ where: { id }, select: PLACEMENT_SELECT });
  // Not found and not permitted are the same answer: a caller must not learn
  // that a memory it cannot write exists.
  if (!memory || !(await userMayWrite(userId, memory))) {
    throw new MemoryWriteDenied("Memory not found.", "not_found", 404);
  }
  return memory;
}

export interface UserMemoryCreate {
  type: string;
  scope: string;
  content: string;
  source: string;
  tags?: string[];
  projectId?: string | null;
  workspaceId?: string | null;
  confidence?: number;
  importanceScore?: number;
}

/**
 * A memory a user states directly (the memory API, the Memory Inspector).
 *
 * Authorised against the scope it is placed in. It does not pass through the
 * selective-persistence gate's usefulness judgement — a person explicitly
 * saving a memory has already made that judgement — but it gets the gate's
 * hard exclusion: secret-shaped content is refused here like everywhere else.
 */
export async function createUserMemory<S extends Prisma.MemorySelect>(
  userId: string,
  input: UserMemoryCreate,
  select?: S,
) {
  try {
    await assertWritableMemoryScope({
      userId, scope: input.scope, projectId: input.projectId ?? null, workspaceId: input.workspaceId ?? null,
    });
  } catch (error) {
    if (error instanceof MemoryScopeError) {
      const status = error.code === "forbidden" || error.code === "project_not_found" ? 404 : 400;
      throw new MemoryWriteDenied(status === 404 ? "Project not found." : error.message, error.code, status);
    }
    throw error;
  }
  const data = {
    type: input.type,
    scope: input.scope,
    owner: userId,
    content: input.content,
    tags: input.tags ?? [],
    source: input.source,
    projectId: input.projectId ?? null,
    workspaceId: input.workspaceId ?? null,
    confidence: input.confidence ?? 1,
    importanceScore: input.importanceScore ?? 0.5,
    provenanceClass: "USER_PROVIDED",
  };
  assertNoSecret(data);
  return db.memory.create({ data, select: select as S });
}

/** Change user-editable fields of one memory the user may write. */
export async function updateUserMemory<S extends Prisma.MemorySelect>(
  userId: string,
  id: string,
  data: Record<string, unknown>,
  select?: S,
) {
  await requireWritable(userId, id);
  assertUpdateFields(data, USER_EDITABLE_FIELDS, "A user");
  assertNoSecret(data);
  return db.memory.update({ where: { id }, data, select: select as S });
}

/** Hard delete. Only a user may do this, and only to memory they may write. */
export async function deleteUserMemory(userId: string, id: string) {
  await requireWritable(userId, id);
  await db.memory.delete({ where: { id } });
}

/**
 * Apply one change to many memories on a user's behalf (the manual reflect
 * pass). Every id is authorised; ids the user may not write are skipped and
 * reported rather than failing the batch, since the caller selected them.
 */
export async function updateUserMemories(userId: string, ids: string[], data: Record<string, unknown>) {
  assertUpdateFields(data, USER_EDITABLE_FIELDS, "A user");
  assertNoSecret(data);
  if (!ids.length) return { updated: 0, denied: [] as string[] };
  const rows = await db.memory.findMany({ where: { id: { in: ids } }, select: PLACEMENT_SELECT });
  const cache = new Map<string, boolean>();
  const permitted: string[] = [];
  for (const row of rows) if (await userMayWrite(userId, row, cache)) permitted.push(row.id);
  const denied = ids.filter((id) => !permitted.includes(id));
  if (!permitted.length) return { updated: 0, denied };
  const result = await db.memory.updateMany({ where: { id: { in: permitted } }, data });
  return { updated: result.count, denied };
}
