# Module System

This describes what the code does today. The earlier self-registering
`moduleRegistry` (`src/lib/modules/registry.ts` plus a `manifest.ts` per module)
was write-only — nothing read it after the old Settings page was retired — and
was removed. Do not reintroduce a second registry; extend the pieces below.

## The four pieces

| Concern | Source of truth | Notes |
|---|---|---|
| Shell navigation | `src/lib/navigation.ts` (`SHELL_NAV_GROUPS`, `PRIMARY_NAV`) | The rail is a static list. Domain modules are deliberately not in it; they are reached from `/workspaces`. |
| Module code | `src/modules/<name>/components/*` | Imported directly by App Router pages under `src/app/`. A module may expose an `index.ts` barrel. |
| Installable catalog | `src/lib/modules/manifests.ts` (`MODULE_MANIFESTS`, manifest v2) | What `/marketplace` lists. Install/enable state lives in `installed_modules`. |
| Custom modules | `custom_modules` table, rendered at `/modules/[id]` | Markdown or an https iframe. Created/edited through `/api/modules/custom` (owner/admin only, fields allowlisted in `src/lib/modules/custom-modules.ts`). There is currently no UI for creating them. |

## Catalog manifest (v2)

```ts
interface ModuleManifestV2 {
  manifestVersion: 2;
  id: string;
  name: string;
  version: string;
  description: string;
  category: string;
  href: string;
  declaredPermissions: Array<{ resource: string; actions: string[] }>;
}
```

Catalog entries today: `kanban`, `knowledge-graph`, `organization`,
`cybersecurity`. There are no ICF, CRM or Finance modules.

## Adding a module

1. `src/modules/<name>/components/<Name>Page.tsx` — the UI.
2. `src/app/<route>/page.tsx` — a server page that authorizes the user and renders it.
3. If it should be installable, add a `MODULE_MANIFESTS` entry.
4. If it belongs in the shell rail (rare — the rail is intentionally small), add it to `src/lib/navigation.ts`.

## Persistence

`installed_modules` holds per-module enable state and config; `custom_modules`
holds user-created modules. Both are global (not workspace-scoped).

## Invariants

- A module never imports from another module.
- A module never renders its own sidebar or icon rail.
- Navigation comes only from `src/lib/navigation.ts`.
