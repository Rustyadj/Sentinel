# Sentinel OS Interaction & UX Rules

Interaction rules, navigation, animation, keyboard shortcuts, hover behavior, and empty/loading/error state handling. Visual tokens live in [DESIGN.md](DESIGN.md); per-component specs live in [COMPONENTS.md](COMPONENTS.md).

## Interaction States

- Hover: subtle border and surface changes only — never large jumps, scale transforms, or dramatic glow.
- Focus: every keyboard-reachable control shows a visible `--ring` outline; focus rings must stay visible against dark surfaces.
- Active/selected: stronger surface + accent border, not a full accent fill (reserve fill for primary buttons).
- Disabled: visible disabled affordance (reduced opacity, no pointer cursor) plus a tooltip when the reason isn't self-evident.

## Empty States

- State what is missing in plain terms, then offer the concrete next operational action (a button, not just prose).
- Preserve the surrounding frame (table header, panel padding, graph canvas size) — an empty state never collapses layout.
- Avoid generic illustrations or marketing tone; keep copy operational ("No agents assigned yet — invite one" not "It's quiet here").

## Loading States

- Preserve layout dimensions with skeletons, inline spinners, or subdued loading rows — content must not jump when data arrives.
- Use per-region loading (a panel, a table, a graph) rather than full-page blocking spinners whenever partial content is already known.
- Button-level loading keeps the button's width and label position stable (see [COMPONENTS.md](COMPONENTS.md#button)).

## Error States

- Identify what failed in specific terms tied to the action attempted, not a generic "Something went wrong."
- Preserve user input (form values, in-progress edits) across an error — never clear the field on failure.
- Always provide a retry or recovery action inline with the error, not only in a toast that disappears.
- Network/API errors surface at the scope of the failed region (a panel, a table) rather than replacing the whole screen when unrelated content is still valid.

## Navigation

- Persistent shell: top command bar, left sidebar, optional right panel, bottom status strip — this shell never disappears during normal navigation.
- Command search (palette) is the primary navigation accelerator; every major destination and action must be reachable through it, not only through clicking.
- Back/forward browser navigation must reflect in-app state (selected workspace, open panel) via URL, not be a dead end.
- Right panel is contextual (detail, chat, activity) and opens/closes without disturbing the left sidebar or main canvas scroll position.

## Keyboard Shortcuts

- Command palette: `Cmd/Ctrl+K` opens from anywhere in the app.
- `Esc` closes the topmost overlay (modal, palette, menu) and returns focus to its trigger.
- Arrow keys navigate lists, tables, and palette results; `Enter` activates the focused/selected item.
- Every icon-only action reachable by mouse must also be reachable by keyboard (tab order + Enter/Space activation).
- Do not bind single-letter global shortcuts that collide with typing in an open input/textarea — scope shortcuts to when no text field has focus.

## Hover Behavior

- Row-level and card-level quick actions are hidden at rest and revealed on hover/focus (not on click) to keep dense surfaces (tables, sidebar, lists) visually calm.
- Tooltips appear after a short delay (~400ms) on hover and immediately on keyboard focus.
- Hover never triggers navigation or data mutation by itself — it only reveals affordances.

## Motion

- Motion must be functional: opening, selection, loading, streaming, graph updates, and lightweight feedback — never ornamental.
- Default duration: `120-220ms`; ease-out for entrance and color transitions, ease-in for exits.
- Respect `prefers-reduced-motion` for graph pulses, animated backgrounds, and any repeating/continuous motion; discrete state-change transitions (select, focus, error shake) can remain since they carry information.
- Avoid distracting loops, large parallax, bouncing, or ornamental animation anywhere in the product surface.

## Accessibility

- Maintain WCAG AA contrast for text and essential controls.
- Every icon-only action needs an accessible name and, where helpful, a visible tooltip.
- Keyboard navigation must reach nav, command search, tabs, forms, menus, modals, and graph controls end to end.
- Do not rely on color alone for health, danger, approval, or progress — pair with icon, text, or pattern.
- Compact density is acceptable only when text remains readable and touch/click targets remain usable (minimum ~32px hit area for icon buttons).
