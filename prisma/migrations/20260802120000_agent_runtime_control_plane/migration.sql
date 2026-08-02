-- Agent Runtime Control Plane: additive execution/runtime metadata.
CREATE TABLE "agent_runtimes" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "transport" TEXT NOT NULL,
    "endpoint" TEXT,
    "containerName" TEXT,
    "serviceName" TEXT,
    "executable" TEXT,
    "defaultArgs" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "workingDirectoryRoot" TEXT,
    "configPath" TEXT,
    "logPath" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "capabilities" JSONB NOT NULL DEFAULT '{}',
    "healthConfig" JSONB NOT NULL DEFAULT '{}',
    "workspaceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "agent_runtimes_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "agent_sessions" (
    "id" TEXT NOT NULL,
    "runtime" TEXT NOT NULL,
    "runtimeInstanceId" TEXT NOT NULL,
    "externalSessionId" TEXT,
    "agentId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "workspaceId" TEXT,
    "projectId" TEXT,
    "chatRoomId" TEXT,
    "workingDirectory" TEXT,
    "status" TEXT NOT NULL DEFAULT 'created',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "exitCode" INTEGER,
    "cancelledAt" TIMESTAMP(3),
    "metadata" JSONB NOT NULL DEFAULT '{}',
    CONSTRAINT "agent_sessions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "agent_runtime_events" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "agent_runtime_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "agent_runtimes_agentId_idx" ON "agent_runtimes"("agentId");
CREATE INDEX "agent_runtimes_kind_enabled_idx" ON "agent_runtimes"("kind", "enabled");
CREATE INDEX "agent_runtimes_workspaceId_idx" ON "agent_runtimes"("workspaceId");
CREATE INDEX "agent_sessions_runtimeInstanceId_startedAt_idx" ON "agent_sessions"("runtimeInstanceId", "startedAt");
CREATE INDEX "agent_sessions_userId_startedAt_idx" ON "agent_sessions"("userId", "startedAt");
CREATE INDEX "agent_sessions_workspaceId_startedAt_idx" ON "agent_sessions"("workspaceId", "startedAt");
CREATE INDEX "agent_sessions_chatRoomId_lastActivityAt_idx" ON "agent_sessions"("chatRoomId", "lastActivityAt");
CREATE INDEX "agent_sessions_status_lastActivityAt_idx" ON "agent_sessions"("status", "lastActivityAt");
CREATE UNIQUE INDEX "agent_runtime_events_sessionId_sequence_key" ON "agent_runtime_events"("sessionId", "sequence");
CREATE INDEX "agent_runtime_events_sessionId_occurredAt_idx" ON "agent_runtime_events"("sessionId", "occurredAt");

ALTER TABLE "agent_sessions" ADD CONSTRAINT "agent_sessions_runtimeInstanceId_fkey"
  FOREIGN KEY ("runtimeInstanceId") REFERENCES "agent_runtimes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "agent_runtime_events" ADD CONSTRAINT "agent_runtime_events_sessionId_fkey"
  FOREIGN KEY ("sessionId") REFERENCES "agent_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Compatibility seeds. Environment overrides are applied at runtime so this
-- migration never persists provider credentials or host-specific secrets.
INSERT INTO "agent_runtimes" (
  "id", "agentId", "kind", "transport", "endpoint", "containerName", "executable",
  "defaultArgs", "workingDirectoryRoot", "configPath", "logPath", "capabilities",
  "healthConfig", "workspaceId", "updatedAt"
) VALUES
  ('runtime-hermes-lisa', 'hermes-lisa', 'hermes', 'docker', 'http://127.0.0.1:4860', 'hermes-lisa', NULL,
   ARRAY[]::TEXT[], NULL, '/opt/sentinel-os/agents/hermes-lisa', '/opt/sentinel-os/logs/hermes-lisa.log',
   '{"streaming":false,"resume":false,"cancel":false,"toolEvents":false,"fileChangeEvents":false}', '{}',
   (SELECT "id" FROM "workspaces" WHERE "slug" = 'default' LIMIT 1), CURRENT_TIMESTAMP),
  ('runtime-hermes-clint', 'hermes-clint', 'hermes', 'docker', 'http://127.0.0.1:4861', 'hermes-clint', NULL,
   ARRAY[]::TEXT[], NULL, '/opt/sentinel-os/agents/hermes-clint', '/opt/sentinel-os/logs/hermes-clint.log',
   '{"streaming":false,"resume":false,"cancel":false,"toolEvents":false,"fileChangeEvents":false}', '{}',
   (SELECT "id" FROM "workspaces" WHERE "slug" = 'construction' LIMIT 1), CURRENT_TIMESTAMP),
  ('runtime-openclaw', 'openclaw', 'openclaw', 'docker', 'http://127.0.0.1:3001', 'openclaw', NULL,
   ARRAY[]::TEXT[], NULL, '/opt/sentinel-os/agents/openclaw', '/opt/sentinel-os/logs/openclaw.log',
   '{"streaming":false,"resume":false,"cancel":false,"toolEvents":false,"fileChangeEvents":false}', '{}',
   (SELECT "id" FROM "workspaces" WHERE "slug" = 'personal' LIMIT 1), CURRENT_TIMESTAMP),
  ('runtime-claude-code', 'claude-code', 'claude-code', 'process', NULL, NULL, 'claude',
   ARRAY['--permission-mode','acceptEdits'], '/opt/sentinel-os/projects', NULL, '/opt/sentinel-os/logs/claude-code.log',
   '{"streaming":true,"resume":true,"cancel":true,"toolEvents":true,"fileChangeEvents":true}', '{}',
   (SELECT "id" FROM "workspaces" WHERE "slug" = 'default' LIMIT 1), CURRENT_TIMESTAMP),
  ('runtime-codex', 'codex', 'codex', 'process', NULL, NULL, 'codex',
   ARRAY['--sandbox','workspace-write','--ask-for-approval','on-request'], '/opt/sentinel-os/projects', NULL, '/opt/sentinel-os/logs/codex.log',
   '{"streaming":true,"resume":false,"cancel":true,"toolEvents":true,"fileChangeEvents":true}', '{}',
   (SELECT "id" FROM "workspaces" WHERE "slug" = 'default' LIMIT 1), CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "permissions" ("id", "workspaceId", "key", "resource", "action", "description")
SELECT
  'runtime-perm-' || md5(w."id" || permission."key"),
  w."id",
  permission."key",
  'agents.runtime',
  permission."action",
  permission."description"
FROM "workspaces" w
CROSS JOIN (VALUES
  ('agents.runtime.view', 'view', 'View runtime state and capabilities'),
  ('agents.runtime.execute', 'execute', 'Create sessions and send runtime tasks'),
  ('agents.runtime.cancel', 'cancel', 'Cancel active runtime tasks'),
  ('agents.runtime.restart', 'restart', 'Restart or reload a runtime'),
  ('agents.runtime.configure', 'configure', 'Change runtime configuration'),
  ('agents.runtime.elevate', 'elevate', 'Request an approved elevation; never grants root directly'),
  ('agents.runtime.view_logs', 'view_logs', 'View runtime transcripts and logs'),
  ('agents.runtime.approve_tool', 'approve_tool', 'Approve a governed runtime tool request')
) AS permission("key", "action", "description")
ON CONFLICT ("workspaceId", "key") DO NOTHING;
