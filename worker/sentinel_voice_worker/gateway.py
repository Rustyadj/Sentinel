"""Sentinel Voice Gateway routing helpers — the worker-side mirror of
src/lib/voice/gateway.ts. A LiveKit room maps 1:1 to a Sentinel chat room;
participant metadata carries the ids both sides need to route a turn to the
right agent, memory scope, and persisted conversation.
"""

from __future__ import annotations

import json
from dataclasses import dataclass


@dataclass(frozen=True)
class VoiceRouteContext:
    agent_id: str
    room_id: str
    user_id: str
    workspace_id: str | None = None


def decode_participant_metadata(raw: str | None) -> VoiceRouteContext | None:
    """Mirrors decodeParticipantMetadata() in src/lib/voice/gateway.ts."""
    if not raw:
        return None
    try:
        parsed = json.loads(raw)
    except (ValueError, TypeError):
        return None
    if not isinstance(parsed, dict):
        return None
    agent_id = parsed.get("agentId")
    room_id = parsed.get("roomId")
    user_id = parsed.get("userId")
    if not agent_id or not room_id or not user_id:
        return None
    return VoiceRouteContext(
        agent_id=agent_id,
        room_id=room_id,
        user_id=user_id,
        workspace_id=parsed.get("workspaceId"),
    )
