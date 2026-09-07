-- Additive reconciliation. Defaults are applied once, never at startup.
ALTER TABLE "agents" ADD COLUMN "reasoningEffort" TEXT;
ALTER TABLE "agents" ADD CONSTRAINT "agents_reasoning_effort_check"
  CHECK ("reasoningEffort" IS NULL OR "reasoningEffort" IN ('none','low','medium','high','xhigh','max'));
INSERT INTO "agents" ("id","name","role","avatar","color","model","memoryScope","status","skills","toolPermissions","workspaceId")
VALUES ('hermes-nathan2','Hermes Nathan2','assistant','🤖','#6366f1','gpt-5.6-luna','org','online',ARRAY[]::TEXT[],ARRAY[]::TEXT[],
 (SELECT "id" FROM "workspaces" WHERE "slug"='default' LIMIT 1))
ON CONFLICT ("id") DO NOTHING;
UPDATE "agents" SET "model"='gpt-5.6-luna' WHERE "id" IN ('hermes-lisa','hermes-nathan2');
UPDATE "agents" SET "model"='claude-opus-5', "reasoningEffort"='low' WHERE "id"='claude-code';
UPDATE "agents" SET "model"='gpt-6-astra', "reasoningEffort"='low' WHERE "id"='codex';
INSERT INTO "agent_runtimes" ("id","agentId","kind","transport","endpoint","containerName","configPath","logPath","capabilities","workspaceId","updatedAt")
VALUES ('runtime-hermes-nathan2','hermes-nathan2','hermes','docker','http://127.0.0.1:4861','hermes-nathan2',
 '/opt/sentinel-os/agents/hermes-nathan2','/opt/sentinel-os/logs/hermes-nathan2.log',
 '{"streaming":true,"resume":true,"cancel":true,"toolEvents":true,"fileChangeEvents":false,"restart":{"supported":true},"reload":{"supported":true},"nativeUi":{"supported":true}}',
 (SELECT "id" FROM "workspaces" WHERE "slug"='default' LIMIT 1),CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;
UPDATE "agent_runtimes" SET "capabilities"='{"streaming":true,"resume":true,"cancel":true,"toolEvents":true,"fileChangeEvents":false,"restart":{"supported":true},"reload":{"supported":true},"nativeUi":{"supported":true}}', "updatedAt"=CURRENT_TIMESTAMP WHERE "id"='runtime-hermes-lisa';
-- Clint is no longer in main's runtime configuration or agent registry.
-- Retain any surviving row and its sessions/audit history; never delete it.
UPDATE "agent_runtimes" SET "enabled"=false,"updatedAt"=CURRENT_TIMESTAMP WHERE "id"='runtime-hermes-clint';
