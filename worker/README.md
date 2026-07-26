# Sentinel Voice Worker

The LiveKit Agents worker half of SentinelVoiceGateway — see
[`docs/voice/LIVEKIT_ARCHITECTURE.md`](../docs/voice/LIVEKIT_ARCHITECTURE.md)
for the full architecture. This is a **separately deployed** Python
service, not part of the Next.js app.

It joins a LiveKit room, runs the voice pipeline (Silero VAD, LiveKit's
turn-detector, Deepgram Flux STT, Cartesia Sonic 3.5 TTS), and routes every
transcript through Sentinel's own `/api/chat` for reasoning — never a
separate LLM plugin — so a voice turn gets exactly the same tools, skills,
and memory as a typed chat message.

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

Only `gateway.py` (pure participant-metadata routing) is unit tested here —
it has no LiveKit/network dependency. `agent.py` and `sentinel_client.py`
need a running LiveKit room and a reachable Sentinel deployment to exercise
end-to-end.

## Docker

```bash
docker build -t sentinel-voice-worker .
docker run --env-file .env sentinel-voice-worker
```

See `docker-compose.yml` at the repo root for wiring this in behind the
`voice` profile (`docker compose --profile voice up`).
