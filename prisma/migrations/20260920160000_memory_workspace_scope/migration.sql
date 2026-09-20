-- Give Memory a real workspace, so that "workspace-scoped" means what it says.
--
-- Until now Memory had `scope = 'workspace'` and no workspaceId. Retrieval
-- isolated those rows by `owner`, which is a different thing wearing the same
-- name: a workspace-scoped memory was invisible to every other member of the
-- workspace (so a shared workspace did not actually share), and the isolation
-- it did provide came from the owner column rather than from any workspace
-- boundary. For a multi-tenant system that is not a rough edge, it is the
-- wrong model.
--
-- Additive and production-safe:
--   * one new nullable column, one FK, two indexes
--   * no column is dropped, altered or re-typed
--   * no row's existing values change
--
-- ON DELETE SET NULL, deliberately. CASCADE would delete memory as a
-- side-effect of removing a workspace, which is destructive in the way this
-- work is specifically not allowed to be. SET NULL leaves the row intact and
-- leaves it *unresolved*, and retrieval treats an unresolved workspace memory
-- as unreachable rather than as global -- it fails closed, which is the only
-- safe direction for a scope column.

ALTER TABLE "memories" ADD COLUMN IF NOT EXISTS "workspaceId" TEXT;

CREATE INDEX IF NOT EXISTS "memories_workspaceId_idx" ON "memories"("workspaceId");
CREATE INDEX IF NOT EXISTS "memories_scope_workspaceId_idx" ON "memories"("scope", "workspaceId");

DO $$
BEGIN
  ALTER TABLE "memories" ADD CONSTRAINT "memories_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Backfill only where the workspace follows from data already recorded: a
-- memory attached to a project belongs to that project's workspace, and that
-- is a fact, not an inference.
--
-- Memories with scope = 'workspace' and no project are deliberately NOT
-- backfilled. Their workspace cannot be derived from anything stored -- the
-- owner may belong to several -- and guessing would silently place one
-- tenant's memory in another tenant's workspace, which is the exact failure
-- this migration exists to make impossible. They are left NULL, which
-- retrieval reads as unresolved, and are reported by
-- `unresolvedWorkspaceMemories()` in src/lib/knowledge/memory-scope.ts so the
-- remainder can be resolved deliberately rather than by default.
UPDATE "memories" m
SET "workspaceId" = p."workspaceId"
FROM "projects" p
WHERE m."projectId" = p."id"
  AND p."workspaceId" IS NOT NULL
  AND m."workspaceId" IS NULL;
