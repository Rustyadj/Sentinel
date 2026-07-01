# Organization Engine

## Purpose

The Organization Engine is the part of the shell responsible for:

- Who exists (users, agents, roles)
- Who reports to whom (hierarchy)
- Where work goes (routing)
- Who must approve (approval chains)
- What each principal can do (permissions)

The Organization module in the UI is only a management surface for this engine. The engine itself is shell infrastructure.

---

## Concepts

### Principals

A principal is any entity that can act in the system:

- **User** — a human with an account
- **Agent** — an AI agent definition
- **Role** — a named set of permissions (e.g., "Engineering Lead")
- **Team** — a group of users/agents

### Hierarchy

The org chart (`OrgChart` model) stores nodes and edges as JSON. Each node has:

```ts
interface OrgNode {
  id: string
  type: "user" | "agent" | "team" | "role"
  label: string
  parentId?: string
  permissions?: string[]
  routingRules?: RoutingRule[]
}
```

### Routing

Routing rules determine which agent receives a task or message based on:

- Message content (keywords, intent classification)
- Task type (project type, priority)
- Workload (round-robin, least-busy)
- Role (specific agent role required)

### Approvals

Approval chains are defined per action type. An action can require:

- Single approver (any matching role)
- Sequential approvers (ordered chain)
- Parallel approvers (all must approve)
- Threshold (N of M approvers)

---

## Current State (Phase 1)

Phase 1 establishes the data model and management UI only.

Implemented:
- `OrgChart` model (nodes + edges JSON)
- Org chart visualization (`/orgchart`)
- API: `GET/POST /api/org`
- Agent `role` and `memoryScope` fields

Not yet implemented:
- Runtime routing engine
- Approval workflow execution
- Role-based permission enforcement
- Team management

These are Phase 4 targets.

---

## Data Model

```prisma
model OrgChart {
  id        String   @id @default(cuid())
  name      String   @default("Main")
  nodes     Json     @default("[]")
  edges     Json     @default("[]")
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}
```

Node and edge shapes are intentionally stored as JSON to allow flexible org structures without schema migrations for every org design change.
