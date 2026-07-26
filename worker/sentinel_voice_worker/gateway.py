"""Sentinel Voice Gateway routing helper — the worker-side mirror of
src/lib/voice/gateway.ts.

The worker is intentionally stateless: it only ever knows the LiveKit room
name it joined, and parses the Sentinel roomId back out of it. It never
receives or decides an agentId, userId, or workspaceId — Sentinel resolves
all of that server-side from the room record. Routing, memory, tools, and
permissions live in Sentinel, not here.
"""

from __future__ import annotations

ROOM_PREFIX = "sentinel-voice-"


def room_id_from_livekit_room_name(name: str) -> str | None:
    """Mirrors roomIdFromLiveKitRoomName() in src/lib/voice/gateway.ts."""
    return name[len(ROOM_PREFIX):] if name.startswith(ROOM_PREFIX) else None
