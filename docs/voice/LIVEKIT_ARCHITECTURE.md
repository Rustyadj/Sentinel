# SentinelVoiceGateway — LiveKit voice architecture

## Stack

- **Transport**: LiveKit WebRTC — real browser audio, interruption/barge-in,
  turn detection, observability, and a provider-agnostic path (not locked to
  one voice-model vendor).
- **VAD / turn detection**: Silero VAD + LiveKit's own turn-detector plugin.
- **STT**: Deepgram Flux.
- **TTS**: Cartesia Sonic 3.5 (production-ready, natural, sub-90ms).
- **Reasoning**: Sentinel's existing Hermes/OpenClaw adapter via `/api/chat` —
  the same endpoint a typed chat message hits. There is no separate "voice
  brain." OpenAI Realtime is deliberately **not** used as the primary brain:
  its realtime path can bypass Sentinel's own tools, skills, and memory,
  which would defeat the point of the system.

## Two deployments, one gateway

LiveKit's actual voice pipeline (VAD → turn detection → STT → reasoning call
→ TTS) is conventionally run by a separate **LiveKit Agents worker**
process — not inside the Next.js app. Sentinel splits accordingly:

1. **Next.js app** (`src/lib/voice/`, `src/app/api/voice/token`) — mints
   scoped LiveKit access tokens for the browser client and runs the thin
   `LiveKitVoiceProvider` that joins the room, publishes the mic, and renders
   transcripts/status. It does not talk to Deepgram, Cartesia, or Silero
   directly.
2. **`worker/`** — a separately deployed Python service using
   `livekit-agents` + the Silero VAD, Deepgram, Cartesia, and turn-detector
   plugins. It joins the same LiveKit room, runs the actual voice pipeline,
   and calls back into this app's `/api/chat` for reasoning — never a
   parallel implementation of tools/memory/skills.

Both sides agree on identity through the **LiveKit room and participant
metadata** — this is the "SentinelVoiceGateway": there is no second identity
model to keep in sync.

- **Room name**: deterministic from `roomId` — `liveKitRoomName()` in
  `src/lib/voice/gateway.ts` produces `sentinel-voice-<roomId>`. One LiveKit
  room maps 1:1 to one Sentinel chat room (conversation).
- **Participant metadata**: JSON-encoded `{agentId, roomId, userId,
  workspaceId?}`, attached to the access token by `/api/voice/token` and
  decoded on the worker side (mirroring `decodeParticipantMetadata()`) to
  route each turn to the right agent, memory scope, and persisted
  conversation.

```
Browser                     Next.js app                  LiveKit room                 Python worker
  |  POST /api/voice/token ---->|                              |                              |
  |<---- {url, token, room} ----|                              |                              |
  |------------------- connect (token: agentId/roomId/userId in metadata) --------------------->|
  |=== mic audio (WebRTC) ======================================================================|
  |                              |                              |          VAD → turn → STT     |
  |                              |<---- POST /api/chat (Bearer VOICE_WORKER_SECRET, serviceUserId) --|
  |                              |---- SSE: Hermes/OpenClaw response (tools, memory, same as chat) -->|
  |                              |                              |          Cartesia TTS -> room  |
  |<===================================== spoken response (WebRTC) ============================|
```

## Never a parallel reasoning path

`/api/chat` (`src/app/api/chat/route.ts`) gained one addition:
`resolveUser()`. A normal browser call is authenticated by session cookie as
before. The worker instead sends `serviceUserId` in the body plus
`Authorization: Bearer <VOICE_WORKER_SECRET>`; `resolveUser()` only accepts
that path when `VOICE_WORKER_SECRET` is configured *and* the bearer token
matches exactly — otherwise it falls through to the normal session check and
the request is unauthorized. This is intentionally the **only** server-to-
server entry point into chat, so a voice turn gets exactly the same
tools/skills/memory/persistence as a typed one.

## Env vars

### Next.js app (`.env`)

| Var | Purpose |
| --- | --- |
| `LIVEKIT_URL` | LiveKit server/cloud URL, also handed to the browser client. |
| `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` | Used by `/api/voice/token` to mint scoped, signed access tokens. Never sent to the browser. |
| `VOICE_WORKER_SECRET` | Shared secret the worker presents to call `/api/chat` as a resolved user. Unset disables the service-auth path entirely (fails closed). |
| `NEXT_PUBLIC_VOICE_PROVIDER=livekit` | Selects `LiveKitVoiceProvider` as the client's voice provider (default remains `browser_stt`). |

### Worker (`worker/.env`, separate deployment)

| Var | Purpose |
| --- | --- |
| `LIVEKIT_URL` / `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` | Same LiveKit project as the app — the worker joins rooms the app minted tokens for. |
| `DEEPGRAM_API_KEY` | Flux STT. |
| `CARTESIA_API_KEY` | Sonic 3.5 TTS. |
| `SENTINEL_API_BASE_URL` | Base URL of the Next.js app, e.g. `https://your-deployment/api/chat`. |
| `VOICE_WORKER_SECRET` | Must match the app's value — this is what authenticates the worker's `/api/chat` calls. |

## Status

**Real and tested in this repo**: the token route (`/api/voice/token`,
fails closed without LiveKit config, validates room ownership, mints a real
signed JWT with correctly scoped grants — see
`src/app/api/voice/token/route.test.ts`), the `resolveUser()` service-auth
path in `/api/chat` (`src/app/api/chat/resolveUser.test.ts`), the pure
routing helpers in `src/lib/voice/gateway.ts`
(`tests/voice/gateway.test.ts`), and `LiveKitVoiceProvider`'s wiring into
the existing `VoiceProvider` interface, provider registry, and UI
(`VoiceControls`, `PersistentVoiceOrb`, `Settings`).

**Structurally scaffolded, not end-to-end verified**: the Python worker in
`worker/`. There are no live LiveKit/Deepgram/Cartesia credentials in this
sandbox, so the worker's actual pipeline (Silero VAD, turn detection,
Deepgram Flux streaming, Cartesia Sonic 3.5 synthesis, and the callback into
`/api/chat`) has not been run against real services. The code follows the
documented `livekit-agents` plugin APIs and this doc's routing contract, but
should be smoke-tested against a real LiveKit project before production use.
