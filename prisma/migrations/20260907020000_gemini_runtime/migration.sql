-- Adds Gemini CLI as a first-class Sentinel runtime and Agent.
--
-- Additive only: no DROP, no TRUNCATE, no column changes. Existing agents, runtimes,
-- sessions and audit history are untouched.
--
-- Defaults are operator-selected and verified against Gemini CLI 0.58.0 installed on
-- this VPS: `gemini -m gemini-3.8-flash -o stream-json -p …` returns status:"success".
-- The CLI exposes no reasoning-effort control, so reasoningEffort stays NULL for this
-- agent rather than carrying a value the runtime cannot honor.
--
-- ON CONFLICT DO NOTHING throughout, so re-running never overwrites an operator's later
-- customization — these are bootstrap defaults, not enforced settings.

INSERT INTO "agents" ("id","name","role","avatar","color","model","memoryScope","status","skills","toolPermissions","workspaceId")
VALUES ('gemini','Gemini CLI','assistant','✦','#4285f4','gemini-3.8-flash','project','online',ARRAY[]::TEXT[],ARRAY[]::TEXT[],
 (SELECT "id" FROM "workspaces" WHERE "slug"='default' LIMIT 1))
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "agent_runtimes" ("id","agentId","kind","transport","configPath","logPath","capabilities","workspaceId","updatedAt")
VALUES ('runtime-gemini','gemini','gemini','process',
 '/opt/sentinel-os/agents/gemini','/opt/sentinel-os/logs/gemini.log',
 '{"streaming":true,"resume":true,"cancel":true,"toolEvents":true,"fileChangeEvents":false,"restart":{"supported":false},"reload":{"supported":false},"nativeUi":{"supported":false}}',
 (SELECT "id" FROM "workspaces" WHERE "slug"='default' LIMIT 1),CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;
