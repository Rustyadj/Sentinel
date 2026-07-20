# Sentinel OS Design System

Sentinel OS is a premium operational interface for coordinating people, agents, memory, workspaces, and decisions. It should feel intelligent, calm, high-trust, and fast under repeated daily use.

This is the **visual language** file. For component-level behavior see [COMPONENTS.md](COMPONENTS.md). For interaction, navigation, motion, and keyboard rules see [UX_RULES.md](UX_RULES.md).

## Installed Design Stack

- Build Web Apps: available through the OpenAI Build Web Apps plugin cache, including frontend review, React/Next.js, shadcn/ui, Stripe, and Supabase/Postgres guidance.
- Figma Design-to-Code: installed through the Figma plugin and local Figma skills; use it for implementation from Figma nodes and parity review.
- shadcn/ui: present as local Radix-based primitives in `src/components/ui`; prefer these before adding new primitives.
- Frontend Design: use the Build Web Apps `frontend-app-builder` skill and local `ui-ux-design-system` skill for premium product design direction.
- Context7: installed locally; use it for current framework, SDK, CLI, and library documentation before relying on memory.

## Product Personality

- Premium: deliberate density, precise alignment, and restrained color.
- Operational: default screens should help users scan, compare, decide, and act.
- Intelligent: agents, memory, graph context, and recommendations should feel contextual, not decorative.
- Calm: avoid noisy animation, exaggerated gradients, and marketing-page composition inside the app.
- High-trust: every status, action, and system state should be legible and auditable.

## Visual Style

- Dark-first SaaS OS with a stable command shell, compact navigation, and dense work surfaces.
- Use glass only for overlays, command surfaces, transient menus, and graph-adjacent panels where depth helps.
- Favor matte surfaces, quiet borders, small highlights, and functional accent color.
- Use full-width work areas and panels; reserve cards for repeated objects, metrics, modals, and framed tools.
- Keep corners at `8px` or less for core controls and cards unless an existing component already requires a larger radius.

## Color System

- Background: near-black shell `#08090b` and canvas `#0a0b0e`.
- Surfaces: shell `#0c0e12`, panel `#0e1014`, card `#101318`.
- Borders: default `#1c1f24`, card `#20242b`, active accent border at 35-50% primary opacity.
- Text: primary `#e8eaed`, secondary `#9ca3af`, muted `#6b7280`, disabled `#3a3f50`.
- Accent: current primary `#7c6cf6`; use sparingly for focus, selected nav, primary action, active graph relation, and key status.
- Danger: `#ef4444`; Warning: `#f59e0b`; Success: `#10b981`; Info: `#38bdf8`.
- Avoid one-note purple dominance. Pair the primary with neutral surfaces and status-specific colors.

## Typography

- Use system sans for UI chrome; use mono only for command hints, technical labels, IDs, telemetry, and compact status rows.
- Page titles: `20-28px`, `600-700`, tight line-height.
- Panel and card titles: `13-16px`, `600`, no negative letter spacing.
- Body text: `13-14px`, relaxed enough for scanning but not editorial.
- Metadata and labels: `10-12px`, medium weight, uppercase only for stable operational labels.
- Do not scale font size with viewport width. Make compact surfaces denser with spacing and layout, not tiny unreadable type.

## Layout

- App shell: persistent top command bar, left rail/sidebar, optional right panel, bottom status strip.
- Panels: use `16-24px` internal padding for larger panels, `12-16px` for dense operational sections.
- Main canvas: favor split operational surfaces such as chat plus graph, table plus detail, or workspace plus activity.

## Things To Avoid

- Generic AI SaaS look: oversized hero pages, vague value props, decorative AI badges, and filler metrics.
- Purple gradient overload, bokeh, decorative orbs, or neon grid backgrounds as default decoration.
- Nested cards, floating section cards, and marketing-layout composition inside the product.
- Vague copy such as "unlock insights" when a concrete action or state is available.
- Over-rounded controls, heavy shadows, and large glowing CTAs.
- Visible instructional text that describes obvious app functionality.

## Implementation Rules

- Before editing UI code, read this file, [COMPONENTS.md](COMPONENTS.md), [UX_RULES.md](UX_RULES.md), `package.json`, `src/app/globals.css`, existing layout components, relevant routes, and local UI primitives.
- Preserve the existing Next app architecture unless there is a clear product or technical reason to change it.
- Prefer Radix/shadcn primitives in `src/components/ui`, Tailwind tokens, `cn()`, lucide icons, and existing layout components.
- Add new design tokens before duplicating hard-coded colors across components.
- Validate important UI changes in browser screenshots at desktop and mobile sizes before final handoff.

## First Interface Improvements

1. Unify radius and surface tokens: several core surfaces use `rounded-xl` or `rounded-2xl` while the design direction calls for tighter OS chrome. Bring cards, composer, picker, and workspace tiles back toward `rounded-lg` or tokenized radii.
2. Reduce primary-purple saturation in shell actions: selected nav, quick action, command search focus, graph glow, and chat bubbles all lean on the same hue. Keep purple for active/focus states and introduce more neutral selected surfaces.
3. Standardize focus and tooltip behavior: some custom buttons rely on `title` only while others use Tooltip. Promote shared icon-button patterns with consistent focus rings and accessible labels.
4. Upgrade empty/loading/error states: chat and graph have basic states, but workspace cards, graph loading, API errors, and panels should preserve layout and offer clear next actions.
5. Consolidate surface primitives: `Card`, `WorkspaceCard`, inline workspace links, chat bubbles, and menus duplicate border/background/radius decisions. Create a small set of token-aligned variants before broad visual changes.
