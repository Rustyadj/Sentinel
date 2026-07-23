# Sentinel OS

**The AI Operating System.**

Sentinel OS is not a dashboard. It is not a chatbot wrapper. It is not an admin panel.

It is an operating system for AI work — the shell that manages agents, memory, knowledge, projects, and workflows across an organization.

---

## What It Is

Sentinel OS provides a persistent, structured environment where AI agents operate alongside humans. It manages:

- **Identity** — who is acting (user, agent, role)
- **Context** — what they know (memory, knowledge, project state)
- **Coordination** — how work flows (routing, approvals, delegation)
- **Execution** — what they do (tools, models, integrations)

The shell is the product. Everything else plugs into it.

---

## Why It Exists

Most AI tools treat agents as features. Sentinel OS treats them as first-class citizens of a working environment.

A typical AI dashboard gives you a chat box. Sentinel OS gives you:

- Persistent agent memory scoped to session, project, workspace, or org
- A knowledge graph with wiki-links and backlinks
- An org chart that drives routing, approvals, and delegation
- A module system that lets new capabilities plug in without touching the shell
- A unified navigation rail that never duplicates itself

---

## Architecture

```
Sentinel OS
├── Shell                  # Auth, routing, permissions, org engine
│   ├── Navigation Rail    # Expandable left rail, icons-only collapsed
│   ├── Module Loader      # Dynamic module registration and rendering
│   ├── Org Engine         # Hierarchy, roles, approval routing
│   ├── Memory Engine      # Multi-scoped memory (session → org)
│   └── Knowledge Engine   # Notes, graph, search, backlinks
│
├── Core Modules           # Always present, cannot be removed
│   ├── Home / Dashboard
│   ├── Chat               # Multi-agent rooms, SSE streaming
│   ├── Projects
│   ├── Knowledge          # Obsidian-style notes + graph
│   ├── Memory             # Memory inspector and reflection
│   ├── Agents             # Agent management, config, logs
│   ├── Organization       # Org chart management UI
│   ├── Marketplace
│   └── Settings
│
└── Installable Modules    # Optional, plug-in via registry
    ├── Cybersecurity
    ├── Studio
    ├── Marketing
    ├── ICF (Construction)
    ├── CRM
    ├── Finance
    └── Custom (user-created)
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for full system design.

### Adaptive memory and controlled learning

Sentinel is the canonical memory and governance layer for connected agents.
Untrusted observations enter an admission firewall, retrieval produces durable
Recall Traces, agent runs retain frozen active-memory snapshots, skills require
replay and human promotion, and remote clients use the scoped `/mcp` gateway.
See [docs/adaptive-memory/ARCHITECTURE.md](docs/adaptive-memory/ARCHITECTURE.md)
and [docs/adaptive-memory/OPERATIONS.md](docs/adaptive-memory/OPERATIONS.md).

---

## Module System

Every feature outside the core shell is a module. Modules self-register via a manifest:

```ts
export const manifest: ModuleDefinition = {
  id: "marketing",
  label: "Marketing",
  icon: "BarChart3",
  href: "/marketing",
  category: "installable",
  order: 150,
  component: () => import("./components/MarketingPage"),
};
```

The shell renders any registered module without knowing its internals.

See [docs/MODULE_SYSTEM.md](docs/MODULE_SYSTEM.md) for the full spec.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 16 (App Router) |
| Language | TypeScript 5 |
| Styling | Tailwind CSS v4 |
| Auth | NextAuth v5 (Google, GitHub, Credentials) |
| ORM | Prisma v6 |
| Database | PostgreSQL 16 + pgvector |
| Cache | Redis 7 |
| AI | Anthropic SDK, OpenAI SDK, OpenRouter |
| State | Zustand |
| Deployment | Docker Compose + Traefik |

---

## Development

```bash
# Install dependencies
npm install

# Run locally (requires .env.local)
npm run dev

# Lint
npm run lint

# Type check
npx tsc --noEmit

# Build
npm run build
```

### Environment Variables

```env
DATABASE_URL=postgresql://...
REDIS_URL=redis://...
AUTH_SECRET=...
AUTH_URL=https://your-domain.com
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
```

---

## Deployment

Docker Compose with Traefik reverse proxy. See `docker-compose.yml`.

```bash
docker compose up -d
```

---

## Roadmap

See [docs/ROADMAP.md](docs/ROADMAP.md).

**Phase 1 (current):** Platform foundation — shell, module system, auth, agents, memory architecture  
**Phase 2:** Multi-agent collaboration — real-time rooms, agent-to-agent routing  
**Phase 3:** Knowledge graph — full Obsidian-style notes with backlinks and canvas  
**Phase 4:** Org engine — approval routing, delegation, role-based access  
**Phase 5:** Marketplace — installable module distribution

---

## License

Sentinel OS is licensed under the [Business Source License 1.1](LICENSE).

© 2024 Rustyadj. All rights reserved.

On 2028-01-01, this license converts to Apache 2.0.
