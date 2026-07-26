# SentinelVoiceGateway — LiveKit voice architecture

## Stack

- **Transport**: LiveKit WebRTC — real browser audio, interruption/barge-in,
  turn detection, observability, and a provider-agnostic path (not locked to
  one voice-model vendor).
- **VAD / turn detection**: Silero VAD + LiveKit's own turn-detector plugin.
- **STT**: Deepgram Flux (provider-agnostic — see below).
- **TTS**: Cartesia Sonic 3.5 (production-ready, natural, sub-90ms; also
  provider-agnostic).
- **Reasoning**: Sentinel's existing Hermes/OpenClaw adapter via `/api/chat` —
  the same endpoint a typed chat message hits. There is no separate "voice
  brain." OpenAI Realtime is deliberately **not** used as the primary brain:
  its realtime path can bypass Sentinel's own tools, skills, and memory,
  which would defeat the point of the system.

## Two deployments, one gateway — and a stateless worker

LiveKit's actual voice pipeline (VAD → turn detection → STT → reasoning call
→ TTS) is conventionally run by a separate **LiveKit Agents worker**
process — not inside the Next.js app. Sentinel splits accordingly:

1. **Next.js app** (`src/lib/voice/`, `src/app/api/voice/token`) — mints
   scoped LiveKit access tokens for the browser client and runs the thin
   `LiveKitVoiceProvider` that joins the room, publishes the mic, and renders
   transcripts/status. It does not talk to Deepgram, Cartesia, or Silero
   directly.
2. **`worker/`** — a separately deployed Python service using
   `livekit-agents` + Silero VAD, a turn-detector plugin, and
   provider-agnostic STT/TTS (Deepgram Flux / Cartesia Sonic 3.5 today). It
   joins the same LiveKit room and does exactly this: capture mic audio,
   detect turns, speech-to-text, stream text to Sentinel, receive the
   streamed response, text-to-speech, stream audio back.

**The worker is deliberately stateless.** It never receives or decides an
agentId, userId, or workspaceId, and knows nothing about workspaces,
memories, permissions, MCP, routing, tools, organizations, or the knowledge
graph — all of that logic lives in Sentinel. The only piece of identity the
worker has is the LiveKit room it joined.

- **Room name**: deterministic from `roomId` — `liveKitRoomName()` in
  `src/lib/voice/gateway.ts` (mirrored by `gateway.py`'s
  `room_id_from_livekit_room_name()`) produces `sentinel-voice-<roomId>`.
  One LiveKit room maps 1:1 to one Sentinel chat room (conversation).
- **What the worker sends**: `{roomId, userContent}` — the roomId parsed
  straight back out of the room name it already joined, plus the raw
  transcribed text. Nothing else.
- **What Sentinel resolves**: `resolveVoiceWorkerTurn()` in
  `src/app/api/chat/route.ts` looks the room up in the database and derives
  the acting `userId` (the room's owner) and `agentId` (the room's first
  assigned agent) itself. The worker cannot supply or override either — it
  has no say in routing.

```
Browser                     Next.js app                  LiveKit room                 Python worker (stateless)
  |  POST /api/voice/token ---->|                              |                              |
  |<---- {url, token, room} ----|                              |                              |
  |------------------- connect (room: sentinel-voice-<roomId>) ------------------------------->|
  |=== mic audio (WebRTC) ======================================================================|
  |                              |                              |          VAD -> turn -> STT   |
  |                              |<---- POST /api/chat {roomId, userContent} (Bearer VOICE_WORKER_SECRET) --|
  |                              |---- SSE: Hermes/OpenClaw response (tools, memory, same as chat) -------->|
  |                              |                              |          TTS -> room          |
  |<===================================== spoken response (WebRTC) ============================|
```

## Never a parallel reasoning path

`/api/chat` (`src/app/api/chat/route.ts`) gained one addition:
`resolveVoiceWorkerTurn()`. A normal browser call is authenticated by
session cookie as before, and supplies its own `agentId`/`messages`. The
worker instead sends only `{roomId, userContent}` plus
`Authorization: Bearer <VOICE_WORKER_SECRET>`; `resolveVoiceWorkerTurn()`
only accepts that path when `VOICE_WORKER_SECRET` is configured, the bearer
token matches exactly, and the roomId resolves to a room with an owner —
otherwise the request falls through to the normal session check (which a
bearer-only caller will fail). This is intentionally the **only**
server-to-server entry point into chat, so a voice turn gets exactly the
same tools/skills/memory/persistence as a typed one, and the worker is never
in a position to impersonate a user or pick an agent for them.

## Provider-agnostic STT/TTS

`worker/sentinel_voice_worker/providers.py` selects the STT/TTS
implementation from `STT_PROVIDER` / `TTS_PROVIDER` env vars at startup
(default: `deepgram` / `cartesia`). Adding a new vendor is a new branch in
that one file — `agent.py` and the rest of the pipeline are unaffected.

## Env vars

### Next.js app (`.env`)

| Var | Purpose |
| --- | --- |
| `LIVEKIT_URL` | LiveKit server/cloud URL, also handed to the browser client. |
| `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` | Used by `/api/voice/token` to mint scoped, signed access tokens. Never sent to the browser. |
| `VOICE_WORKER_SECRET` | Shared secret the worker presents to call `/api/chat`. Unset disables the service-auth path entirely (fails closed). |
| `NEXT_PUBLIC_VOICE_PROVIDER=livekit` | Selects `LiveKitVoiceProvider` as the client's voice provider (default remains `browser_stt`). |

### Worker (`worker/.env`, separate deployment)

| Var | Purpose |
| --- | --- |
| `LIVEKIT_URL` / `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` | Same LiveKit project as the app — the worker joins rooms the app minted tokens for. |
| `STT_PROVIDER` / `TTS_PROVIDER` | Optional — pick the voice-model vendor (default `deepgram` / `cartesia`). |
| `DEEPGRAM_API_KEY` | Flux STT. |
| `CARTESIA_API_KEY` | Sonic 3.5 TTS. |
| `SENTINEL_API_BASE_URL` | Base URL of the Next.js app's chat endpoint, e.g. `https://your-deployment/api/chat`. |
| `VOICE_WORKER_SECRET` | Must match the app's value — this is what authenticates the worker's `/api/chat` calls. |

## Status

**Real and tested in this repo**: the token route (`/api/voice/token`,
fails closed without LiveKit config, validates room ownership, mints a real
signed JWT with correctly scoped grants — see
`src/app/api/voice/token/route.test.ts`), the `resolveVoiceWorkerTurn()`
stateless-worker path in `/api/chat`
(`src/app/api/chat/voiceWorkerTurn.test.ts`), the pure routing helpers in
`src/lib/voice/gateway.ts` (`tests/voice/gateway.test.ts`) and their Python
mirror in `worker/sentinel_voice_worker/gateway.py`
(`worker/tests/test_gateway.py`), and `LiveKitVoiceProvider`'s wiring into
the existing `VoiceProvider` interface, provider registry, and UI
(`VoiceControls`, `PersistentVoiceOrb`, `Settings`).

**Structurally scaffolded, not end-to-end verified**: the rest of the
Python worker in `worker/`. There are no live LiveKit/Deepgram/Cartesia
credentials in this sandbox, so the worker's actual pipeline (Silero VAD,
turn detection, Deepgram Flux streaming, Cartesia Sonic 3.5 synthesis, and
the callback into `/api/chat`) has not been run against real services. The
code follows the documented `livekit-agents` plugin APIs and this doc's
routing contract, but should be smoke-tested against a real LiveKit project
before production use.
