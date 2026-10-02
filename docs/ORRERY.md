# Orrery (chat home)

The chat home draws the user's real knowledge graph as a globe behind the conversation. Nothing on it is simulated.

| What you see | Where it comes from |
|---|---|
| Nodes, edges, regions | `GET /api/graph/scoped` (bounded, 400 nodes), laid out by `neural-lens/globeLayout`. Nodes an event points at that the base read missed are fetched with `?focus=<id>&depth=1` and merged. |
| Agent probe position | The agent's own `KnowledgeObject` (`sourceType: "agent"`). Agents with no node rest in a small ring at the core. |
| Probe movement | Only real events: `GET /api/orrery/activity` returns events with `nodeIds` (see below). A probe travels to each node an event touched, then returns home once its agent is idle. History from before the page opened is shown in the feed but never replayed as movement. |
| Working / idle | An active `AgentSession` (fresh within 10 min), a running `OrchestrationRun`, or this chat awaiting a reply. |
| Event feed | `AgentRuntimeEvent` (tool, command, file change, approval), `OrchestrationRun`, `Experience` (with `knowledgeUsed` as the touched nodes) and pending `ApprovalRequest`. |
| Run / approval cards | The same endpoint. Approve/Reject call `PATCH /api/approvals/[id]`; only approvals the caller may review (`approval.review`) are returned. |
| Model picker | `GET`/`PUT /api/agents/[id]/model`. Changes apply to new sessions. |
| Voice | `VoiceControls` for agents with a voice config (`CANONICAL_VOICE_AGENT_IDS`). |

Layout scaffolding the shared adapter adds for loose nodes ("Unclustered") is filtered out and never drawn.
