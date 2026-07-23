# Production Workflow Verification — Phase 3 (in progress)

Follow-up to `docs/reviews/POST_CODEX_REVIEW.md`, which reviewed the PR #13/#14 diffs but explicitly deferred manual workflow verification. This document is that verification, done incrementally — it covers **Mission Control** and **Organization** only. Chat, Knowledge/Neural Lens, Agents, Settings, viewport QA, workspace features, and voice remain unverified and are not claimed here.

**Method:** real dev server (`npm run dev`) against a scratch Postgres, a real registered user (`/api/auth/register` + credentials sign-in, not a mock session), driven with Playwright against the actual rendered app — not code reading, not assumptions from the diff.

## Mission Control

- **Empty state (no data):** signed in as a brand-new user with zero workspaces/agents/projects. Every card rendered an honest empty state with an explicit source label — "Queue cleared", "No recent project activity · Source: PostgreSQL", System Health `UNAVAILABLE` with `SENTINEL_TELEMETRY_URL is not configured` per row, all summary counts `0`. No fabricated numbers, no placeholder agents. The top banner ("Source status is explicit...") appeared correctly because the `agents` telemetry source was `unavailable`.
- **Live state (real data):** created a real `Workspace` (owned by the test user), `Agent`, and pending `ApprovalRequest` directly in Postgres. Reloading Mission Control showed the real approval row ("Deploy to production", severity `HIGH`, owner "Review Agent") in the Attention Queue, and the summary counts updated to reflect it (`Pending decisions: 1`, `Active agents: 1`).
- **Approve action — genuinely persists:** clicked Approve in the browser. Confirmed via network trace: `PATCH /api/approvals/:id` → `200`. The Attention Queue cleared client-side, "Recent events" incremented, and — critically — **a full page reload still showed the queue cleared** (`db.approvalRequest.status` was `"approved"` in Postgres, not just optimistically flipped client-side). This is real confirmed-by-server behavior, not the old fake `setTimeout` success.
- One false alarm in my own test process, worth recording so it isn't mistaken for a product bug: the Attention Queue renders both a `md:hidden` mobile list and a desktop table with duplicate `aria-label="approve ..."` buttons for the same row. A naive `.first()` locator grabs the CSS-hidden mobile copy. Real users on a real viewport never hit this — only an automated script picking the wrong DOM match would. Not a defect, just a note for anyone else scripting against this page.

## Organization

- **No hardcoded org on load:** a fresh workspace's chart loaded with `0 nodes, 0 connections` — confirms the earlier fix (no more "Rusty Johnson — CEO" fake org) holds in a live browser, not just in the diff.
- **Add node → Save → reload persistence:** added a "Person" node via the toolbar, clicked "Save changes" — confirmed `PUT /api/org` → `200` over the network. Reloaded the page from scratch: the node was still there, loaded from the server. Real persistence, not `localStorage`-only.
- Right panel's "Recent Activity" and "Agent Registry" tabs, visited from the Organization page, correctly showed the real `approval.approved` audit events and the real "Review Agent — Online" — confirms the earlier `RightPanel.tsx` fix (no more hardcoded "Hermes Lisa — Analyzed project requirements" feed) holds live as well.

## Minor finding (not fixed, low priority)

Attention Queue's "SOURCE" column displays the raw workspace `id` (a cuid, e.g. `cmrx4dio800017dukenq0pvgl`) instead of a human-readable workspace/project name. Not a correctness or honesty defect — it's a real value, just not resolved to a friendly label. Cosmetic; left for a future pass.

## Not yet verified

Chat (room creation, streaming, cancellation, persistence, provenance), Knowledge Graph / Neural Lens (live graph, timeline replay, learning queue, candidate review), Agents (restart, config files, logs, permissions), Settings (which controls persist vs. are decorative), viewport/accessibility QA across the five specified breakpoints, workspace feature builds (Marketing, AI Studio, Cybersecurity), and voice architecture review are all still open from the original brief's Phases 3–8.
