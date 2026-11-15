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

## Visual Language: Night Watch

A sentinel keeps watch at night. Sentinel is where people and agents work together, and the one thing no other tool shows is what each agent is doing right now. The interface is built around that. The signature element is the **watch** (the live graph): agents stand at the centre as lights, ringed by the projects they serve, the work, and what is known. A working agent's light turns, and it casts a beam in its own colour onto whatever it is touching, with a short caption of what it is doing. Everything else stays quiet so that one element can carry the identity.

- Deep navy ground (a real hue, never tinted black), cool paper-white ink, hairline structure.
- **Signal yellow is the only signal colour.** It means "yours, right now": focus rings, the primary action, the dot beside the sidebar entry you are on, the edge of your own message, the ring on a pinned node.
- Entity colour is light and appears only where it encodes a type: rose agents, aqua projects, orange tasks, periwinkle memory. Each agent also has its own identity colour (`AGENT_TEMPLATES` in `src/lib/constants.ts`), used for its light, beam, name dot and roundtable turns.
- **Surfaces are solid.** No translucency, no backdrop blur, no glow as decoration. The only light in the product is an agent's beam, and it means that agent is working on that thing.
- Selected state = raised surface plus the signal dot or edge, never a filled yellow block. Filled yellow is reserved for the one primary action on a screen.
- Corners: 6/10/16px (`--radius-sm/md/lg`). Controls 10px, cards and panels 16px, primary actions and chips fully round.

## Color Tokens (src/app/globals.css)

- Ground → raised: `--sidebar #0a0e1f`, `--canvas #080b19` (the graph's open water, darkest), `--background #0d1226`, `--panel #121832`, `--card #161d3b`, `--muted #1c2447`, `--accent #252e58`.
- Lines: `--border #232b52`, `--border-strong #37427a`.
- Ink: `--foreground #eef0fa`, `--muted-foreground #a3abcf` (AA on every surface), `--text-faint #7781ad` (non-essential metadata only).
- Signal: `--primary #ffd23f`, `--primary-soft #ffe07a`, `--primary-foreground #1b1600`, `--primary-wash`, `--ring #ffe07a`.
- Entities: `--entity-agent #ff7aa8`, `--entity-project #45d6c2`, `--entity-task #ff9f5a`, `--entity-memory #8fa4ff` (+ workspace, knowledge, tool, source, external, conversation).
- Status: `--status-online #4ade9a`, `--status-busy #ffb347`, `--status-error #ff6b7a`, `--status-idle`.
- `--glass*` tokens still exist because many components read them; they now resolve to solid surfaces.
- Tailwind's violet/indigo/purple/sky/cyan/slate scales are remapped in `@theme` so legacy screens retint into Night Watch. New code uses the semantic tokens, written in Tailwind v4 syntax: `bg-(--card)`, never `bg-[--card]` (v3 syntax compiles to invalid CSS in v4).

## Typography

- **Onest** (`font-sans`) for all interface text.
- **Familjen Grotesk** (`font-display`) for page, panel and empty-state titles only. Every `h1` inside `main` gets it by default.
- **Martian Mono** (`font-mono`) for ids, model names, counts and telemetry only, never for labels.
- Labels are sentence case. No tracked-out uppercase eyebrows.
- Body 13–15px; message prose 14.5px/1.65; metadata never below 11px.

## Layout

- One shell for every route: a 216px labelled sidebar (desktop, `lg` and up) or a navigation sheet (below `lg`), one 56px top bar that carries the surface's own controls, and the work surface. Sidebar groups are Work, Watch, Run and Team; a project guest sees only the entries they can reach.
- Chat is a split view: the conversation on the left, the watch on the right, and the activity column beside it at `xl`. Both are solid panes; nothing is layered over the graph. "Focus" hides the graph and centres the conversation. On phones the watch is a 210px band above the conversation.
- People, Projects and Roundtable use a reading column with the form for the screen's main action (invite, create, start) in a panel on the right at `xl`, below the content otherwise.
- A room that belongs to a project shows the project's name in its header and, for people who can run agents, a control to choose between asking the agent and telling the room.

## The watch (src/components/watch)

- `watch-model.ts` is the layout: a pure function of the graph and of where the agents stand. The same graph always draws the same picture.
- `watch-renderer.ts` draws it. A beam is cast only when `dispatch` reports a real event; a light turns only while the caller says that agent is working. Nothing is animated to look busy.
- `useWatch.ts` derives agents, captions and events from the activity feed for every surface that shows the watch.
- Captions are real DOM text, so they are readable by assistive tech; the canvas carries a full text summary in its `aria-label`.
- Reduced motion: lights do not turn and nothing travels along a beam; beams, heat and captions still appear because they are information.

## Things To Avoid

- Generic AI SaaS look: oversized hero pages, vague value props, decorative AI badges, and filler metrics.
- Gradient washes, bokeh, decorative orbs, glow, frosted glass, or neon grid backgrounds as decoration.
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
