# Claude Code continuation — Sentinel model control and Learning Core

The operator asked Codex to find a stopping point and hand this task to you.
**Continue the existing implementation; do not restart or rebuild it.**

## Repository and non-negotiable scope

Repository `Rustyadj/Sentinel`; checkout `/root/sentinel-agent-model-control`;
branch `feature/agent-model-control-and-learning-finish`; base main
`ba5b9abe64faf59d8604ef4748cd5c24dd1f21aa`.
Fetch and inspect the current branch/status first. Do not switch back to main,
recreate the branch, reset the checkout or overwrite production's unrelated changes.
Read AGENTS.md, docs/LEARNING_CORE_EVOLUTION.md and
[the checkpoint evidence](reviews/AGENT_MODEL_CONTROL_ACCEPTANCE.md).
Use Context7 for current library/CLI documentation and verify installed contracts.

**NO OPENCLAW.** OpenClaw has been removed from the Sentinel architecture
entirely — it is not a required, optional, fallback or legacy runtime. Do not
reintroduce it in any form. Do not redesign Sentinel or introduce another agent system, runtime system,
Learning Core, model registry, evaluator or security graph.

Finish the original four objectives using canonical systems:
1. Remaining governed evolutionary Learning Core wiring.
2. First-class canonical Hermes Nathan2 Agent and runtime.
3. Actual per-agent persisted model configuration controlling runtime execution.
4. Actual Claude Code/Codex model and effort configuration.

Required defaults (never silently substitute):
- Hermes Lisa and Hermes Nathan2: gpt-5.6-luna.
- Claude Code: claude-opus-5 + low.
- Codex: gpt-6-astra + low.
Resolver priority: authorized session override > persisted Agent > deployment env >
built-in. New sessions use updated defaults; running/history/recovery retain snapshots.
Unavailable model: MODEL_UNAVAILABLE with runtime, requestedModel, requestedEffort,
reason; the operator must choose fallback. No automatic worker reassignment as fallback.
Lisa remains lead, Nathan2 peer; model changes must not alter permissions/tools/identity.

## Resume checklist — work genuinely remains

1. Review the full branch diff. Many parts are implemented and live-tested, but
   this is a checkpoint, not an approved final implementation. Do not rely on docs
   alone: follow API -> resolver -> session store -> actual adapter/process/RPC.
2. Resolve mounted Claude OAuth authentication with the operator. It was expired;
   the operator was already asked to refresh `/opt/sentinel-os/runtime-agents/home/.claude`.
   Do not silently switch credentials/account or downgrade Opus. Inspect current
   state first in case authentication has been refreshed. Run Opus5/low real task,
   stream, cancel and provenance acceptance after it works.
3. Complete implementation/security review, especially:
   - Model override authorization, runtime/model-specific effort validation, invalid
     request handling, unavailable error fields through SSE and orchestration.
   - Generic Agent Registry edits: new saveAgentModel requires a configured
     managed runtime. Ensure shared legacy PUT routes do not regress ordinary/
     out-of-scope agent editing.
   - Candidate scope helper currently ORs relation/payload scope. Check precedence
     against requireLearningCandidateAccess so a forged payload cannot expose a
     candidate with authoritative ownership in another workspace. Audit every new
     evolutionary endpoint and mutation, including promotion/lineage, references to
     suites/experiences/principles, and workspace/agent target consistency.
   - Champion promotion now blocks a different workspace and locks the group, but
     workspace derivation must also handle candidates scoped only through agentId;
     protect cross-tenant groups and exact rollback behavior.
   - Experiment model roles currently ask agents not to use tools in their prompt.
     That is not an enforced tool boundary. Review how existing runtime permission/
     sandbox mechanisms should constrain generated/adversarial untrusted artifacts
     before treating automated model experiments as production-ready. Do not invent
     unsupported Hermes RPC flags or a new runtime. Strengthen payload/type/target
     validation; generator returned a nested wrapper in live testing and evaluator
     correctly rejected it. Ensure actual reviewer/adversary/Guardian session evidence
     and budget accounting remain canonical.
   - Nine live signal hooks exist; inspect actual failure emitters, dedupe/concurrency,
     secret redaction and delivery reliability. Personal events lacking workspace
     are stored with userId; check they remain discoverable only by the proper user
     and don't create shared unscoped regression access. No external CI webhooks
     were invented: external failures not reported to Sentinel aren't observed.
   - AI Security uses the canonical graph in scoped mode. The shared graph store
     can retain demo TRACE REPLAY history from another view. Make this surface
     consistently show real scoped evidence and avoid overlap; verify the final
     graph/suites/adversarial/Guardian UI, not just its title.
   - Model snapshots, Hermes session recreation/resume/cancellation ownership/races,
     actual-model reporting versus requested values, last successful availability
     evidence versus cancelled sessions, CLI config/fallback flags.
4. Finish tests and rerun all required validation. Last completed all-green full run
   was 431 tests. Two new experiment-role tests initially returned a mock from
   beforeEach (treated as cleanup); fixed and focused rerun passes 2/2. The last full
   log can still contain those pre-fix failures. Do not report 433 full-suite passes
   until actually rerun. Build passed; lint has 0 errors/36 warnings. Verify latest
   exact branch content again and record failures honestly.
5. Add any remaining meaningful tests from the original acceptance requirements:
   Nathan2 canonical row/runtime/room/session, four defaults, next execution args,
   pinned existing/running/recovered sessions, invalid model/effort and unauthorized
   writes, no fallback, tenant-scoped lists, all signal emitters and governed
   clarification application/canary/rollback. Existing new tests cover much of this.
6. Repeat VPS acceptance as needed. Lisa/Nathan2/Astra have already passed; don't
   confuse a saved dropdown with execution. Browser save Sol/high -> actual Sol/high
   was proved; historical provenance survived reset. Live multi-model experiment
   exercised Lisa generator and Nathan2 evaluator, which denied and stopped it.
   Four-role dispatch/Guardian evidence is covered in focused integration tests;
   verify the remaining roles live when authorized/runtime ready.
7. Update acceptance docs; commit/push fixes to this same feature branch. Do not
   claim the feature is deployed merely because production migrations were applied.
   Application feature code has NOT been merged/deployed to production. Prepare a
   concrete reviewable PR and final report; keep application deployment/merge status
   explicit and respect the operator's intended release scope.

## Services, commands and evidence

Production checkout `/opt/sentinel-os` is dirty with unrelated work: preserve it.
Production DB migration ALREADY APPLIED after a 0600 backup. Never reset production,
edit applied migrations or reapply raw migration SQL. Read the evidence report.
Both Hermes live fallback configurations were disabled; secret-containing backups
are under /tmp/sentinel-model-evidence (0600). Do not print or commit their contents.
Mounted Codex was upgraded reversibly from 0.147.0 to host-installed 0.153.4;
old launcher/package remain for rollback. See evidence report for exact paths.

Isolated test services remain available:
- container sentinel-model-test-db, pgvector PostgreSQL 16, localhost:55439
- DATABASE_URL=postgresql://postgres:sentinel_test@127.0.0.1:55439/sentinel_test
- container sentinel-model-test-redis, localhost:56389
- REDIS_URL=redis://127.0.0.1:56389
- browser review used localhost:3309, never production's localhost:3000.

From the feature checkout run:

```sh
npm ci
npx prisma validate
npx prisma generate
npx prisma migrate status
npx prisma migrate deploy
npm run typecheck
npm run lint
npm test
npm run build
PLAYWRIGHT_BASE_URL=http://127.0.0.1:3309 npm run test:e2e
AUTH_SECRET=sentinel-isolated-acceptance-secret docker compose config --quiet
git diff --check
python3 scripts/test-agent-model-migration.py
```

Set DATABASE_URL/REDIS_URL above for test commands. Isolated browser server also uses
AUTH_SECRET=sentinel-isolated-acceptance-secret and AUTH_TRUST_HOST=true. These are
local test credentials, not production secrets. playwright.config.ts supports a
custom base URL to avoid accidentally testing production on port 3000.
The migration test script creates disposable fresh and reviewed-main-shaped DBs on
the dedicated test container. It already passed, including historical Clint session/
event preservation and keeping later operator customization on a second migrate deploy.

`scripts/vps-model-acceptance.ts` runs real adapters against an isolated sentinel_test
DB. Runtime paths for same mounted accounts:
- CODEX_EXECUTABLE=/opt/sentinel-os/runtime-agents/bin/codex
- CLAUDE_CODE_EXECUTABLE=/opt/sentinel-os/runtime-agents/bin/claude
- CODEX_HOME=/opt/sentinel-os/runtime-agents/home/.codex
- CLAUDE_CONFIG_DIR=/opt/sentinel-os/runtime-agents/home/.claude
- AGENT_PROJECT_ROOT=/root/sentinel-agent-model-control
- HERMES_ENDPOINT=http://127.0.0.1:4862
- HERMES_NATHAN2_ENDPOINT=http://127.0.0.1:4864
- ACCEPTANCE_AGENTS comma-separated list to limit the check.

Hermes dashboard credentials come from the existing containers; never print them.
Temporary `/tmp/run-sentinel-acceptance.py` injects these safely for Hermes tests.
Temporary `/tmp/start-sentinel-review.py` starts the isolated app with mounted runtime
credentials. Other /tmp/sentinel-ui-*.mjs scripts contain reproducible browser checks
and signed LOCAL TEST sessions; never use them against production.

## Final report required by original task

Report Nathan2 runtime/DB integration, stale Clint handling, canonical model architecture,
Lisa/Nathan2/Claude/Codex defaults and actual execution, verified Claude/Codex syntax,
model UI, session provenance, Learning Core gaps fixed,
tenant-security result, tests, VPS acceptance evidence and every remaining blocker.
Do not claim completion with mocks alone or hide unavailable models by changing defaults.
