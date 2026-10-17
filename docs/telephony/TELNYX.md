# Telnyx telephony — native phone capability for Lisa and Nathan2

The existing Hermes agents place and answer calls and texts themselves. There
is no separate calling assistant: the voice on the phone is GPT-Live-1 acting
as the *mouth* of the same agent, and every substantive turn is delegated back
to that agent's own runtime (memory, tools, permissions, audit) — the same
split as browser voice ([GPT_LIVE_ARCHITECTURE.md](../voice/GPT_LIVE_ARCHITECTURE.md)).

## Architecture

```
                         ┌──────────────── app (Next.js) ────────────────┐
 Telnyx ── webhook ────▶ │ /api/telephony/telnyx/webhook  (Ed25519 verify)│
 (events, SMS/MMS)       │   → call screening, SMS → agent, hangup state  │
                         │ /api/telephony/calls|messages|contacts|status  │
 Dialer UI /phone ─────▶ │ MCP: place_call · send_sms · call_history      │
 Hermes agents (MCP) ──▶ │ /api/telephony/turn  ◀── bridge secret ──┐     │
                         └──────────────────────────────────────────┼─────┘
                                                                    │ one agent turn
 Telnyx ══ wss /telephony/media?t=<HMAC> ══▶  telnyx-bridge ────────┘
 (PCMU 8 kHz, bidirectional)                   per-call CallBridge
                                                 ⇅ μ-law passthrough (no transcoding)
                                               GPT-Live-1  wss://api.openai.com/v1/live/sessions
                                               (client delegation, agent's voice)
```

* **Outbound**: `POST /api/telephony/calls` or MCP `sentinel.place_call`
  resolve the contact, apply policy, write a `PhoneCall` row, then `POST /v2/calls`
  with `stream_url` + bidirectional PCMU. Telnyx connects the media socket on
  answer. No confirmation step — asking is the authorization.
* **Inbound**: `call.initiated` → capacity check → trusted number: full agent;
  unknown number: **screened** (message-taking only, no runtime/tool/memory
  access) or rejected (`TELNYX_UNKNOWN_CALLERS=reject`). Answered with streaming.
* **Turns**: GPT-Live emits `session.delegation.created`; the bridge rebuilds the
  utterance from transcript fragments, POSTs it to `/api/telephony/turn`, and
  speaks the answer via `session.commentary.append`. A newer caller utterance
  aborts the pending turn (barge-in), and Telnyx's playout queue is flushed
  with `{"event":"clear"}`.
* **Memory**: calls run in a per-user "Phone" `ChatRoom`, so call turns use the
  same history/memory path as typed chat. At hang-up the agent writes its own
  summary from the stored transcript. `sentinel.call_history` lets any agent
  answer "what did John say yesterday?" from recorded data only.
* **SMS/MMS**: inbound texts from trusted numbers go to the agent in the Phone
  room and the reply is sent back; unknown senders are stored, never answered.
  Delivery receipts update `PhoneMessage.status`.

## Files

| Area | Path |
|---|---|
| Telnyx REST, config, signature, events, webhook handler | `src/lib/telephony/telnyx/` |
| Call lifecycle, policy, contacts, messaging, media token, summary | `src/lib/telephony/calls/` |
| GPT-Live client, per-call bridge, bridge server, app client | `src/lib/telephony/bridge/` |
| Agent tools (MCP) | `src/lib/telephony/mcp-tools.ts` |
| Routes | `src/app/api/telephony/**` |
| Bridge process | `src/workers/telnyx-bridge.ts`, compose service `telnyx-bridge` |
| UI | `src/app/phone`, `src/modules/phone` |
| Schema | `prisma/migrations/20261011120000_telephony` |
| Ingress | `deploy/traefik/sentinel.yml` (`sentinel-telnyx-media`) |

## Configuration

All variables are documented in `.env.example`. Production secrets belong in
the VPS environment file (`/etc/hermes-telnyx.env`), supplied to Compose; none
are in the repository. The bridge also needs `OPENAI_API_KEY`.

### Telnyx portal actions (cannot be done from code)

1. **Call Control application** (Voice → Programmable Voice): webhook API v2,
   URL `https://<host>/api/telephony/telnyx/webhook`. Its id is
   `TELNYX_CONNECTION_ID`.
2. **Assign the number** to that application *and* to a **Messaging Profile**
   (same webhook URL; enable MMS).
3. **Public key** (Account → Keys & Credentials) → `TELNYX_PUBLIC_KEY`.
4. **Outbound voice profile**: restrict destinations to the countries in
   `TELNYX_ALLOWED_COUNTRY_CODES`, set caller ID to the line.
5. **US SMS**: 10DLC brand/campaign registration (or toll-free verification)
   is required by carriers before texts are reliably delivered.
6. Secrets: `openssl rand -base64 48` for `TELNYX_MEDIA_TOKEN_SECRET` and
   `TELNYX_BRIDGE_SECRET`. **Rotate any API key that has been pasted into a
   chat or ticket.**
7. Reverse proxy: install the updated `deploy/traefik/sentinel.yml`
   (`/telephony/media` → `127.0.0.1:4870`), then `docker compose up -d telnyx-bridge`.

### Voices

Voices are the ones already configured and live-verified for the agents:
Lisa → `gleam` (feminine), Nathan2 → `meridian` (masculine), model
`gpt-live-1`. `sol` and `spruce` are **not** in OpenAI's published GPT-Live
voice list, so they were not adopted. Override per agent with
`SENTINEL_VOICE_HERMES_LISA_VOICE` / `…NATHAN2_VOICE` only after confirming the
voice against `POST /v1/live/sessions`. Nathan2's reasoning model is configured as
`gpt-5.6-luna` (not "GPT-5.6"); this was left as configured.

## Security model

* Webhook: Ed25519 signature over `timestamp|body`, ±300 s replay window,
  per-event-id dedupe (Redis, 24 h). Invalid → 401, nothing processed.
* Media socket: unauthenticated by nature, so the URL carries an HMAC bound to
  one call id with a 120 s lifetime; the call must exist and be in progress,
  and one socket per call.
* Bridge → app: bearer `TELNYX_BRIDGE_SECRET` (constant-time compare, fail
  closed). Agent, user and room come from the `PhoneCall` row, never the body.
  Screened calls are refused at this endpoint too.
* Outbound policy: E.164 only, country allowlist, premium/emergency prefixes
  blocked, per-user hourly cap, global concurrency cap, per-number 60 s
  duplicate lease, idempotency key. Rate limiting fails closed without Redis.
* Prompt injection: third-party speech and attachments are labelled untrusted
  in every runtime request, instructions tell the live model the same, and
  unknown inbound callers get no runtime access at all.
* Agents identify themselves as AI assistants at the start of every call.

## Status

| Capability | Implemented | Automated tests | Production-verified |
|---|---|---|---|
| Webhook verification, replay/dup protection | ✅ | ✅ | ❌ |
| Outbound call placement, policy, idempotency | ✅ | ✅ (Telnyx mocked) | ❌ |
| Inbound screening/routing/busy handling | ✅ | ✅ (mocked) | ❌ |
| GPT-Live bridge (passthrough, delegation, barge-in, reconnect, cleanup) | ✅ | ✅ (fake sockets) | ❌ |
| Turn endpoint auth/identity binding | ✅ | ✅ | ❌ |
| SMS in/out, MMS in, delivery receipts | ✅ | ✅ (mocked) | ❌ |
| MMS out (https media URLs) | ✅ | ❌ | ❌ |
| Transcripts, summaries, call history tool | ✅ | partial | ❌ |
| Phone panel (dialer, live call, history, threads) | ✅ | ❌ (type/lint only) | ❌ |
| Compose/Traefik wiring | ✅ | config parsed only | ❌ |
| Call recording / retention controls | ❌ not built | – | – |
| Per-agent tool restriction during third-party calls | ❌ see below | – | – |

"Production-verified" is ❌ across the board: nothing here has touched a real
Telnyx number, a real GPT-Live call, or the VPS. The first live test is
documented in the PR.

## Known gaps / blockers

1. **No live verification.** Needs the Telnyx portal steps above and a call.
   Unverified specifics: exact `call.hangup` cause strings, whether
   `stream_url` accepts a query string on your account, barge-in feel, and
   GPT-Live playout timing (the API gives no output-done event).
2. **Tool restriction on third-party calls.** `routeRuntimeChat` has no
   per-call tool allowlist. Today the defence is untrusted-labelling plus
   screening; a runtime-level read-only mode for call turns is the follow-up.
3. **SMS sender spoofing.** `TELNYX_ALLOWED_NUMBERS` trusts caller/sender ID,
   which can be spoofed. Keep that list to the owner's own numbers; prefer a
   shared passphrase or approval step before destructive actions by text.
4. **Recording** is not implemented; consent/retention policy is undecided.
5. **Out-of-order media** frames are forwarded in arrival order (Telnyx notes
   chunk numbers can reorder); not an issue in practice on a stable stream
   but not reordered either.
6. **Contacts** have a table and API but no UI form yet (`POST /api/telephony/contacts`).
