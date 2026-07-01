# Sentinel OS — Architecture

## Overview

Sentinel OS is built as a layered system: a permanent shell that owns infrastructure concerns, with all feature surfaces implemented as self-registering modules.

This separation is the core architectural invariant. The shell knows nothing about module internals. Modules know nothing about each other.

---

## Layers

### 1. Infrastructure (Shell)

The shell owns everything that must exist for the system to operate:

- **Authentication** — NextAuth v5 with JWT sessions. Credentials, Google, GitHub providers.
- **Database** — Prisma v6 ORM over PostgreSQL 16 + pgvector. All schema migrations run at deploy.
- **Cache** — Redis 7 for session state, real-time coordination, and ephemeral memory.
- **Routing** — Next.js 16 App Router. Protected routes via middleware.
- **Navigation** — Single expandable left rail. No module may add its own icon rail.
- **API** — REST endpoints under `/api/`. SSE for streaming responses.

### 2. Core Services

Services the shell provides to all modules via hooks and context:

```
useAgentStore     — agent list, status, CRUD
useMemoryStore    — memory CRUD, scoped queries
useKeyStore       — browser-stored API keys
useAppStore       — global UI state
```

### 3. Module Layer

All feature surfaces live here. Modules self-register at app startup via manifests.

```ts
// Every module exports a manifest
export const manifest: ModuleDefinition = {
  id: string,
  label: string,
  icon: string,            // lucide-react icon name
  href: string,            // route
  category: "core" | "installable",
  order: number,
  description?: string,
}
```

The Module Registry (`src/lib/modules/registry.ts`) holds all registrations. The Sidebar reads from the registry — it never imports module components directly.

---

## Data Flow

```
Browser Request
  → Next.js Middleware (auth check)
    → App Router (layout, page)
      → AppShell (Sidebar + TopBar + content area)
        → Module component (rendered by page)
          → API Route (server-side)
            → Prisma → PostgreSQL
            → Redis (cache/memory)
            → AI Provider (SSE stream back)
```

---

## Database Schema

Core entities:

| Model | Purpose |
|-------|---------|
| User | Auth accounts (OAuth + credentials) |
| Project | Work containers |
| Agent | Agent definitions and config |
| ChatRoom | Chat sessions with assigned agents |
| Message | Chat history |
| Memory | Multi-scoped memory entries (pgvector) |
| ObsidianNote | Knowledge graph nodes |
| KanbanBoard | Project boards |
| Workflow | Automation definitions |
| OrgChart | Org hierarchy (nodes + edges JSON) |
| InstalledModule | Module enable/disable state |
| Task | Cross-project task tracking |
| Document | Rich documents with history |
| CustomModule | User-created installable modules |
| AuditLog | Agent action log |

---

## Memory Architecture

Memory is scoped. An agent or user can read/write at any scope they have access to:

```
session    → current conversation only (Redis, ephemeral)
project    → scoped to a project (PostgreSQL)
workspace  → all projects for a user (PostgreSQL)
org        → entire organization (PostgreSQL)
user       → personal memory across all contexts (PostgreSQL)
public     → shareable, readable by anyone (PostgreSQL)
```

Embeddings (pgvector) enable semantic search within any scope.

---

## Agent Architecture

Every agent is defined by:

```ts
interface Agent {
  id: string
  name: string
  role: string
  avatar: string
  color: string
  model: string
  systemPrompt: string
  toolPermissions: string[]
  memoryScope: MemoryScope
  status: "online" | "offline" | "busy" | "error"
  description: string
  skills: string[]
  instructionFiles: InstructionFile[]
  promptHistory: PromptVersion[]
}
```

Instruction files support `.md`, `.json`, `.yaml` with version history and rollback.

---

## Navigation

One rail. Always.

- Collapsed by default — 56px wide, icons only
- Expands on hover near left edge — 224px, shows labels + section nav
- Pinnable (stays expanded)
- Bottom section: Settings, user avatar
- No module may create a second icon rail or duplicate sidebar

---

## Deployment

```
┌─────────────────────────────────────────────────────┐
│  Traefik (reverse proxy + TLS)                      │
│    sentinel.srv1427612.hstgr.cloud → :3000          │
├─────────────────────────────────────────────────────┤
│  Docker Compose                                     │
│    app       (Next.js 16, standalone)               │
│    postgres  (pgvector/pg16)                        │
│    redis     (Redis 7)                              │
│    migrate   (prisma migrate deploy, run-once)      │
└─────────────────────────────────────────────────────┘
```

API keys (Anthropic, OpenAI, OpenRouter) are stored only in the browser (localStorage). The server never persists them.
