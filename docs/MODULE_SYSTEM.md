# Module System

## Principle

The shell knows nothing about module internals.  
Modules know nothing about each other.

This is the constraint that makes the system extensible.

---

## Module Definition

Every module exports a `manifest` that conforms to `ModuleDefinition`:

```ts
interface ModuleDefinition {
  id: string              // unique, kebab-case
  label: string           // display name
  icon: string            // lucide-react icon name (string key)
  href: string            // Next.js route
  category: "core" | "installable"
  order: number           // nav sort order (lower = higher)
  description?: string    // shown in Module Manager
}
```

---

## Registration

Modules self-register by importing their manifest into the registry:

```ts
// src/modules/marketing/manifest.ts
import { moduleRegistry } from "@/lib/modules";

export const manifest: ModuleDefinition = {
  id: "marketing",
  label: "Marketing",
  icon: "BarChart3",
  href: "/marketing",
  category: "installable",
  order: 150,
  description: "CRM, campaigns, leads, SEO, and analytics",
};

moduleRegistry.register(manifest);
```

```ts
// src/modules/marketing/index.ts
export { MarketingPage } from "./components/MarketingPage";
import "./manifest";  // triggers registration
```

```ts
// src/modules/index.ts — import order = nav order
import "./dashboard";
import "./chat";
import "./agents";
import "./memory";
import "./knowledge";
import "./workflows";
import "./kanban";
import "./organization";
import "./cybersecurity";
import "./studio";
import "./marketing";
import "./settings";
```

---

## Registry API

```ts
class ModuleRegistry {
  register(def: ModuleDefinition): void
  get(id: string): ModuleDefinition | undefined
  getAll(): ModuleDefinition[]
  getNav(): ModuleDefinition[]       // excludes settings, ordered by .order
  getBottom(): ModuleDefinition[]    // settings and bottom-rail items
}
```

---

## Categories

### Core
Cannot be disabled. Always present in the nav rail.

- `dashboard`, `chat`, `agents`, `memory`, `knowledge`, `workflows`, `kanban`, `organization`, `settings`

### Installable
Can be enabled/disabled via Settings → Modules. State persisted in `installed_modules` table.

- `cybersecurity`, `studio`, `marketing`, `icf`, `crm`, `finance`
- User-created custom modules

---

## Creating a Module

1. Create directory: `src/modules/<id>/`
2. Create `manifest.ts` — define and register the module
3. Create `index.ts` — export components, import manifest
4. Create `components/<Name>Page.tsx` — the page component
5. Create Next.js route: `src/app/<route>/page.tsx` → `export { XPage as default } from "@/modules/<id>"`
6. Add import to `src/modules/index.ts`

---

## Custom Modules (User-Created)

Users can create custom modules via Settings → Modules → Create. These are stored in the `custom_modules` table and rendered at `/modules/[id]`.

Custom modules support:
- Markdown content
- iframe embed
- Title, icon, description

---

## Persistence

Module enable/disable state is stored in `installed_modules`:

```sql
CREATE TABLE installed_modules (
  id           TEXT PRIMARY KEY,
  module_id    TEXT UNIQUE NOT NULL,
  enabled      BOOLEAN DEFAULT true,
  config       JSONB DEFAULT '{}',
  installed_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);
```

The Module Manager (Settings → Modules) provides the UI for toggling installable modules.

---

## Design Invariants

- A module must never import from another module
- A module must never add navigation items outside the registry
- A module must never create its own sidebar or icon rail
- The shell must never import module component code directly
