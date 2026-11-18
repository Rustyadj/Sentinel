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

## Visual Language: Mist

Daylight on a working floor. Sentinel is where people and agents work together, and the one thing no other tool shows is what each agent is doing right now. The signature element is the **watch** (the live graph): agents at the centre, ringed by the projects they serve, the work, and what is known, drawn on a pale dot field. Panels are paper cards that float over that field.

- Pale sage ground, near-white paper panels, deep green-black ink, hairline structure, a soft lift (`--shadow-md`) on floating panels.
- **Petrol teal is the only signal colour.** It means "yours, right now": focus rings, the primary action, the icon of the tab you are on, the ring on a pinned node.
- Agents are blue, people are ink. Entity colour appears only where it encodes a type. Each agent's own identity colour is mixed 40% toward the ink for display (`deepenForPaper` in `src/components/watch/useWatch.ts`), because stored colours were chosen against a dark ground.
- Selected state = a raised paper tab with a hairline border. Filled teal is reserved for the one primary action on a screen.
- Corners: 6/8/14px (`--radius-sm/md/lg`). Controls 8px, floating panels 14px.
- The memory star-globe (neural lens) is drawn for a night sky; it and its overlays keep the old Night Watch palette through the `.theme-night` class.

## Color Tokens (src/app/globals.css)

- Surfaces: `--canvas #dde1dc` (the graph's floor, deepest), `--background`/`--sidebar #e6e9e5` (chrome), `--muted #eef0ec`, `--panel`/`--card #f6f7f4` (paper), `--field #ffffff` (inputs).
- Lines: `--border #cfd5ce`, `--border-strong #b3bcb4`.
- Ink: `--foreground #1a2321`, `--muted-foreground #4f5b57`, `--text-faint #5f6b66`.
- Signal: `--primary #17605c`, `--primary-soft #1d7560`, `--primary-foreground #f3f7f5`, `--primary-wash`, `--ring #17605c`.
- Entities: `--entity-agent #2c57a3`, `--entity-project #1d7560`, `--entity-task #96650f`, `--entity-memory #5f7396` (+ workspace, knowledge, tool, source, external, conversation).
- Status: `--status-online #23805a`, `--status-busy #96650f`, `--status-error #a8362b`, `--status-idle #8d9a94`.
- Legacy dark-ground classes are retinted, not rewritten: Tailwind's violet/indigo/purple/sky/cyan/slate scales are inverted (50 is darkest) and remapped in `@theme`, the light status shades are pulled down to ones that pass on paper, and `white` points at the ink (`--white-ink`) so `text-white`/`bg-white/5` keep meaning "ink"/"a little raised". Solid fills put light text back for themselves. New code uses the semantic tokens, in Tailwind v4 syntax: `bg-(--card)`, never `bg-[--card]`.

## Typography

- **Hanken Grotesk** (`font-sans`) for all interface text.
- **Bricolage Grotesque** (`font-display`) for page, panel and empty-state titles only. Every `h1` inside `main` gets it by default.
- **JetBrains Mono** (`font-mono`) for ids, times, model names, counts and telemetry only, never for labels.
- Labels are sentence case. No tracked-out uppercase eyebrows.
- Body 13–15px; message prose 14.5px/1.65; metadata never below 11px.

## Layout

- One shell for every route: a 56px top bar with the mark, the primary view tabs (groups Work, Watch, Run, Team, then Settings, split by hairlines; below `2xl` only the current tab shows its label), search and the operator's queues. Below `lg` the tabs move into a navigation sheet. A screen's own title and controls sit on a slim second row under it. A project guest sees only the tabs they can reach.
- Chat is a split view: the conversation on the left, the watch on the right, and the activity column floating over the watch at `xl`. "Focus" hides the graph and centres the conversation. On phones the watch is a 210px band above the conversation.
- People, Projects and Roundtable use a reading column with the form for the screen's main action (invite, create, start) in a panel on the right at `xl`, below the content otherwise.
- A room that belongs to a project shows the project's name in its header and, for people who can run agents, a control to choose between asking the agent and telling the room.

## The watch (src/components/watch)

- `watch-model.ts` is the layout: a pure function of the graph and of where the agents stand. The same graph always draws the same picture.
- `watch-renderer.ts` draws it. A beam is cast only when `dispatch` reports a real event; a light turns only while the caller says that agent is working. Nothing is animated to look busy.
- `watch-motion.ts` is the ambient layer: every node drifts a few pixels around its seat on a slow, id-seeded path (24–60 s), the chart breathes by under 1%, and a dragged node pulls its neighbours a little and springs back when released. Drift is never information: it is too small and too slow to read as a beam, ripple or turning light, and the seat itself never moves.
- `useWatch.ts` derives agents, captions and events from the activity feed for every surface that shows the watch.
- Captions are real DOM text, so they are readable by assistive tech; the canvas carries a full text summary in its `aria-label`.
- Reduced motion: lights do not turn, nothing travels along a beam, nothing drifts, and a dropped node returns at once; beams, heat and captions still appear because they are information.

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
