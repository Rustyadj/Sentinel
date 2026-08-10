# Sentinel OS Component Rules

Exactly how every component should behave. Visual tokens live in [DESIGN.md](DESIGN.md); interaction/motion/keyboard rules live in [UX_RULES.md](UX_RULES.md). Prefer the Radix/shadcn primitives already in `src/components/ui` (`button.tsx`, `card.tsx`, `input.tsx`, `badge.tsx`, `tabs.tsx`, `tooltip.tsx`, `avatar.tsx`, `progress.tsx`, `scroll-area.tsx`, `separator.tsx`) before adding a new one.

## Button

- Variants: `primary` (one per local context — the single main action), `secondary`, `ghost`, `destructive`, `icon`.
- Primary is the only variant that carries the accent fill; everything else stays neutral/matte.
- Icon-only buttons always require an accessible name (`aria-label`) and a visible `Tooltip` — `title` alone is not sufficient.
- Disabled buttons keep a visible disabled affordance (reduced opacity + `cursor-not-allowed`) and retain a tooltip when the disabled reason isn't obvious from context.
- Loading buttons keep their width, swap label for a spinner or keep the label and add a leading spinner — never collapse to a bare spinner that shifts layout.
- Destructive actions (delete workspace, remove agent, revoke access) always confirm via a modal before firing; never fire a destructive action directly from a button click.

## Modal

- Focused, narrow, and task-specific. One task per modal — never stack multiple unrelated decisions or multiple cards inside one modal.
- Opens centered with a scrim; scrim click and `Esc` both dismiss unless the modal represents a destructive confirmation or unsaved-work state, in which case `Esc` still closes but the primary action requires explicit click.
- Title states the task as an action ("Delete workspace", not "Workspace"). Primary action button uses the same verb as the title.
- Focus moves to the first actionable element on open and returns to the trigger element on close.
- Forms inside modals validate inline; do not close the modal on a failed submit — keep entered data and surface the field-level error.

## Sidebar

- Persistent left rail; icons must stay legible when collapsed. Expanded state adds labels and lightweight status (unread count, active indicator).
- Active/selected item uses a stronger surface + accent border, never accent fill across the whole row.
- Collapse/expand state persists per user across sessions.
- Sections (workspaces, agents, memory) are visually separated with quiet dividers, not nested cards.
- Hover reveals row-level quick actions (icon buttons) that are otherwise hidden to keep the rail calm at rest.

## Table

- Compact rows, sticky header on scroll, monospace for IDs/telemetry columns, sans for everything else.
- Row hover: subtle surface change only. Row selected: stronger surface + left accent border, not a full-row fill.
- Sortable columns show a static sort indicator only on the active column; hover reveals sortability on others.
- Empty, loading, and error states render inside the table's existing frame (same header, same column widths) — never collapse to a centered blank message that discards layout.
- Row actions live in a trailing icon-button cluster revealed on hover/focus, mirroring the sidebar row pattern.

## Card

- Reserved for repeated objects (workspace tiles, agent cards, metric tiles) — never used as a generic content wrapper or for page sections.
- No nested cards. If a card needs internal grouping, use spacing and dividers, not a card-in-card.
- Repeated cards in a grid/list share identical spacing, radius, border, and hover behavior — define one variant and reuse it, don't hand-roll per screen.
- Hover: quiet lift via border/surface change, never shadow-heavy elevation or scale transforms.
- Card click targets are the whole card when the card has one primary destination; use explicit inline actions when a card exposes multiple actions, so the whole-card click and inline actions never conflict.

## Form

- Labels are always visible and persistent (no placeholder-as-label). Placeholder text shows format hints only.
- Every input has a visible focus ring (`--ring` token) and inline validation that appears on blur, not on every keystroke.
- Required fields are marked consistently (not a bare asterisk with no legend on first use per screen).
- Submit buttons disable during submission and show inline loading, not a full-form overlay, so entered values remain visible.
- Field-level errors sit directly under the field, state what's wrong and how to fix it, and preserve the user's entered value.
- Multi-step forms show step position (e.g. "Step 2 of 4") and keep prior steps' data intact when navigating back.

## Graph

- Muted default node/edge styling; reserve saturated accent color for selected node, active relation, and hover state only.
- Loading state preserves canvas dimensions (skeleton or centered spinner within the existing frame), never a layout-shifting placeholder.
- Empty state explains what would populate the graph and offers the action that creates the first node/relation.
- Zoom/pan controls are always visible, not hover-only, since graph navigation is a primary task.
- Respect `prefers-reduced-motion`: disable graph pulse/particle animation and any continuous motion; keep discrete transitions (node select, edge highlight) since those carry information.

### The canonical graph (Neural Lens globe)

There is one Sentinel graph, rendered as a globe. Everything below follows from that; treat these as invariants, not styling preferences.

- **Fixed positions.** `computeGlobeLayout` assigns every node a coordinate as a pure function of its id, cluster, and hub. Nothing re-lays-out at runtime — not on lens change, not on filter, not on data refresh. A region keeps the same patch of the globe across sessions, which is what makes spatial memory possible.
- **Regions.** Each cluster (`ClusterId`) owns a cap of the shell; the core cluster (Agents) is a dense ball at the centre. Region names are presentation (`CLUSTER_LABEL`); `ClusterId` stays the key that layout, routes, and persisted state use.
- **Lens = emphasis.** Selecting a layer lights it and dims the rest. Full Graph keeps everything present; Lens Only hides all but the layer and its direct dependencies. Neither reloads, re-clusters, or moves anything.
- **Density is deterministic.** The Visual Density control keeps the lowest-`densityRank` fraction of the dust field. Lowering it always removes the same dots and raising it brings the same ones back — the field thins, it never reshuffles.
- **Four draw calls.** Dust, edges, hub bloom, focus bloom. Drift, activity pulse, depth fog, and active-path traversal are computed per-vertex from one `uTime` uniform; the CPU only rewrites buffers when the operator changes something (selection, lens, density). Hover updates only the edges it touches.
- **Text is DOM.** Region names, the selection frame, and the hover readout are projected each frame and written to element refs, never re-rendered through React per frame.

## Command Palette

- Global keyboard-first entry point (see [UX_RULES.md](UX_RULES.md) for the shortcut). Opens as a centered overlay over a scrim, never inline in the top bar.
- Results grouped by type (commands, workspaces, agents, memory, people) with group labels, ranked by relevance then recency.
- Selected result always has a visible highlighted row; arrow keys move selection, `Enter` executes, `Esc` closes.
- Empty query shows recent/frequent commands, not a blank state — the palette should never open to nothing actionable.
- No-results state suggests the closest matches or a fallback action (e.g. "search full workspace") rather than a bare "no results."

## Workspace (tiles / cards / detail)

- Workspace tiles follow the Card rules above: shared spacing/radius/hover, no nesting.
- Tile surfaces status (active, archived, needs attention) via badge + color, never color alone.
- Detail view keeps the same information hierarchy as the tile it was opened from (title, status, key metadata) so the transition feels continuous, not like a different object.
- Bulk actions on workspace lists appear only once a selection exists (checkbox-driven), and the action bar is sticky, not buried in a menu.
