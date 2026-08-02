# PR #17 Unique-Value Audit

Reviewed branch: `origin/claude/adaptive-memory-skill-refinery`  
Reviewed head: `eeb91c11`  
Comparison bases: `origin/main` at `8197cd4a` and PR #20 at `c5d9509a`

This is a source audit only. Nothing from PR #17 was cherry-picked, its migration was not modified, and this document is not a merge recommendation. PR #17 introduces a second `MemoryCandidate`/`SkillCandidate` governance stack that overlaps the Neural Engine's canonical `LearningCandidate` and `Skill` path. The reusable ideas should therefore be ported selectively after PR #20, not merged wholesale.

| Capability | Already in main? | Already in PR #20? | Schema overlap | Security quality | Portability | Recommended action |
|---|---|---|---|---|---|---|
| Secure MCP gateway | No | No | Adds `McpClient`, request/idempotency and catalog state; no direct PR #20 table collision | Strong primitives: random credentials, peppered hashes, constant-time comparison, expiry/revocation, tenant binding and audit events. Gaps: wildcard scopes are accepted, no enforced maximum credential TTL, absent `Origin` is accepted, and the count-then-admit rate limit is raceable. | Gateway/catalog concepts are separable, but authorization must use the post-PR #20 workspace policy and canonical learning services. | **REBUILD CLEANLY AFTER PR #20** |
| Hashed short-lived MCP credentials | No | No | `McpClient` is additive | Credential plaintext is returned once and only a hash is stored. Production requires a pepper. “Short-lived” is caller-defined because no maximum TTL is enforced. | Auth helper can be ported with a maximum TTL and narrower scope grammar. | **REBUILD CLEANLY AFTER PR #20** |
| MCP scopes, rate limits and idempotency | No | No | Additive MCP request tables | Scope checks and request records are useful. Wildcard scope support weakens least privilege; count-based throttling is non-atomic; idempotency needs adversarial concurrency tests. | Port policy and tests, not the branch's schema wholesale. | **REBUILD CLEANLY AFTER PR #20** |
| Portable packages | No | No | Exports canonical Skill/Workflow/Evaluation data but imports skills through the competing `SkillCandidate` model | Imports are size-bounded and skill imports are quarantined for human review. Package version is not validated, packages are unsigned, and export payloads can include sensitive run history. | Export formats are useful once signing, version validation and canonical candidate admission are added. | **PORT AFTER PR #20** |
| Workflow discovery | No | No | Adds `WorkflowProposal`; writes the existing canonical `Workflow` after review | Requires workspace permission, human review and audit. Signature normalization is intentionally coarse; dedupe is a non-atomic `findFirst` and can race. | The detector can target the existing Workflow model after advisory-lock dedupe and tenant tests. | **PORT AFTER PR #20** |
| Supervised delegation | No | No | Adds `DelegatedRun`; uses existing Agent and Experience concepts | Enforces scope, agent tool allowlist and runtime/cost caps. It creates run records but does not itself provide a real executor, cost meter or cancellation propagation, so the current behavior is a control-plane proposal rather than complete supervised execution. | Useful interface, but execution and accounting boundaries need to be designed with the queue/worker architecture. | **REBUILD CLEANLY AFTER PR #20** |
| Active-memory snapshots | No | No | Adds `ActiveMemorySnapshot` linked to Experience; reads canonical Decision/Policy plus competing memory candidates | Token bounded and content-hashed. It verifies agent/objective but does not comprehensively prove that every supplied organization/workspace/project belongs to the run and acting user. | Snapshot rendering is separable after replacing `MemoryCandidate` preference reads with canonical Memory/evidence. | **PORT AFTER PR #20** |
| Admission firewall | No | Partial risk and sandbox gates, but not source-poisoning admission | `MemoryCandidate` and `SkillCandidate` duplicate the canonical `LearningCandidate`/Skill governance path | Useful quarantine rules for external content, instruction injection and evidence-free inference. The separate candidate authority would recreate the dual-governance problem PR #20 is intended to avoid. | Port the pure policy scanner and tests into canonical LearningCandidate/Memory ingestion. | **REBUILD CLEANLY AFTER PR #20** |
| Source management | No complete source-document registry | No | Adds `SourceDocument`/chunks and feeds memory ingestion | Routes use authenticated scope checks and bounded reads. Import provenance/checksum concepts are useful; source lifecycle and sensitivity enforcement still need integration tests. | Mostly additive and can feed canonical Memory/KnowledgeObject ingestion. | **PORT AFTER PR #20** |

## Rejected merge shape

Do not merge PR #17 as a unit and do not retain these competing sources of truth:

- `MemoryCandidate` beside `LearningCandidate`;
- `SkillCandidate` beside the PR #20 skill-generation candidate pipeline;
- adaptive trust/admission decisions that bypass the central Neural Engine policy;
- a second approval lifecycle outside `ApprovalRequest` and `AuditLog`.

The unique-value sequence should be: MCP credential boundary, source registry, portable-package validation, active-memory rendering, workflow discovery, then delegation. Each port needs tenant-isolation and concurrency tests against the post-PR #20 schema.
