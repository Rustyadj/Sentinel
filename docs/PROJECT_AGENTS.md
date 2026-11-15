# Agents people bring to a shared project

People and invitations (who is in a project) are `ProjectMember`,
`OrganizationMember` and `Invitation` in `src/lib/people/`. This document covers
the next layer: whose agent is whose, and which agents may talk across owners.

Data model and decision logic only. Nothing reads these tables yet; see
"Not done yet".

## Tables

| Table | What a row means |
| --- | --- |
| `project_agents` | One agent a person brought into a project: who it answers to, where it runs, and what it may do there. |
| `agent_link_rules` | One owner's side of the rule between their agent and someone else's. |

`agentId` is the registry id from `src/lib/agents/registry.ts`, the same string
`Message.agentId` and `ChatRoom.agentIds` carry. It has no foreign key and this
is not a second agent system: a `project_agents` row says who brought an
existing agent into a project, not what the agent is.

## Agents talking across owners

`resolveAgentLink` in `src/lib/collaboration/agent-links.ts`:

1. Same owner: always allowed.
2. Either agent has `canMessageOtherOwners = false`: blocked.
3. Otherwise the stricter of the two owners' `agent_link_rules` rows applies,
   in both directions. A missing row counts as `ASK`.

`ASK` means the message waits for a person. That request should be an
`ApprovalRequest`, not a new table: approvals already carry action binding,
reviewers and audit.

An agent's private memory, credentials and computer control never cross owners.
That is enforced where those are read, not by this rule.

## Open decision: who may bring an agent

`src/lib/people/roles.ts` says project editors, project viewers and org members
"cannot run agents". Letting every invited person bring their own agent
contradicts that as written. Two ways to square it, to be chosen before any
route creates a `project_agents` row:

- **Keep the rule.** Only owner, admin and operator bring agents. Guests work
  with the agents already in the project.
- **Scope the rule.** A guest may bring an agent that runs on its own server
  (`origin = "a2a"`) and spends none of this organization's compute or
  credentials, with `canUseComputer = false` and writes to project memory off
  by default. They still cannot run Sentinel-hosted agents.

## Migration

`20261115130000_project_agents` creates the two tables. It changes no existing
table and backfills nothing.

## Not done yet

- Routes to bring an agent, list a project's agents and set a link rule.
- Enforcing `resolveAgentLink` in `src/lib/orchestration/messages.ts` before an
  agent message with `recipientAgentIds` is delivered.
- Raising an `ApprovalRequest` when the answer is `ASK`.
- Connecting an outside agent by Agent Card (`origin = "a2a"`).
- UI: owner badges, the "who can talk to whom" screen.
