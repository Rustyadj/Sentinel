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

## Visual Language: Strata

Sentinel's knowledge is layered — agents act for projects, projects hold tasks, and everything rests on memory. The interface takes that literally. The signature element is the **Strata graph** behind Chat: four translucent planes stacked in shallow perspective (Agents, Projects, Tasks, Memory), real graph nodes seated on their plane, threads dropping between them. Everything else stays quiet so that one element can carry the identity.

- Dark lacquer ground with a petrol cast, bone-white ink, hairline structure. No glow, no gradients as decoration.
- **Brass is the only signal colour.** It means "yours, right now": focus rings, the primary action, the selected rail entry's edge, the active tab underline, the user's own message edge, the context column in the graph.
- Entity colour is mineral pigment and appears only where it encodes a type: lapis agents, verdigris projects, cinnabar tasks, amethyst memory.
- Selected state = raised surface + brass edge, never a filled pill.
- Translucency only for surfaces that stand in front of the graph (conversation panel, activity panel, graph controls). Everything else is solid.
- Corners: 4/6/10px (`--radius-sm/md/lg`). Controls and cards use 6px; floating panels 10px.

## Color Tokens (src/app/globals.css)

- Ground → raised: `--sidebar #0a0f11`, `--canvas #0b1012`, `--background #0e1416`, `--panel #121a1d`, `--card #151e21`, `--muted #1b2629`, `--accent #213034`.
- Lines: `--border #243134`, `--border-strong #33454a`.
- Ink: `--foreground #ebe6da`, `--muted-foreground #9aa5a3` (AA on every surface), `--text-faint #6f7c7b` (non-essential metadata only).
- Signal: `--primary #d4a95a`, `--primary-soft #e6c486`, `--primary-foreground #1c1508`, `--ring #e0b768`.
- Entities: `--entity-agent`, `--entity-project`, `--entity-task`, `--entity-memory` (+ workspace, knowledge, tool, source, external, conversation aliases).
- Status: `--status-online #5fcf9a`, `--status-busy #e8b04a`, `--status-error #ef6b5e`, `--status-idle`.
- Tailwind's violet/indigo/purple/sky/cyan/slate scales are remapped in `@theme` so legacy screens retint into Strata. New code uses the semantic tokens, written in Tailwind v4 syntax: `bg-(--card)`, never `bg-[--card]` (v3 syntax compiles to invalid CSS in v4).

## Typography

- **Hanken Grotesk** (`font-sans`) for all interface text.
- **Bricolage Grotesque** (`font-display`) for page, panel and empty-state titles only. Every `h1` inside `main` gets it by default.
- **JetBrains Mono** (`font-mono`) for ids, model names, counts and telemetry only — never for labels.
- Labels are sentence case. No tracked-out uppercase eyebrows.
- Body 13–15px; message prose 14.5px/1.65; metadata never below 11px.

## Layout

- One shell for every route: the 80px rail (desktop) or navigation sheet (mobile), one 56px top bar that carries the surface's own controls (or a module's section tabs), and the work surface.
- Chat: the conversation panel stands at the left; the Strata graph centres in the space to its right and slides under the panel's edge, so the panel reads as being in front. On phones the graph becomes a 168px band above the conversation.
- Module screens: section tabs live in the top bar; the context panel is opt-in via the "Context" toggle.

## Things To Avoid

- Generic AI SaaS look: oversized hero pages, vague value props, decorative AI badges, and filler metrics.
- Gradient washes, bokeh, decorative orbs, glow, or neon grid backgrounds as decoration.
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
