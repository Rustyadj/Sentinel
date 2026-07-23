# Memory types

- Working memory is Redis-backed, run/conversation/agent/user/tenant scoped,
  explicitly expires in 60 seconds to 24 hours, and never auto-promotes.
- Episodic memory is the existing `Experience`/`Outcome`/`Evaluation` trajectory,
  including actions, tools, errors, artifacts, cost, runtime, feedback, and the
  exact active-memory snapshot.
- Semantic memory is the temporal `KnowledgeObject` graph plus typed decisions,
  claims, evidence, policies, and entities. Every new item originates from a
  reviewed `MemoryCandidate`.
- Procedural memory uses `Skill`, `Procedure`, `Workflow`, immutable
  `SkillVersion`, replay results, and workflow-run history.
- Personal knowledge uses `userId`. Organization/workspace/project knowledge
  uses explicit tenant fields. Null tenant IDs never imply public access.
- Temporal memory retains validity windows, supersession links, contradictions,
  review/expiry dates, and rollback history.

The legacy `Memory` table remains compatibility-only. It is not the new
authoritative write target for agents or MCP clients.
