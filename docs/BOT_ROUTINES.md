# Bot routines

Routines are `Workflow` rows with `kind = routine`. Existing graph workflows
remain `kind = graph`; the graph API excludes routines so its generic status and
node updates cannot bypass routine review. Management uses the same workspace
owner/admin check as bot management. Work is scoped to the bot's workspace.

## Lifecycle

The bot detail page has a **Routines** tab. Create a proposal with an approved
Hermes skill, task, optional context, and optional fixed interval. Read the pinned
instructions and approve the exact routine digest, then run a test. A successful
test of that revision is required to enable it. A test performs real work through
normal delegation; the bot must be active and allow the requesting user. It does
not use the bot test endpoint's draft/allowed-caller bypass.

Enable starts the next interval from now, or enables manual-only runs. Pause
clears the next due time. Run now is available for enabled or reviewed paused
routines. Pausing does not cancel work already admitted: the existing task view
provides cancellation and tool approval decisions. Editing creates a new revision,
clears its review and schedule, and requires review and another successful test.
Reject also stops future scheduling and clears review. Review and enable retries
do not reset an already enabled schedule.

An edit does not change an older run's captured input, skill version, or revision.
Concurrent edits must provide the revision they started from and fail on conflict.

## Skill pinning and governed execution

On first routine use, an approved Hermes skill is checkpointed into the existing
`SkillVersion` model with implementation type `hermes-routine-snapshot`. Its
immutable implementation contains the exact body, body/source digests, name,
required tools, and original reviewer/timestamp. The original approved source
must still match its body digest. Versions with other implementation types are
not repurposed. A conflicting version is refused.

The additive migration protects checkpoint content and the source skill's content
from rewriting, including when the skill is also assigned to the bot. To change
checkpointed skill instructions, propose and approve a new skill, then edit and
review the routine. Revocation remains available and blocks new admissions. An
already admitted task retains its captured instructions and existing task lifecycle.

The routine compiles the full pinned skill into the existing bot task's `task`
text, along with routine identity, revision, and brief. It is subject to the
existing 12,000-character task limit; it is never silently truncated. No skill
script is executed. Other bot configuration, assigned skills, tool grants, model,
and memory/delegation policies remain governed by the existing live bot system;
the routine does not snapshot or expand those permissions.

The existing bot task admission path (`delegateToBotIn`) admits each run as the actual authenticated requesting user,
or the user who enabled the schedule. Current workspace administration is checked
again before unattended admission. All existing delegation checks, runtime health,
limits, memory policy, tool approvals, audit events, cancellation, usage and cost
reporting apply. Execution and retries remain on the existing orchestration
BullMQ queue and worker. No routine executor or separate queue is introduced.

`RoutineRun` records routine revision, skill version, bot, user, trigger, request
key, scheduled/created/started/completed timestamps, status, root/current task,
and bounded result/error summaries. Full outcomes, artifacts, usage and events
remain in the existing task view. Reconciliation follows approval continuations
and delegated descendants; a waiting approval or unconfirmed cancellation keeps
the routine occupied. Test success follows the final approval continuation.
Reconciliation examines at most 1,000 descendants per run and keeps the slot
occupied when that bound is reached, requiring operator inspection.

## Durable scheduling and overlap

The existing learning worker registers `bot-routine-sweep` every minute using its
existing idempotent BullMQ scheduler. The handler uses
`runRecordedScheduledJob`, preserving scheduler history. Keep the existing
learning and orchestration workers running with Redis and PostgreSQL configured.
The authenticated external scheduler endpoint is also available:
`POST /api/learning/scheduler/run-routines`, with the same
`Authorization: Bearer <NEURAL_SWEEP_SECRET>` boundary as existing sweeps.

`Workflow.nextRunAt` is authoritative, survives restarts, and advances atomically
with the durable run record. A sweep admits up to 50 due routines and recovers up
to 50 pending dispatches. Missed intervals coalesce into one attempt and then
advance to the next future slot on the original UTC cadence. There is no replay
storm after downtime. Scheduling is approximate: worker backlog can delay it.

A workflow row lock serializes trigger admission. Database indexes enforce one
in-flight run per routine and one run per trigger/idempotency key. Overlapping
attempts record a skipped outcome; they do not form a backlog. The active slot
includes pending dispatch, queued, running, waiting and cancelling states. There
is no routine concurrency override. The bot's own concurrency and budget checks
also still apply.

Task insertion, queued event, task audit, and routine task linkage commit in one
transaction through the existing admission/insertion code. A reserved
`routine-<run ID>` task idempotency key and partial unique index also prevent
repeated task admission. The routine stays pending until post-commit enqueue
succeeds. Recovery reuses its already linked governed task. Queued tasks are
re-enqueued only by their existing BullMQ job ID; recovery never starts runtime
work directly. Admission refusals are recorded failures; queue outages leave a
visible pending outcome and are retried by the next sweep.

Supported triggers are manual, test, and fixed intervals of 5–525,600 minutes.
Cron expressions, time-of-day/timezone schedules, webhook/event triggers and
parallel runs are not exposed.

## API

All bot-scoped endpoints require the existing bot workspace owner/admin access.

- `GET /api/bots/:id/routines`: routines, pinned review data, latest 20 runs.
- `POST /api/bots/:id/routines`: propose `{ name, description?, skillId, task,
  context?, intervalMinutes?: number | null }`.
- `GET /api/bots/:id/routines/:routineId`: current proposal and digest/history.
- `PUT /api/bots/:id/routines/:routineId`: full editable fields plus `revision`.
- `POST /api/bots/:id/routines/:routineId`: `action` of `review` (with current
  `digest`), `test` or `run` (with an `idempotencyKey`), `enable`, `pause`, `reject`.

Use the existing `/api/bots/tasks/:taskId` API for outcome details, cancellation,
and approval decisions. Routine approval is a review of a schedule and brief;
it grants no tools and does not replace tool approvals.

## Verification

No tests were added or run for this change, as requested. Existing tests reviewed:
`tests/bots/service.test.ts`, `api.test.ts`, `execution.test.ts`,
`approval-atomicity.test.ts`, `ui.test.tsx`,
`tests/orchestration/queue.test.ts`, and the release audit queue/scheduler tests.

Recommended commands after applying the migration to a dedicated development/test
PostgreSQL database and configuring test Redis (never production):

```sh
npx prisma migrate deploy
npx prisma generate
npx prisma validate
npm run typecheck
npm run lint
npm test -- tests/bots/service.test.ts tests/bots/api.test.ts tests/bots/execution.test.ts tests/bots/approval-atomicity.test.ts tests/bots/ui.test.tsx tests/orchestration/queue.test.ts tests/release-audit/queue-regressions.test.ts tests/release-audit/scheduler-history.test.ts
```

The existing suites cover governance boundaries, not the new routine lifecycle.
Before rollout, verify routine review/edit conflicts, immutable skill checkpoints,
simultaneous triggers, pause/enable, queue/process outage recovery, approval
continuations, scheduler restart/coalescing, workspace removal, and run history.
