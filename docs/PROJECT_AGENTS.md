# Agents people bring to a shared project

People and invitations (who is in a project) are `ProjectMember`,
`OrganizationMember` and `Invitation` in `src/lib/people/`. This document covers
the next layer: whose agent is whose, and which agents may talk across owners.

Outside agents (ones that run on their owner's own server) are wired end to
end. Rules between agents of different owners are still data model and
decision logic only; see "Not done yet".

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

## Who may bring an agent

Decided: **the rule is scoped, not lifted.** Anyone who may write to a project
(its owner, an editor, or a workspace role with `project.update`) may bring an
agent that runs on **their own server** (`origin = "a2a"`). Guests are editors,
so this includes them. A viewer may not. Nobody gains the right to run
Sentinel-hosted agents this way: that still needs `agents.runtime.execute`.

An outside agent is a peer, not a Sentinel runtime. Sentinel does not start it,
choose its model, give it a worktree, or lend it this organization's compute,
credentials, memory or computers. That is why it lives here and not under
`src/lib/agents/runtime/`, and why it has no `AgentSession` or model policy:
its model is "not reported", because Sentinel has no way to know it.

| Who | May |
| --- | --- |
| Anyone who may write to the project | Bring up to 5 agents of their own |
| The agent's owner | Pause, resume, re-check, issue a new token, remove |
| Project owner, team admin | Pause, remove (not resume or re-key: turning it back on is the owner's call) |

Taking a person off a project pauses their agents there.

## How an outside agent is reached

Code: `src/lib/collaboration/` (`project-agents.ts`, `a2a/`, `agent-token.ts`)
and `src/lib/orchestration/outside-agent-turn.ts`.
Routes: `/api/projects/[id]/agents` and `/api/projects/[id]/agents/[agentId]`.

1. The person gives the address of their agent or of its Agent Card. Sentinel
   fetches the card (`/.well-known/agent-card.json` when given a base address)
   and stores the name, description and JSON-RPC endpoint. No row is written
   unless the card is read.
2. Sentinel returns a bearer token, once. The person sets their server to
   require it. The token is `HMAC(key derived from AUTH_SECRET, row id +
   tokenVersion)`: it is never stored, so the database holds nothing usable,
   and re-keying is a version bump. Rotating `AUTH_SECRET` re-keys every agent.
3. In a room of that project the chat page offers "Ask <agent>" beside "Tell
   the room" (`POST /api/rooms/[roomId]/messages` with `toAgentId`); the
   collaboration room route reaches it by an @mention of it alone. Either way
   `runOutsideAgentReply` sends it **that one message** over A2A and posts its
   answer as the agent. It is sent no room
   history, project memory or files. It is never a lead or a worker, and a
   message meant for it never falls through to Lisa.
4. If its server fails, times out or answers with nothing, the room gets a
   notice saying so (a `system` message) and an `agent.failed` event. Nothing
   is written in the agent's name.

Both A2A wire dialects are spoken, chosen from the card: 1.0 (`SendMessage`,
`GetTask`) and 0.3 (`message/send`, `tasks/get`). JSON-RPC only; a task still
running is polled, with a two-minute limit for the whole turn.

### What keeps this from being a way into the server

The address is typed by a guest and fetched by Sentinel, so it is an SSRF
vector. `src/lib/collaboration/a2a/http.ts` is the only place a connection is
opened:

- `https` only, no credentials in the URL, no address literal in a private,
  loopback, link-local, CGNAT or reserved range (`src/lib/net/public-address.ts`).
- Names are checked **on the connection**: the lookup the socket uses refuses
  any name that resolves to a non-public address, so re-resolving a name
  between a check and a fetch gains nothing.
- Redirects are refused, not followed. Bodies are capped (256 KB card, 1 MB
  reply) and every call has a deadline.
- The endpoint a card names is held to the same rules as the card's address.

`PROJECT_AGENT_ALLOW_PRIVATE=1` lifts the address rules and allows `http`, for
an agent on a developer's own machine. It is ignored when `NODE_ENV` is
`production`.

Lisa's context (`context-builder.ts`) labels anything an outside agent wrote
as not an instruction.

## Migrations

- `20261115130000_project_agents` creates the two tables.
- `20261115140000_project_agent_connection` adds nullable or defaulted columns
  to `project_agents`: `name`, `description`, `endpointUrl`, `protocolDialect`,
  `tokenVersion`, `lastCheckedAt`, `lastError`.

Neither changes another table or backfills anything. A removed agent's row is
kept with `status = "removed"`, so messages it wrote still carry its name.

## Not done yet

- Agents talking to each other. An outside agent only answers people. Enforcing
  `resolveAgentLink` in `src/lib/orchestration/messages.ts`, raising an
  `ApprovalRequest` on `ASK`, and the routes and screen for link rules all
  wait on that.
- Conversation memory for an outside agent. Each message is a fresh A2A turn
  with no `contextId`, so the agent does not see what was said before unless
  its own server keeps track.
- Streaming. The answer arrives whole.
- An agent that needs its own credential from Sentinel (an API key, OAuth).
  Only Sentinel's bearer token is sent.
- `project_agents` rows for Sentinel-hosted agents (`origin = "sentinel"`), and
  owner badges on them.
- Outside agents at a roundtable.
