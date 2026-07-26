"""SentinelVoiceGateway worker entrypoint.

The worker is deliberately stateless. It joins a LiveKit room and does
exactly this: capture mic audio, detect turns, speech-to-text, stream text
to Sentinel, receive the streamed response, text-to-speech, stream audio
back. It never sees or decides an agentId, userId, or workspaceId, and knows
nothing about workspaces, memories, permissions, MCP, routing, tools,
organizations, or the knowledge graph -- all of that lives in Sentinel
itself, resolved server-side from the room the worker joined (see
resolveVoiceWorkerTurn() in src/app/api/chat/route.ts). See
docs/voice/LIVEKIT_ARCHITECTURE.md for the full picture.
"""

from __future__ import annotations

import logging

from livekit.agents import Agent, AgentSession, JobContext, WorkerOptions, cli
from livekit.agents.llm import ChatContext
from livekit.plugins.turn_detector.multilingual import MultilingualModel

from .gateway import room_id_from_livekit_room_name
from .providers import build_stt, build_tts, build_vad
from .sentinel_client import SentinelChatError, send_turn

logger = logging.getLogger("sentinel-voice-worker")


def _latest_user_text(chat_ctx: ChatContext) -> str | None:
    for item in reversed(chat_ctx.items):
        if getattr(item, "role", None) == "user":
            return getattr(item, "text_content", None) or getattr(item, "content", None)
    return None


class SentinelAgent(Agent):
    """Overrides the LLM node so reasoning always goes through Sentinel's own
    /api/chat rather than a bundled LLM plugin. The only thing this agent
    knows is which room it's in -- Sentinel decides everything else."""

    def __init__(self, *, room_id: str) -> None:
        super().__init__(instructions="")
        self._room_id = room_id

    async def llm_node(self, chat_ctx: ChatContext, tools, model_settings=None):
        user_text = _latest_user_text(chat_ctx)
        if not user_text:
            return
        try:
            answer = await send_turn(room_id=self._room_id, text=user_text)
        except SentinelChatError:
            logger.exception("Sentinel /api/chat call failed")
            answer = "Sorry, I couldn't reach Sentinel just now."
        if answer:
            yield answer


async def entrypoint(ctx: JobContext) -> None:
    await ctx.connect()

    room_id = room_id_from_livekit_room_name(ctx.room.name)
    if room_id is None:
        logger.error(
            "Refusing to start voice session: %r is not a Sentinel voice room",
            ctx.room.name,
        )
        return

    await ctx.wait_for_participant()

    session = AgentSession(
        vad=build_vad(),
        stt=build_stt(),
        tts=build_tts(),
        turn_detection=MultilingualModel(),
    )

    await session.start(room=ctx.room, agent=SentinelAgent(room_id=room_id))


def main() -> None:
    cli.run_app(WorkerOptions(entrypoint_fnc=entrypoint))


if __name__ == "__main__":
    main()
