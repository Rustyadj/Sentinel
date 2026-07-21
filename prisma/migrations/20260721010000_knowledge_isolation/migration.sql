-- Legacy unowned global notes and decisions intentionally remain inaccessible.
-- Project-scoped rows continue to inherit access from their owning project.
ALTER TABLE "obsidian_notes" ADD COLUMN "userId" TEXT;
ALTER TABLE "decisions" ADD COLUMN "userId" TEXT;
ALTER TABLE "knowledge_events" ADD COLUMN "userId" TEXT;
ALTER TABLE "agents" ADD COLUMN "workspaceId" TEXT;
ALTER TABLE "workflows" ADD COLUMN "userId" TEXT;

CREATE INDEX "obsidian_notes_userId_idx" ON "obsidian_notes"("userId");
CREATE INDEX "obsidian_notes_projectId_idx" ON "obsidian_notes"("projectId");
CREATE INDEX "decisions_userId_idx" ON "decisions"("userId");
CREATE INDEX "knowledge_events_userId_createdAt_idx" ON "knowledge_events"("userId", "createdAt");
CREATE INDEX "knowledge_events_projectId_createdAt_idx" ON "knowledge_events"("projectId", "createdAt");
CREATE INDEX "agents_workspaceId_idx" ON "agents"("workspaceId");
CREATE INDEX "workflows_userId_idx" ON "workflows"("userId");
CREATE INDEX "workflows_projectId_idx" ON "workflows"("projectId");

ALTER TABLE "obsidian_notes"
  ADD CONSTRAINT "obsidian_notes_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "agents"
  ADD CONSTRAINT "agents_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "workflows"
  ADD CONSTRAINT "workflows_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
