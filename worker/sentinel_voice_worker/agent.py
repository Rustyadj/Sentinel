"""SentinelVoiceGateway worker entrypoint.

Joins a LiveKit room, runs the real voice pipeline (Silero VAD -> LiveKit
turn detector -> Deepgram Flux STT -> Cartesia Sonic 3.5 TTS), and routes
every transcript through Sentinel's own /api/chat instead of a bundled LLM
plugin. This is what keeps a voice turn on the exact same tools/skills/
memory path as a typed chat message -- see docs/voice/LIVEKIT_ARCHITECTURE.md.
"""

from __future__ import annotations

import logging

from livekit.agents import Agent, AgentSession, JobContext, WorkerOptions, cli
from livekit.agents.llm import ChatContext
from livekit.plugins import cartesia, deepgram, silero
from livekit.plugins.turn_detector.multilingual import MultilingualModel

from .gateway import decode_participant_metadata
from .sentinel_client import SentinelChatError, send_turn

logger = logging.getLogger("sentinel-voice-worker")


def _latest_user_text(chat_ctx: ChatContext) -> str | None:
    for item in reversed(chat_ctx.items):
        if getattr(item, "role", None) == "user":
            return getattr(item, "text_content", None) or getattr(item, "content", None)
    return None


class SentinelAgent(Agent):
    """Overrides the LLM node so reasoning always goes through Sentinel's own
    /api/chat (Hermes/OpenClaw, with its normal tools/skills/memory) rather
    than a bundled LLM plugin."""

    def __init__(self, *, agent_id: str, room_id: str, user_id: str) -> None:
        super().__init__(instructions="")
        self._agent_id = agent_id
        self._room_id = room_id
        self._user_id = user_id

    async def llm_node(self, chat_ctx: ChatContext, tools, model_settings=None):
        user_text = _latest_user_text(chat_ctx)
        if not user_text:
            return
        try:
            answer = await send_turn(
                agent_id=self._agent_id,
                room_id=self._room_id,
                user_id=self._user_id,
                text=user_text,
            )
        except SentinelChatError:
            logger.exception("Sentinel /api/chat call failed")
            answer = "Sorry, I couldn't reach Sentinel just now."
        if answer:
            yield answer


async def entrypoint(ctx: JobContext) -> None:
    await ctx.connect()

    participant = await ctx.wait_for_participant()
    route = decode_participant_metadata(participant.metadata)
    if route is None:
        logger.error(
            "Refusing to start voice session: participant metadata missing "
            "agentId/roomId/userId (room=%s, participant=%s)",
            ctx.room.name,
            participant.identity,
        )
        return

    session = AgentSession(
        vad=silero.VAD.load(),
        stt=deepgram.STT(model="flux"),
        tts=cartesia.TTS(model="sonic-3.5"),
        turn_detection=MultilingualModel(),
    )

    await session.start(
        room=ctx.room,
        agent=SentinelAgent(
            agent_id=route.agent_id,
            room_id=route.room_id,
            user_id=route.user_id,
        ),
    )


def main() -> None:
    cli.run_app(WorkerOptions(entrypoint_fnc=entrypoint))


if __name__ == "__main__":
    main()
