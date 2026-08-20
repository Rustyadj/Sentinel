-- AlterTable
ALTER TABLE "approval_requests" ADD COLUMN     "chatRoomId" TEXT,
ADD COLUMN     "risk" TEXT NOT NULL DEFAULT 'low',
ADD COLUMN     "taskId" TEXT;

-- AlterTable
ALTER TABLE "artifacts" ADD COLUMN     "chatRoomId" TEXT,
ADD COLUMN     "taskId" TEXT;

-- AlterTable
ALTER TABLE "chat_rooms" ADD COLUMN     "autonomyLevel" TEXT NOT NULL DEFAULT 'assisted',
ADD COLUMN     "mode" TEXT NOT NULL DEFAULT 'collaborative',
ADD COLUMN     "objective" TEXT;

-- AlterTable
ALTER TABLE "decisions" ADD COLUMN     "chatRoomId" TEXT,
ADD COLUMN     "relatedTaskIds" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "messages" ADD COLUMN     "artifactIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "messageType" TEXT NOT NULL DEFAULT 'MESSAGE',
ADD COLUMN     "recipientAgentIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "taskId" TEXT;

-- AlterTable
ALTER TABLE "tasks" ADD COLUMN     "chatRoomId" TEXT,
ADD COLUMN     "createdByAgentId" TEXT,
ADD COLUMN     "dependsOnTaskIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "reviewerAgentId" TEXT;

-- CreateTable
CREATE TABLE "agent_disagreements" (
    "id" TEXT NOT NULL,
    "chatRoomId" TEXT NOT NULL,
    "taskId" TEXT,
    "issue" TEXT NOT NULL,
    "positions" JSONB NOT NULL DEFAULT '[]',
    "severity" TEXT NOT NULL DEFAULT 'medium',
    "resolvedByAgentId" TEXT,
    "finalDecision" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "agent_disagreements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "execution_locks" (
    "id" TEXT NOT NULL,
    "chatRoomId" TEXT NOT NULL,
    "taskId" TEXT,
    "agentId" TEXT NOT NULL,
    "resourcePattern" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'write',
    "workingDirectory" TEXT,
    "branch" TEXT,
    "worktreePath" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "releasedAt" TIMESTAMP(3),

    CONSTRAINT "execution_locks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "collaboration_events" (
    "id" TEXT NOT NULL,
    "chatRoomId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "collaboration_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "agent_disagreements_chatRoomId_resolvedAt_idx" ON "agent_disagreements"("chatRoomId", "resolvedAt");

-- CreateIndex
CREATE INDEX "agent_disagreements_taskId_idx" ON "agent_disagreements"("taskId");

-- CreateIndex
CREATE INDEX "execution_locks_chatRoomId_releasedAt_idx" ON "execution_locks"("chatRoomId", "releasedAt");

-- CreateIndex
CREATE INDEX "execution_locks_taskId_idx" ON "execution_locks"("taskId");

-- CreateIndex
CREATE INDEX "collaboration_events_chatRoomId_occurredAt_idx" ON "collaboration_events"("chatRoomId", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "collaboration_events_chatRoomId_sequence_key" ON "collaboration_events"("chatRoomId", "sequence");

-- CreateIndex
CREATE INDEX "approval_requests_chatRoomId_status_idx" ON "approval_requests"("chatRoomId", "status");

-- CreateIndex
CREATE INDEX "artifacts_chatRoomId_idx" ON "artifacts"("chatRoomId");

-- CreateIndex
CREATE INDEX "artifacts_taskId_idx" ON "artifacts"("taskId");

-- CreateIndex
CREATE INDEX "decisions_chatRoomId_idx" ON "decisions"("chatRoomId");

-- CreateIndex
CREATE INDEX "messages_chatRoomId_createdAt_idx" ON "messages"("chatRoomId", "createdAt");

-- CreateIndex
CREATE INDEX "messages_taskId_idx" ON "messages"("taskId");

-- CreateIndex
CREATE INDEX "tasks_chatRoomId_status_idx" ON "tasks"("chatRoomId", "status");

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_chatRoomId_fkey" FOREIGN KEY ("chatRoomId") REFERENCES "chat_rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_disagreements" ADD CONSTRAINT "agent_disagreements_chatRoomId_fkey" FOREIGN KEY ("chatRoomId") REFERENCES "chat_rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_disagreements" ADD CONSTRAINT "agent_disagreements_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "execution_locks" ADD CONSTRAINT "execution_locks_chatRoomId_fkey" FOREIGN KEY ("chatRoomId") REFERENCES "chat_rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "execution_locks" ADD CONSTRAINT "execution_locks_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collaboration_events" ADD CONSTRAINT "collaboration_events_chatRoomId_fkey" FOREIGN KEY ("chatRoomId") REFERENCES "chat_rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_chatRoomId_fkey" FOREIGN KEY ("chatRoomId") REFERENCES "chat_rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_reviewerAgentId_fkey" FOREIGN KEY ("reviewerAgentId") REFERENCES "agents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_chatRoomId_fkey" FOREIGN KEY ("chatRoomId") REFERENCES "chat_rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_chatRoomId_fkey" FOREIGN KEY ("chatRoomId") REFERENCES "chat_rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Seed real Agent rows for the four VPS runtime registry ids (hermes-lisa,
-- claude-code, codex, openclaw). agent_runtimes.agentId already references
-- these exact string ids (see 20260802120000_agent_runtime_control_plane)
-- but no Agent row backed them, so Task.reviewerAgentId / Task.agentId /
-- ApprovalRequest.requesterAgentId — all real FKs to "agents" — could never
-- resolve to a collaboration room's own runtime agents. This closes that gap
-- rather than adding a second, unconstrained id space for collaboration use.
INSERT INTO "agents" (
  "id", "name", "role", "avatar", "color", "model", "description",
  "skills", "toolPermissions", "memoryScope", "status", "workspaceId"
) VALUES
  ('hermes-lisa', 'Hermes Lisa', 'lead', 'Sparkles', '#22D3EE', 'claude-sonnet-4-6',
   'Lead / orchestrator agent — plans and coordinates room collaboration.',
   ARRAY[]::TEXT[], ARRAY[]::TEXT[], 'org', 'online',
   (SELECT "id" FROM "workspaces" WHERE "slug" = 'default' LIMIT 1)),
  ('claude-code', 'Claude Code', 'implementation', 'Code', '#F97316', 'provider-managed',
   'Implementation agent — repository-aware coding runtime.',
   ARRAY[]::TEXT[], ARRAY[]::TEXT[], 'project', 'online',
   (SELECT "id" FROM "workspaces" WHERE "slug" = 'default' LIMIT 1)),
  ('codex', 'Codex', 'review', 'ShieldCheck', '#A855F7', 'provider-managed',
   'Review / verification agent — inspects and challenges implementation work.',
   ARRAY[]::TEXT[], ARRAY[]::TEXT[], 'project', 'online',
   (SELECT "id" FROM "workspaces" WHERE "slug" = 'default' LIMIT 1)),
  ('openclaw', 'OpenClaw', 'research', 'Compass', '#10B981', 'claude-opus-4-8',
   'Personal research/assistant agent.',
   ARRAY[]::TEXT[], ARRAY[]::TEXT[], 'user', 'online',
   (SELECT "id" FROM "workspaces" WHERE "slug" = 'personal' LIMIT 1))
ON CONFLICT ("id") DO NOTHING;
