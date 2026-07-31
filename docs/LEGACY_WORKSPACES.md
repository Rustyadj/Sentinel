# Legacy Workspaces Pattern

## Status: frozen for new development

`src/app/workspaces/*` is a second, undocumented routing pattern that predates
the registry-driven convention in `docs/MODULE_SYSTEM.md`. It is **not** dead
code — see "Current usage" below — but no new pages, sections, or features
should be added to it. All new module work, including Creator Studio, is built
exclusively on the `src/modules/*` registry pattern.

Migration of the existing workspaces content to the registry pattern is
**deferred until Creator Studio is stable**. This document exists so that
deferral is a tracked decision, not a forgotten one.

## What it actually is

- `src/app/workspaces/[workspace]/[...slug]/page.tsx` — a single dynamic route
  that renders different sections (`teams`, `board`, `documents`, `meetings`,
  `permissions`, `approvals`, `projects`, default overview) based on the slug,
  reading a `Workspace` DB row by slug and enforcing access via
  `requireWorkspacePermission` from `src/lib/workspaces/authorization.ts`.
- `src/app/workspaces/{marketing,studio}/page.tsx` — two static pages that both
  render the same `DatabaseWorkspaceOverview` component with a different
  `slug` prop. Thin wrappers, not independent implementations.
- `src/lib/workspaces/` — shared logic backing all of the above:
  `navigation.ts` (a *second* nav-item list, separate from the module
  registry), `authorization.ts`, `roles.ts`, `audit.ts`, `status.ts`.
- `src/components/workspace/` — `WorkspaceShell`, `WorkspaceHeader`,
  `WorkspaceCard`, `DatabaseWorkspaceOverview`.

## Current usage — this is load-bearing, not legacy-dead-code

Several modules registered in the live `moduleRegistry` (the thing that
actually drives the sidebar) point their `href` at a redirect shim that
immediately forwards into `/workspaces/*`:

| Module (registry id) | Registered href | Redirects to |
|---|---|---|
| `marketing` | `/marketing` | `/workspaces/marketing` |
| `security` | `/security` | `/workspaces/cybersecurity` |
| `orgchart` | `/orgchart` | `/workspaces/organization` |
| `kanban` | `/kanban` | `/workspaces/organization` |
| `workflows` | `/workflows` | `/workspaces/organization` |
| `builder` (label "Studio") | `/builder` | `/workspaces/studio` |

**Notable side effect found during this audit:** `src/modules/studio`'s actual
page component (`StudioPage.tsx` — the AI live-preview UI builder with a
component library) is not reachable through the app today. Its registered
route `/builder` redirects to `/workspaces/studio`, which renders the generic
`DatabaseWorkspaceOverview` instead. This looks like an in-progress,
unfinished migration, not an intentional design. Per explicit instruction, this
is left untouched and out of scope for Creator Studio work — noted here only so
it isn't mistaken for something Creator Studio broke or should fix.

A second, unrelated manifest format also exists: `src/lib/modules/manifests.ts`
(`ModuleManifestV2`), listing `kanban`, `knowledge-graph`, `organization`,
`cybersecurity` with their own hrefs (also mostly pointing at
`/workspaces/*`). Nothing in the app shell reads from it (confirmed: only
`src/components/layout/Sidebar.tsx` reads the real `moduleRegistry`); it
appears to be preparatory scaffolding for the Phase 5 marketplace format
described in `docs/ROADMAP.md`. It is a third pattern, also frozen, also not to
be extended by Creator Studio.

## Shared dependencies to be aware of

These matter because Creator Studio's Phase 1+ plan (see
`docs/CREATOR_STUDIO_PLAN.md`) reuses some of the same underlying Prisma
models that the legacy workspaces pattern also uses:

- **`Task` and `Document` models** — both have an *optional* `workspaceId`
  (nullable FK, `onDelete: SetNull`). They are not hard-coupled to the
  workspaces RBAC system at the database level — `requireWorkspacePermission`
  is enforced at the API-route layer in `src/app/api/{tasks,documents}/*`, not
  by the schema. This means Creator Studio can reuse `Task`/`Document` for its
  own brand-scoped needs (project tasks, asset/document storage) via its own
  `src/app/api/creator-studio/*` routes, leaving `workspaceId` null and adding
  a `brandId` column, **without** pulling in workspace permission checks. This
  was confirmed by reading `prisma/schema.prisma`, not assumed.
- **Adding a `brandId` column to shared tables** (`Task`, `Document`, or
  others as Phase 3+ needs arise) is itself a shared-schema change — it must
  not alter existing `workspaceId`-scoped query behavior for the legacy
  workspaces pages. Any such migration should be additive-only (new nullable
  column, new index), never a rename or constraint change on existing columns.
- **`lib/workspaces/navigation.ts`** duplicates the concept of the module
  registry's nav list but is scoped only to sections *within* a given
  workspace slug. Creator Studio's own internal secondary nav
  (`CreatorStudioShell`) must be new code, not an extension of this file — the
  two are for structurally different concerns (workspace sub-sections vs.
  module sub-sections) but resemble each other enough to invite accidental
  reuse. Don't.

## Migration (explicitly out of scope now)

No files under `src/app/workspaces/*`, `src/lib/workspaces/*`, or
`src/components/workspace/*` are modified, renamed, or deleted as part of
Creator Studio work. Revisit consolidating the two patterns only after Creator
Studio has shipped and stabilized.
