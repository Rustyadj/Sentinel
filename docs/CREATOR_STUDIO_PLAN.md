# Creator Studio — Build Plan

Source spec: full product spec provided 2026-07-26 (not committed verbatim — this
doc is the scoped, buildable version of it).

## Naming

The spec's "Creator Studio" is unrelated to the existing `src/modules/studio`
module (an AI UI-component builder, route `/builder`, label "Studio"). Decision:

- Existing module (`src/modules/studio`, id `builder`, label "Studio", route
  `/builder`): **left untouched.** No rename, no code changes. It is a separate
  product from Creator Studio and stays that way.
- New module: directory `src/modules/creator-studio`, manifest id `creator-studio`,
  label "Creator Studio", route `/creator-studio`. Distinct id guarantees no
  registry collision regardless of what the `builder` module is labeled.

## Phase 0 — Document and freeze the legacy pattern ✅ done

Full writeup: [`docs/LEGACY_WORKSPACES.md`](LEGACY_WORKSPACES.md).

Headline finding from the audit: `src/app/workspaces/*` is **not** dead legacy
code — it's the live backend for six of the eleven registered nav modules today
(`marketing`, `security`, `orgchart`, `kanban`, `workflows`, and `builder`/studio
all redirect into it). It's frozen for *new* development, not because it's
unused, but because it predates and conflicts with the registry convention this
work follows. Also found: `src/modules/studio`'s own `StudioPage.tsx` is
currently unreachable (`/builder` redirects to `/workspaces/studio` instead of
rendering it) — an apparent unfinished migration, left untouched per instruction,
documented so it isn't mistaken for something Creator Studio broke.

`Task` and `Document` — the models Phase 2/4 below plan to reuse — have a
nullable `workspaceId` and are not schema-coupled to workspace RBAC (enforcement
is at the API-route layer only). Confirmed by reading `prisma/schema.prisma`:
safe to reuse for Creator Studio by adding a `brandId` column and leaving
`workspaceId` null, without dragging in workspace permission checks.

## Architectural decisions this spec forces

**One module, internal sub-navigation, built exclusively under
`src/modules/creator-studio`.** Per `MODULE_SYSTEM.md`, a module gets exactly one
entry in the nav rail and must not create its own sidebar rail. Creator Studio's
15 sub-areas (Dashboard, Brands, Calendar, Projects, YouTube, Shorts, Social,
Blog, Podcast, Asset Library, Brand Kit, AI Assistant, Publishing, Analytics,
Automation) are internal routes/views of that one module, not separate modules
and not separate global nav entries:

- `src/modules/creator-studio/manifest.ts` registers exactly one
  `ModuleDefinition` (id `creator-studio`, one `order`, one nav icon).
- `src/app/creator-studio/[[...section]]/page.tsx` → single Next.js route,
  re-exports the module's root page component, per the existing
  `src/app/<route>/page.tsx` → `@/modules/<id>` convention.
- Inside the module, a `CreatorStudioShell` component owns a *secondary* nav
  (rendered inside the module's own content area, visually distinct from and
  never replacing the app shell's primary rail) that switches between
  Dashboard/Brands/Calendar/etc. views by reading the `section` param. This is
  new code written specifically for this module — it does not reuse or extend
  the legacy `workspaces/[workspace]` pattern frozen in Phase 0.
- All Creator Studio components, API routes consumed by them, and section views
  live under `src/modules/creator-studio/` (components) and their own
  `src/app/api/creator-studio/*` namespace — nothing added to
  `src/app/workspaces/*`.

**Brand as the tenancy boundary.** The spec's core requirement — unlimited brands,
each with isolated memory/voice/analytics/prompts/accounts — means almost every
new table needs a `brandId` foreign key, and every AI call needs brand context
injected before it does anything else. This is the single most load-bearing
decision in the schema; get it right before building any UI on top of it.

**Reuse, don't rebuild, adjacent systems already in the schema:**
- `Memory` model + `MEMORY_ENGINE.md` → extend for per-brand AI memory rather than
  inventing a parallel memory system.
- `KnowledgeObject` / `KnowledgeEdge` / semantic search infra (already used by
  Knowledge module, backed by pgvector) → reuse for Idea Vault semantic search
  and global search, not a new search stack.
- `Workflow` model + `@xyflow/react` (already a dependency, used by the workflow
  builder) → reuse directly for the Automation visual workflow builder.
- `Task` model → reuse for Team Collaboration / project tasks instead of a new
  task table scoped to Creator Studio.
- `Document` / `Artifact` models → candidates for Asset Library backing store
  before inventing a new DAM schema.

**Platform integrations are out of scope for v1.** YouTube/TikTok/Meta/LinkedIn/
WordPress API integrations are explicitly "future" in the spec. Build the entire
data model and UI so publishing is a first-class concept, but ship v1 with
manual/webhook-free scheduling (status tracking only) and stub the actual
platform API calls. Don't let OAuth app approval timelines (YouTube/TikTok review
can take weeks) block the rest of the module.

## Phased delivery

### Phase 1 — Brands + Dashboard shell ✅ done
The minimum that proves the tenancy model works end to end.
- Prisma: `Brand`, `BrandProfile` (voice/audience/style/CTA/keywords),
  `Idea` model added (schema only — Idea Vault UI, `KnowledgeObject` linkage,
  and semantic search are not yet built; deferred to whenever that surface gets
  prioritized, not assumed done here)
- Brand switcher in the module's secondary nav (persists selection via
  `useCreatorStudioStore`, scopes all queries)
- Dashboard wired to real counts (brand count, idea count) via
  `/api/creator-studio/dashboard` — no fake data
- Verified live: registered a throwaway user, logged in, exercised brand
  create/list/delete through the running dev server end to end
- AI Assistant context injection (using `BrandProfile` for every AI call) is
  **not yet implemented** — noted in the original plan as the pattern later
  phases reuse, but no AI Assistant surface exists yet to inject it into

### Phase 2 — Projects + Content Calendar ✅ done
- Prisma: `ContentProject` (brand-scoped), `ContentItem` (status: idea →
  research → writing → editing → review → scheduled → published → archived).
  Added a nullable `contentProjectId` to the shared `Task` model (additive-only,
  per the Phase 0 rule — `workspaceId`/`projectId` untouched)
- `CalendarView`: month grid + Kanban toggle over the same `ContentItem` list,
  native HTML5 drag-and-drop (no new dependency) — drag between Kanban columns
  changes status, drag onto a calendar day sets `scheduledAt` and flips status
  to `scheduled`, unscheduled items sit in a tray above the grid
- `ProjectsView`: create/select `ContentProject`, inline task list per project
  reusing `Task` via new brand/project-scoped API routes (not the existing
  `/api/tasks/*`, which drags in workspace RBAC — see `LEGACY_WORKSPACES.md`)
- Verified live: created a project, added and moved a task, created a content
  item, moved its status, scheduled it, listed it back — full round trip with
  zero server errors, then deleted the test user (cascaded brand → project →
  items → tasks correctly)

### Phase 3 — Script Builder + Hook Generator + YouTube workspace fields ✅ done
- `ContentItem` gained `description`, `chapters` (Json), `outline` (Json);
  new `ContentHook` model for hook A/B variants (style, text, selected)
- **Brand-context injection implemented for real** — `src/lib/creator-studio/ai.ts`
  builds a system-prompt fragment from `BrandProfile` (mission, tone, hook
  style, CTA preferences, phrases to use/avoid, SEO keywords) and both new AI
  routes use it. This was promised in Phase 1 but not actually wired up until
  now — first place it was needed.
- `POST /api/creator-studio/items/[id]/script/generate` — SSE stream (same
  protocol as the existing Studio module's generator), handles outline vs.
  script targets, quick-action instructions (Rewrite/Expand/Condense/Improve
  Hook/Improve CTA), and the 7 script modes (storytelling/educational/sales/
  podcast/interview/conversation/technical)
- `POST /api/creator-studio/items/[id]/hooks/generate` — non-streaming,
  requests strict JSON from the model across the 8 spec hook styles
  (curiosity/authority/fear/statistics/question/contrarian/story/
  problem_solution), with a plain-text fallback if the model doesn't comply
- `ScriptBuilder.tsx`: three-pane editor (Outline / Script / AI Assistant +
  Hook Generator), plus a collapsible Details panel for the YouTube fields —
  the first genuinely new UI surface, and it got real layout attention rather
  than a quick form
- `YouTubeView.tsx`: lists video-type `ContentItem`s for the active brand,
  opens the builder
- Verified live end to end: brand profile → content item → all field updates
  (description/tags/chapters/outline/content) → hook save/select/delete, with
  both AI endpoints confirmed to fail *cleanly* (400, not a crash) when no
  Anthropic key is configured, exactly like the existing Studio module's
  generator does. Zero unexpected server errors.

### Phase 4 — Asset Library + Brand Kit ✅ done
- Evaluated `Document`/`Artifact` first: `Document` is text-only (no storage
  URL), and `Artifact`'s `type` field is scoped to agent-generated output
  ("generated_app", "generated_diagram", etc.) — a semantic mismatch for a
  creative DAM. Built a dedicated brand-scoped `Asset` model instead, keeping
  the `creator_studio_*` table family self-contained rather than retrofitting
  shared tables that don't fit.
- **Scope decision flagged rather than defaulted**: no file storage backend
  (S3/blob/etc.) exists anywhere in this codebase. Asset Library v1 is
  URL-reference based — you paste a link to an already-hosted file — not a
  real upload pipeline. Building that would mean picking a storage provider
  and eating that infra cost silently; flagged instead of guessed.
- Confirmed Brand Kit is BrandProfile's visual half exactly as planned — same
  table, no new model. But also found: `BrandProfile` has had zero editing UI
  since Phase 1 built the data model. Closed that gap here: `BrandKitView`'s
  profile form is the first place logo/colors/typography/tone/hook-style/
  CTA-preferences can actually be edited.
- Kit-slot categories (logo/intro/outro/watermark/lower_third/transition/
  thumbnail_template) are just a filtered view over the same `Asset` table,
  not a parallel structure — matches the spec's framing that Brand Kit items
  overlap with the general Asset Library.
- Verified live: asset CRUD, category filtering, version bump on edit, and a
  full BrandProfile update (colors/typography/voice fields) round-tripped
  correctly. Zero unexpected server errors.

### Phase 5 — Social Media + Blog + Podcast workspaces + Publishing Center ✅ done
- No parallel content models — `type` on `ContentItem` already distinguished
  video/short/social/blog/podcast, it just had no UI beyond YouTube. Added
  `platform` to item creation (was schema-ready but never wired), plus
  `type`/`status` query filters on the items API.
- `BlogView` and `PodcastView` **reuse `ScriptBuilder` unmodified** — it was
  already generic (system prompts reference `item.type` dynamically, nothing
  YouTube-specific was hardcoded), so long-form blog/podcast content gets the
  full outline/script/AI-assistant/hook-generator experience for free. Only
  `SocialView` needed a distinct UI (short-form composer, not a three-pane
  editor), with platform multi-select for one-compose-many-platforms
  cross-posting — creates one `ContentItem` per selected platform rather than
  inventing a many-to-many schema.
- Status enum extended with `publishing`/`failed` (just new string values,
  no migration needed) to support the Publishing Center's real workflow.
- **Publish is an honest stub**, not a fake success hidden from the user:
  `POST /api/creator-studio/items/[id]/publish` always "succeeds" (no
  platform integrations are wired up, per the Phase 1 scope decision) but
  returns `stub: true` and `PublishingView` surfaces a visible note that
  nothing calls a live API yet — so the status-transition workflow (Draft →
  Review → Scheduled → Publishing → Published/Failed → Retry) is real and
  testable without pretending the underlying integration exists.
- Verified live: created social/blog/podcast items, confirmed `type` filtering
  works, ran a full review → publish → published round trip through the real
  stub endpoint with `publishedAt` correctly set, all four new pages render
  cleanly. Zero unexpected server errors.

### Phase 6 — Shorts Generator + Thumbnail Studio ✅ done
- **Honesty check applied before building anything**: the spec's "Shorts
  Generator" implies real video/audio analysis ("AI identifies the strongest
  moments" in a video), and "Thumbnail Studio" implies real image generation,
  background removal, and CTR/heatmap prediction. Neither is possible — this
  codebase has no video processing pipeline and no image-gen/vision-model
  integration. Built the honest version of each instead of faking it:
  - **Shorts Generator** analyzes the source item's *script text* (not video/
    audio) to find quotable, self-contained excerpts, returned with a reason
    and suggested output platforms. If the source item has no script content,
    the API returns a specific, actionable error rather than a generic
    failure. Both the API route's own comment and the UI copy say plainly
    that this is text analysis, not video processing.
  - **Thumbnail Studio** generates concept *text* (headline overlay, visual
    composition description, color direction) via the same Anthropic pipeline
    as everything else, brand-context injected. The actual image is designed
    elsewhere and its URL pasted in — same paste-a-link pattern as Phase 4's
    Asset Library, for the same reason (no storage backend).
- Schema: added `sourceItemId` (self-relation on `ContentItem`, so a short
  knows what it was cut from) and `thumbnailUrl` — both additive, no new
  models. Confirms the plan's instinct that these are generation features
  layered on existing content, not new content types.
- Verified live: generated-shorts error paths (missing API key, missing
  source script) both return clean, specific messages rather than crashing;
  manually created a short with `sourceItemId` linkage and confirmed the
  relation query returns it correctly; saved and retrieved a `thumbnailUrl`.
  Zero unexpected server errors.

### Phase 7 — Analytics + Competitor Intelligence + SEO Workspace
- Needs real platform data (Phase 5 integrations) to be non-fake; sequence this
  after at least one real publishing integration exists, or it ships as an
  empty dashboard

### Phase 8 — Automation
- Visual workflow builder reusing `Workflow` model + `@xyflow/react` directly
- Do this last — it composes actions from every module above (generate → publish
  → notify), so it has no real content to orchestrate until they exist

## Explicitly deferred / needs a decision, not a default

- **Revenue/RPM tracking** — spec lists as "(future)" itself; no schema work now
- **Multi-platform OAuth** — needs your call on which platforms to prioritize
  first (YouTube is the obvious first given the spec's weighting toward it)
- **Team roles/permissions for Creator Studio** — the existing `Role`/
  `Permission`/`RoleAssignment` models look reusable but haven't been checked
  against this spec's approval/review workflow needs in detail

## Suggested next step

Phase 0 + Phase 1 as a single PR: resolves the module-pattern ambiguity, adds the
brand tenancy model, and ships a working brand switcher + dashboard shell. That's
the smallest slice that proves the architecture before any content-type-specific
UI gets built on top of it.
