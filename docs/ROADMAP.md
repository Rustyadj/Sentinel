# Sentinel OS — Roadmap

## Phase 1 — Platform Foundation (Current)

Goal: Establish a clean, extensible shell. No rewrite — refactor existing code into the right architecture.

- [x] Shell: AppShell, expandable navigation rail, TopBar
- [x] Auth: NextAuth v5, Google/GitHub/Credentials providers, registration
- [x] Module system: registry, manifests, self-registration pattern
- [x] Core modules: Dashboard, Chat, Agents, Memory, Knowledge, Workflows, Kanban, Organization, Settings
- [x] Installable modules: Cybersecurity, Studio, Marketing
- [x] Module Manager UI (Settings → Modules)
- [x] Database: Prisma v6, PostgreSQL 16, pgvector, Redis
- [x] Agent system: templates, config, logs, health
- [x] Memory architecture: scoped memory model, Inspector UI
- [x] Knowledge architecture: ObsidianNote model, backlinks
- [x] Org chart: visualization and management UI
- [x] Docker Compose + Traefik deployment
- [x] Documentation: ARCHITECTURE, MODULE_SYSTEM, MEMORY_ENGINE, ORGANIZATION_ENGINE
- [x] License: BUSL-1.1

---

## Phase 2 — Multi-Agent Collaboration

Goal: Agents can work together in shared rooms. Users can direct multiple agents at once.

- [ ] Multi-agent chat rooms (add/remove agents mid-session)
- [ ] Agent-to-agent messaging (agent can address another agent)
- [ ] Turn-based and parallel response modes
- [ ] Agent collaboration protocol (structured handoffs)
- [ ] Real-time presence (who is typing/thinking)
- [ ] Memory injection at prompt time (relevant memories surfaced automatically)
- [ ] Session memory in Redis (ephemeral scope)

---

## Phase 3 — Knowledge Graph

Goal: Obsidian-level knowledge management — wiki-links, backlinks, graph canvas.

- [ ] Wiki-link syntax (`[[note title]]`) in note editor
- [ ] Backlink resolution and display
- [ ] Interactive graph canvas (force-directed)
- [ ] Full-text search with semantic ranking
- [ ] Note templates
- [ ] Tag taxonomy and filtering
- [ ] Knowledge Explorer panel

---

## Phase 4 — Organization Engine

Goal: The org chart drives work, not just displays it.

- [ ] Role-based permission enforcement on all routes
- [ ] Agent routing rules (content-based, role-based, workload-based)
- [ ] Approval workflow execution engine
- [ ] Team management UI
- [ ] Delegation (user temporarily delegates permissions to agent)
- [ ] Audit trail for all org-level actions

---

## Phase 5 — Marketplace

Goal: Third-party modules can be discovered and installed.

- [ ] Module manifest format v2 (remote installable)
- [ ] Module registry (hosted catalog)
- [ ] One-click install/uninstall
- [ ] Module sandboxing (permissions declaration)
- [ ] Versioning and update notifications
- [ ] Developer SDK and documentation

---

## Phase 6 — Agent Autonomy

Goal: Agents can act on their own, not just respond to messages.

- [ ] Scheduled agent tasks (cron-style)
- [ ] Event-triggered agent actions
- [ ] Tool integrations (web search, file system, APIs)
- [ ] Agent-initiated memory writes (nightly reflection)
- [ ] Autonomous workflow execution
- [ ] Human-in-the-loop gates (approval required before action)
