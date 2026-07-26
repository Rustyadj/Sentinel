"""Provider-agnostic VAD/STT/TTS wiring.

The worker isn't locked to one voice-model vendor: STT_PROVIDER and
TTS_PROVIDER select the implementation at startup, so swapping vendors is an
env var change, not a pipeline rewrite. Deepgram Flux and Cartesia Sonic 3.5
are the first (and currently only) registered providers — add a branch here
to support another vendor; nothing in agent.py needs to change.
"""

from __future__ import annotations

import os

from livekit.agents import stt as stt_api
from livekit.agents import tts as tts_api
from livekit.plugins import cartesia, deepgram, silero


def build_vad():
    return silero.VAD.load()


def build_stt() -> stt_api.STT:
    provider = os.environ.get("STT_PROVIDER", "deepgram")
    if provider == "deepgram":
        return deepgram.STT(model=os.environ.get("DEEPGRAM_MODEL", "flux"))
    raise ValueError(f"Unknown STT_PROVIDER: {provider!r}")


def build_tts() -> tts_api.TTS:
    provider = os.environ.get("TTS_PROVIDER", "cartesia")
    if provider == "cartesia":
        return cartesia.TTS(model=os.environ.get("CARTESIA_MODEL", "sonic-3.5"))
    raise ValueError(f"Unknown TTS_PROVIDER: {provider!r}")
