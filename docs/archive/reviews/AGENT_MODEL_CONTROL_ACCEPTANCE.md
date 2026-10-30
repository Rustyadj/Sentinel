# Agent model control — checkpoint evidence (2026-09-06 UTC)

**Checkpoint, not a completion or merge approval.** The operator requested a handoff
to Claude Code before final review. OpenClaw is explicitly excluded. See
[the continuation instructions](../CLAUDE_CODE_HANDOFF.md).

## Source and deployment state

- Repository: `Rustyadj/Sentinel`.
- Base: latest fetched main at `ba5b9abe64faf59d8604ef4748cd5c24dd1f21aa`.
- Branch: `feature/agent-model-control-and-learning-finish`.
- Isolated checkout: `/root/sentinel-agent-model-control`.
- Existing production checkout `/opt/sentinel-os` has unrelated local changes;
  it was not replaced, reset, merged, or deployed with this feature's application code.
- Production schema was backed up to
  `/var/backups/sentinel/model-control-before-20260906.dump` (0600), then
  `npx prisma migrate deploy` completed. Prisma subsequently reported up to date.
  The deploy applied main's pending primary-room flag migration and this additive
  model-control migration. Production already contained two older migration records
  absent from the reviewed main's files; none were edited or removed.

## Required report areas

1. **Nathan2 runtime:** one `runtime-hermes-nathan2`, canonical agent
   `hermes-nathan2`, Docker/Hermes transport, required default endpoint 4861,
   config/log roots, same verified capability defaults as Lisa. Same Hermes adapter.
2. **Nathan2 DB:** additive migration inserts canonical Agent and runtime with
   conflict-safe inserts. No second identity. Mission Control's existing room roster
   already includes Nathan2; runtime chat routing now does too.
3. **Clint:** surviving historical runtime is disabled, not deleted. Fresh/main-shaped
   upgrade test preserves an inserted historical Clint session/event. The old applied
   decommission migration had deleted its seed when no sessions referenced it;
   that historical migration is unchanged.
4. **Model architecture:** one resolver in model-policy.ts. Authorized session
   override > Agent persisted configuration > environment > built-in. Explicit
   reasoningEffort schema field; audited/event-emitting saves; session snapshots.
5. **Lisa default:** persisted/bootstrap `gpt-5.6-luna`; real Hermes response streamed.
6. **Nathan2 default:** persisted/bootstrap `gpt-5.6-luna`; discovery, authenticated
   health, session, stream and cancel exercised live.
7. **Claude default:** `claude-opus-5`, low. Requested explicitly. Actual execution
   blocked by expired mounted Claude OAuth credentials. Actual model is not claimed.
8. **Codex default:** `gpt-6-astra`, low. Real execution, stream, cancel and
   runtime-reported model/effort passed.
9. **Claude syntax:** mounted version 2.1.226 supports `--model MODEL --effort LEVEL`,
   `-p`, `--output-format stream-json`, `--verbose`. Host version was 2.1.263.
   UI exposes low/medium/high only when installed help advertises them.
10. **Codex syntax:** global arguments precede `exec --json --model MODEL
    -c 'model_reasoning_effort="low"'`. Mounted 0.147.0 rejected Astra with
    "requires a newer version". Host-installed 0.153.4 passed with the same mounted
    account. Its package was copied to `runtime-agents/bin/codex-lib-0.153.4` and the
    mounted launcher updated. Previous launcher remains
    `runtime-agents/bin/codex-before-model-control`; old codex-lib remains intact.
11. **OpenClaw:** excluded by operator. Adapter unchanged. Review shared route changes
    to ensure excluded/generic agents retain their existing editing behavior.
12. **Model UI:** model combobox, installed-runtime effort choices, save/reset,
    configuration source, availability evidence and requested/actual session values.
    Real authenticated browser save of Sol/high led to a real Sol/high Codex session;
    reset restored Astra/low without modifying that session's provenance.
13. **Session provenance:** requested model/effort/source/provider/timestamps retained;
    runtime-reported values stored separately. Codex actual values come from its
    owned session's turn_context JSONL, not merely Sentinel's request. Hermes values
    come from runtime session events. These are runtime reports, not independent
    provider billing attestations. Synthetic Claude auth responses aren't actual-model
    evidence. Hermes recreation retains pinned configuration.
14. **Learning gaps:** nine failure signal hooks through compileEvalCase; role-based
    real model execution through existing adapters; Evolution selection UI; Guardian
    model evidence; clarification policy artifact/flag/apply/rollback path. Two live
    roles were exercised: Lisa generated, Nathan2 independently denied, experiment
    stopped without promotion. Full safety review remains required.
15. **Tenant security:** Guardian/adversarial list scope tests pass, including hostile
    workspace filters. Additional evolution/lineage/eval/principle routes scoped;
    new experiment/apply routes gate access. Remaining scope-review concerns are
    enumerated in the handoff; do not claim a comprehensive security audit complete.
16. **Tests:** npm ci, Prisma validate/generate, migration deploy, typecheck, build,
    compose validation and diff check succeeded during this work. Last completed
    all-green full suite was 431 tests. Two subsequently added experiment-role tests
    initially had a test-hook cleanup mistake; fixed, focused rerun 2/2 passes.
    Final full-suite rerun is still required. Lint: 0 errors, 36 warnings. Playwright
    shell suite: 5/5 passes on isolated port 3309 after installing Chromium.
17. **VPS evidence:** locations and session IDs below. No mock-only acceptance claim.
18. **Blockers:** Claude OAuth expiry; final security/implementation review and fresh
    full validation; application feature branch not deployed/merged. Operator asked
    for this checkpoint before completing these steps.

## Live evidence (on this VPS; do not publish raw credential-bearing backups)

- `/tmp/sentinel-model-evidence/hermes-adapters.jsonl`: Lisa session
  `cmtqfp5vt0004kwbpeigt8ojg`, Nathan2 `cmtqfpdfw001kkwbp35idetit`; both requested/reported
  Luna, provider OpenRouter, returned `SENTINEL_MODEL_ACCEPTANCE_OK`, streamed/cancelled.
- Actual Hermes dashboard endpoints: Lisa `http://127.0.0.1:4862`, Nathan2
  `http://127.0.0.1:4864`. Keep required built-in defaults 4860/4861; configure env.
- Hermes transport verified: password-login -> cookie -> WS ticket -> JSON-RPC;
  session.create supports model and reasoning_effort. Both live YAML configurations
  had automatic fallback_model removed (set null), with 0600 backups under
  `/tmp/sentinel-model-evidence/hermes-*-config-before.yaml`. Do not expose these
  secret-containing files. Adapter refuses nonempty fallback configuration.
- `/tmp/sentinel-model-evidence/cli-adapters-final.jsonl`: Astra/low success,
  cancellation and Claude auth failure, with session provenance.
- `/tmp/sentinel-ui-acceptance.log`: browser save -> session
  `cmtqgn3dq006skwy9clba2paz` requested/reported `gpt-5.6-sol` + high; successful marker
  response; reset retained original session metadata. No browser page errors.
- `/tmp/sentinel-ui-security-experiment.log`: manifest
  `cmtqgtmca01bhkwy91krqqtlx`; generator Lisa
  `cmtqgtmfy01bjkwy9zha24rwo`, evaluator Nathan2
  `cmtqgtqy801nekwy9bi7z1k2c`; actual Luna reports; evaluator denial stopped pipeline.
- `/tmp/sentinel-model-panel-desktop-final.png`,
  `/tmp/sentinel-model-panel-mobile-final.png`, `/tmp/sentinel-evolution-models.png`,
  `/tmp/sentinel-ai-security.png`. Mobile clipping was corrected; 390px viewport
  panel fits (294px panel at x=80). Last security capture still needs review after
  forcing scoped mode; graph-store demo trace history can remain from earlier views.
- Validation logs: `/tmp/sentinel-migration-acceptance.log`,
  `/tmp/sentinel-production-migration.log`, `/tmp/sentinel-build-final.log`,
  `/tmp/sentinel-model-lint-final.log`, `/tmp/sentinel-typecheck-final.log`,
  `/tmp/sentinel-e2e.log`, `/tmp/sentinel-experiment-test.log`,
  `/tmp/sentinel-model-tests-final.log` (latest full run includes pre-fix test failures).
