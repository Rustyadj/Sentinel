"""Calls Sentinel's own /api/chat endpoint — the same route a typed browser
message hits. This is the ONLY reasoning path the worker uses: no separate
"voice brain," so a voice turn gets exactly the same tools, skills, and
memory as a typed one. Mirrors the SSE parsing in src/lib/chat/voiceBridge.ts.
"""

from __future__ import annotations

import json
import logging
import os

import aiohttp

logger = logging.getLogger("sentinel-voice-worker")


class SentinelChatError(RuntimeError):
    pass


async def send_turn(
    *,
    agent_id: str,
    room_id: str,
    user_id: str,
    text: str,
) -> str:
    """Sends one voice turn through Sentinel's /api/chat and returns the
    assistant's full text reply, collected from the SSE stream."""
    base_url = os.environ.get("SENTINEL_API_BASE_URL")
    worker_secret = os.environ.get("VOICE_WORKER_SECRET")
    if not base_url or not worker_secret:
        raise SentinelChatError(
            "SENTINEL_API_BASE_URL and VOICE_WORKER_SECRET must both be set"
        )

    payload = {
        "messages": [{"role": "user", "content": text}],
        "agentId": agent_id,
        "roomId": room_id,
        "userContent": text,
        "serviceUserId": user_id,
    }
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {worker_secret}",
    }

    answer_parts: list[str] = []
    async with aiohttp.ClientSession() as session:
        async with session.post(base_url, json=payload, headers=headers) as response:
            if response.status != 200:
                body = await response.text()
                raise SentinelChatError(
                    f"/api/chat returned {response.status}: {body[:500]}"
                )
            buffer = ""
            async for chunk in response.content.iter_any():
                buffer += chunk.decode("utf-8", errors="ignore")
                lines = buffer.split("\n")
                buffer = lines.pop()
                for line in lines:
                    if not line.startswith("data: "):
                        continue
                    raw = line[len("data: "):].strip()
                    if not raw or raw == "[DONE]":
                        continue
                    try:
                        event = json.loads(raw)
                    except ValueError:
                        continue
                    if event.get("type") == "text" and event.get("text"):
                        answer_parts.append(event["text"])
                    if event.get("type") == "error":
                        raise SentinelChatError(event.get("error", "Chat engine error"))

    return "".join(answer_parts)
