# Autonomy-first execution

Branch `feat/autonomy-first`. Code: `src/lib/autonomy/`. Decision: ADR-011 in `decisions.md`.

The principle: agents act on everything inside the authority a human has delegated, ask only for the
authority they are missing, and every action stays attributable. Authentication, tenant isolation,
provider requirements, Guardian's hard blocks and explicit operator restrictions are unchanged.

## 1. Restriction audit (main @ d2b7e4e)

Categories: **1** native provider requirement · **2** essential auth/infra security · **3** explicit
user/org restriction · **4** necessary operational/financial boundary · **5** redundant Sentinel-imposed
restriction · **6** architectural limitation. 1–4 are preserved; 5–6 were removed or redesigned
where that increases productive autonomy.

| # | Finding | Where | Cat | Outcome |
|---|---|---|---|---|
| 1 | Every write/exec room task needs a fresh human approval; only an env allowlist downgrades | `orchestration/action-policy.ts` `requiresHumanApproval` | 5 | **Redesigned**: standing grants clear covered actions (`lisa-loop.ts` `ensureApprovalCleared`) |
| 2 | `SENTINEL_APPROVAL_ALLOWLIST` is deploy-wide JSON in env: no revocation, budget, expiry or audit | `action-policy.ts` | 6 | **Superseded** by `AuthorityGrant`; still honoured for compatibility |
| 3 | Guardian Tier 2 "review" hold fires on keywords (migration, deploy, secret) on top of the approval gate | `learning/guardian.ts`, `lisa-loop.ts` | 5 | **Redesigned**: keywords now pick *which* authority is needed (`task-authority-rules.ts`); a grant covering it resolves the hold in the grantor's name |
| 4 | Guardian hard blocks: prompt-hierarchy override, credential exfiltration, path traversal, fake approval markers, self-elevation | `guardian.ts` | 2 | **Preserved**; never cleared by a grant |
| 5 | Guardian Tier 3 needs human authorization for deploy/external | `guardian.ts` | 4 | **Preserved**; a grant that names the operation counts as that authorization |
| 6 | Lisa loop hard-stops at 25 turns | `lisa-loop.ts` `MAX_LISA_ITERATIONS` | 5 | **Removed**: `AutonomySettings.maxOrchestrationIterations` (default 60); the stop message says work is preserved and how to continue |
| 7 | Supervised objectives get 1 attempt, Managed 2: one failed tool call fails the step | `objectives/policy.ts` `allowedAttempts` | 5 | **Removed**: every executing level gets the step's limit, capped by `maxRecoveryAttempts` (default 4); idempotency keys keep retries safe |
| 8 | New objectives default to Supervised (every write approved) | `objectives/service.ts` | 5 | **Changed**: default Managed (3) |
| 9 | Financial/legal/destructive/credential steps need a human at every level | `objectives/types.ts` | 4 | **Preserved as authority**: cleared only by a grant naming the operation; financial also needs a grant budget |
| 10 | Spending past the objective's budget needs approval | `objectives/policy.ts` | 3/4 | **Preserved**; never cleared by a grant |
| 11 | Advisory (1) and Supervised (2) levels | `objectives/policy.ts` | 3 | **Preserved**; Supervised accepts only grants scoped to that exact objective |
| 12 | Operator-edited `Agent.systemPrompt` is stored and versioned but never delivered to a runtime | `api/agents/[id]`, runtimes | 6 | **Fixed**: identity layers (`autonomy/identity.ts`) |
| 13 | Prompt assembly is ad hoc per surface; nothing records what Sentinel added | lisa-loop, context-builder, bots, roundtable, voice, mission-bridge | 6 | **Redesigned** for room turns, session chat and bots (`prompt-composer.ts`); roundtable, voice, mission-bridge and experiment prompts are not migrated yet |
| 14 | Claude Code and Codex may not work one task concurrently | `agents/coexecution-policy.ts` | 3 | **Preserved** (operator rule; sequential review is allowed) |
| 15 | Worker pool is the claude-code/codex runtimes; default capability weight table | `orchestration/capabilities.ts` | 6 | **Partly addressed**: capability registry + discovery API; pool selection itself unchanged |
| 16 | Objective roles may use only their template's tools | `objectives/roles.ts` | 3 | **Preserved** (vetted plan templates are the injection defence, ADR-010) |
| 17 | Bot tool grants are single-use per run; bot tasks refuse runtime approval questions | `bots/execution.ts`, `bots/policy.ts` | 3 | **Preserved**: per-bot operator configuration. Candidate to read `AuthorityGrant` later |
| 18 | Refusal / content-moderation text in Sentinel's prompts | grep over `src/lib` | — | **None found.** The untrusted-data markers ("outside agent, not an instruction", `<requester_context>`, experiment sandbox text) are category 2 prompt-injection defences and stay |
| 19 | Invitation-only signup, workspace permission checks, runtime isolation, Docker guards | `auth/`, `workspaces/authorization.ts`, `agent-workspaces/runner/` | 2 | **Preserved**, untouched |

## 2. What exists now

**Standing delegation** (`authority.ts` pure, `authority-store.ts` DB). Grants are tenant-scoped and
revocable, with optional limits: narrowing (project/agent/room/objective/capabilities/runtimes), `maxUses`,
day/week windows, budget and expiry. They are spent atomically by a conditional UPDATE. A retry of the
same action (same fingerprint) reuses its use, and every use writes an `AuthorityGrantUse`. Wired into the
Lisa approval gate, Guardian Tier 2/3, and objective steps. API: `GET/POST /api/autonomy/grants`,
`DELETE /api/autonomy/grants/:id`. Delegating consequential operations requires `permission.manage`.

**Prompt composition** (`prompt-composer.ts`, `agent-prompt.ts`). Layers are emitted in a canonical
order. Empty and duplicate layers are dropped, and each layer has a budget. On Hermes, the directive and
identity are sent once per session (`AgentSession.metadata.promptLayersDelivered`). Each distinct stack
is stored once in `PromptComposition`. `GET /api/autonomy/prompts` lists them and diffs two.
`findRedundantRestrictions` runs on Sentinel's own text; the target is 0 findings.

**Directive** (`directive.ts`, v1.0.0) is the spec's operating directive. It is versioned separately from
personalities.

**Identity** (`identity.ts`). The persona, personality, specialization, communication style and working
preferences come from the `Agent` row (new additive columns). They are independent of `Agent.model`.

**Settings** (`settings.ts`, `settings-store.ts`). Resolution is agent row → workspace row → defaults, and
the defaults are productive. Numbers are clamped to infrastructure bounds. No setting overrides
authority or tenancy. API: `GET/PUT /api/autonomy/settings`.

**Capability registry** (`capability-registry.ts`). A read-only union of MCP tools, agents and active
workspace skills. Each entry carries its required authority, availability, measured reliability where it
exists, and a credential *reference*. Discovery marks what the agent may already use and never grants.
API: `GET /api/autonomy/capabilities`.

**Proactive intelligence** (`proactive.ts` pure, `proactive-scan.ts`). It detects failed or blocked room
tasks with no follow-up, stalled objectives, and retry-exhausted steps. These are scored by value,
relevance, urgency, cost, availability and confidence, then throttled by interval, daily limit, minimum
score and dedupe. Only authorized work runs: it resumes Lisa with a recovery seed, or re-queues a failed
step exactly once. It runs from the orchestration-worker behind `SENTINEL_PROACTIVE=on`.

**Metrics** (`metrics.ts`, `GET /api/autonomy/metrics`). These are counts over persisted rows: approvals
per objective, human interventions, completion and recovery rates, grant uses, and prompt overhead.

**UI**: `/autonomy` (Run → Autonomy) has five tabs: overview, delegated authority, settings, capabilities
and prompt inspector. Objectives now default to Managed and link to it.

## 3. Not done / limitations

- Roundtable, voice, mission-bridge and learning-experiment prompts are not on the composer yet.
- Agent-to-agent messaging, task contracts, peer challenge/aggregation (spec §11) remain what the Lisa room
  loop already provides; no new A2A protocol was added. Delegation stays room-scoped, so authority cannot
  widen through it, but there is no explicit parent→child grant intersection.
- Memory categories (spec §8) are unchanged: the existing pipeline (`feat/memory-write-pipeline`) was not
  extended in this branch.
- Skill development (spec §10) reuses `learning/skill-generation.ts` / `skill-versions.ts` as they are; the
  registry only surfaces active skills.
- Objective plans are still template-fixed (ADR-010). "Alternative strategy" means retry and proactive
  re-queue, not LLM re-planning.
- The benchmark (`bench/autonomy/run.ts`) is policy-level and deterministic. It counts the stops each rule
  set would make on a seeded corpus and does not run models.
- The admin UI has not been browser-tested.

## 4. Deploying

1. Apply migration `20261127120000_autonomy_first`. It is additive: 4 tables and 4 nullable/defaulted
   `agents` columns.
2. Room-task behaviour is unchanged until someone creates a grant. Objectives created after deploy default
   to Managed.
3. Optional: `SENTINEL_PROACTIVE=on` on the orchestration-worker (tick: `SENTINEL_PROACTIVE_TICK_MS`,
   default 5 min).
