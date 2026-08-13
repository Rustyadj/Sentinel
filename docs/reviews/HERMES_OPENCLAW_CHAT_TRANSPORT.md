# Hermes / OpenClaw Chat Transport Audit

Live audit against `hermes-lisa` and `openclaw-cash-cash-1` on `srv1427612.hstgr.cloud`, 2026-08-11. Source inspected directly inside the running containers (`docker exec ... cat`), not guessed from docs.

## Hermes Lisa — VERIFIED

Real product: "Hermes Agent" v0.18.0, FastAPI/uvicorn on port 4862 (the `hermes-lisa` Traefik service), built on a `tui_gateway` JSON-RPC core shared with its Ink TUI (same `dispatch()` function drives both stdio and WebSocket clients).

**Auth**: `POST /api/auth/ws-ticket` → single-use, 30s-TTL ticket. Append as `?ticket=<value>` to `/api/ws` (also gates `/api/pty`, `/api/pub`, `/api/events`). Ticket auth is the SPA path; a legacy `?token=<HERMES_DASHBOARD_SESSION_TOKEN>` form also exists server-side but the ticket flow is what the real dashboard uses.

**Transport**: `ws://<host>:4862/api/ws?ticket=...`. Newline-delimited JSON-RPC 2.0, both directions. Server sends `{"jsonrpc":"2.0","method":"event","params":{"type":"gateway.ready","payload":{"skin":...}}}` immediately after accept.

**RPC methods that matter** (from `@method(...)` registrations in `tui_gateway/server.py`, 13.7k lines):
- `session.create(params: {cols?, messages?, title?, parent_session_id?, cwd?, source?, profile?, model?, provider?, reasoning_effort?, fast?})` → `{session_id, stored_session_id, message_count, messages, info:{model, tools, skills, cwd, branch, ...}}`. Session is created lazily/cheap; the real DB row and agent build happen on first prompt.
- `prompt.submit(params: {session_id, text, truncate_before_user_ordinal?})` → immediate ack `{"status":"streaming"}`; the actual reply streams as `event` notifications on the same socket (see below). Sending mid-turn queues/interrupts rather than rejecting.
- `session.interrupt` — cancel a live turn.
- `session.resume`, `session.close`, `session.status`, `session.history`, `session.usage`, `session.list`.
- `approval.respond`, `clarify.respond`, `sudo.respond`, `secret.respond`, `terminal.read.respond` — reply frames for interactive tool/approval flows.

**Event taxonomy** (from `_emit(...)` call sites): `message.start`, `message.delta` (streamed, coalesced ~30fps), `message.complete`, `reasoning.available`, `reasoning.delta`, `thinking.delta`, `tool.start`, `tool.generating`, `tool.complete`, `status.update`, `error`, `approval.request`, `session.info`. `message.delta`/`reasoning.delta`/`thinking.delta` are the only high-frequency ones — everything else is single-shot and flush-ordered ahead of buffered tokens.

**Resume/cancel**: both genuinely supported (`session.resume`, `session.interrupt` are real RPCs, not emulated).

## OpenClaw Cash — HISTORICAL 2026-08-11 SNAPSHOT

> Update (2026-08-12): the native gateway on port 18789 has since been
> recovered and verified. Sentinel now connects directly to that WebSocket/RPC
> gateway. The observations below explain why the former `/chat` HTTP path was
> rejected, but they no longer describe the gateway's current running state.

Two Node processes only, confirmed via `ps aux` in the container — no third process anywhere:
1. `server.mjs` (port 50348, public via `cash.srv1427612.hstgr.cloud`) — a memory/pgvector-augmentation proxy. Intercepts `/memory*` and `/api/memory/*` for real DB-backed reads/writes, otherwise forwards everything (HTTP and WS upgrades) to `server-core.mjs` on port 50349.
2. `server-core.mjs` (port 50349, internal only) — a minified Express "command-center" app.

**`POST /chat` and `POST /chat/send` are a confirmed mock.** Source (deminified):
```js
text: `${a} received: ${i}. Backend route is live; connect this handler to
OpenClaw session streaming for provider-generated responses.`
```
It literally echoes the input back inside a canned sentence, persists it to a local JSON file (`command-center-api.json`), and — if the client sends `Accept: text/event-stream` — streams that same fake sentence word-by-word as `data: {"delta":...}` SSE frames, ending with `data: {"done":true,"message":...}`. This is the vendor's own placeholder, not a bug I'm introducing by calling it fake.

**`POST /terminal/run`** — raw `execSync`/`exec` passthrough. Already correctly excluded as a chat substitute in the current adapter.

**The real path exists in source but is not running.** `server-core.mjs` proxies (HTTP via `http-proxy-middleware`, WS via raw pass-through with the same socket, `Authorization: Bearer ${OPENCLAW_GATEWAY_TOKEN}` injected) to `http://127.0.0.1:18789` — a separate inner gateway. That gateway's config (visible in the same bundle) has genuine multi-provider wiring: real Anthropic OAuth token read from `/tmp/claude-auth.json`, model catalog including `claude-opus-4-6`, `claude-sonnet-4-6`, `claude-haiku-4-5`, GPT-5.5, Gemini, Grok. This is clearly the real chat engine. **But nothing listens on `18789`** — confirmed via `/proc/net/tcp` inside the container and a direct `curl` from inside it (connection refused). No third Node process is running to serve it.

`/ws/hub` is a separate pub/sub channel for live UI updates (agents/memory/workflows changed — `hubBroadcast`), not a chat transport; irrelevant to this task.

## Verdict

- **Hermes**: fully buildable now. Everything needed (auth, WS URL, RPC methods, event schema, cancel/resume) is verified from source, not inferred.
- **OpenClaw (at audit time)**: only the hardcoded HTTP stub was reachable.
  That finding led to recovery and live verification of the real port-18789
  gateway before Sentinel's native adapter was implemented.
