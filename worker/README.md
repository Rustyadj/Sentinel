# Sentinel Voice Worker

The LiveKit Agents worker half of SentinelVoiceGateway — see
[`docs/voice/LIVEKIT_ARCHITECTURE.md`](../docs/voice/LIVEKIT_ARCHITECTURE.md)
for the full architecture. This is a **separately deployed** Python
service, not part of the Next.js app.

It joins a LiveKit room and does exactly this: capture mic audio, detect
turns, speech-to-text, stream text to Sentinel, receive the streamed
response, text-to-speech, stream audio back. It is **stateless** — it never
sees or decides an agentId, userId, or workspaceId, and knows nothing about
workspaces, memories, permissions, MCP, routing, tools, organizations, or
the knowledge graph. All of that lives in Sentinel itself: the worker only
knows the LiveKit room it joined, parses the Sentinel `roomId` back out of
the room name, and sends `{roomId, userContent}` to `/api/chat` — Sentinel
resolves the acting user and agent from the room record server-side (see
`resolveVoiceWorkerTurn()` in `src/app/api/chat/route.ts`).

STT/TTS are provider-agnostic by design (`providers.py`): `STT_PROVIDER` /
`TTS_PROVIDER` env vars pick the implementation at startup (currently
Deepgram Flux / Cartesia Sonic 3.5 are the only registered options — add a
branch in `providers.py` to support another vendor without touching
`agent.py`).

## Status

Structurally scaffolded against the documented `livekit-agents` plugin
APIs, **not yet run against live LiveKit/Deepgram/Cartesia credentials** in
this repo's environment. The pure routing logic (`gateway.py`) is unit
tested and verified. Smoke-test against a real LiveKit project before
production use — in particular confirm the Deepgram/Cartesia model names
(`flux`, `sonic-3.5`) against those plugins' current API, since voice
provider APIs move quickly.

## Setup

```bash
cd worker
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env  # fill in LiveKit/Deepgram/Cartesia/Sentinel values
python -m sentinel_voice_worker.agent download-files
python -m sentinel_voice_worker.agent dev   # or `start` for production
```

## Tests

```bash
pip install pytest
pytest tests/
```

Only `gateway.py` (pure roomId/room-name parsing) is unit tested here — it
has no LiveKit/network dependency. `agent.py` and `sentinel_client.py` need
a running LiveKit room and a reachable Sentinel deployment to exercise
end-to-end.

## Docker

```bash
docker build -t sentinel-voice-worker .
docker run --env-file .env sentinel-voice-worker
```

See `docker-compose.yml` at the repo root for wiring this in behind the
`voice` profile (`docker compose --profile voice up`).
