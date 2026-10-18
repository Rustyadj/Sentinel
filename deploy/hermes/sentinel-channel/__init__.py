"""Messaging transport for Sentinel. The gateway never starts a parallel agent.

Sentinel authenticates the machine and binds each sender to a specific user.
This hook additionally retains Hermes authorization, bot-loop and pause guards.
WebSocket sessions created by Sentinel do not enter this hook, avoiding loops.
"""
from __future__ import annotations

import asyncio
import json
import logging
import sqlite3

import httpx

log = logging.getLogger(__name__)
_locks = {}


def _settings():
    # Read at call time so the active profile owns its credential.
    from hermes_cli.config import get_hermes_home
    home = get_hermes_home()
    return home, json.loads((home / "sentinel-channel.json").read_text())


async def _dispatch(event, gateway, **_):
    source = event.source
    platform = getattr(source.platform, "value", str(source.platform))
    if platform not in {"telegram", "sms", "discord", "slack", "whatsapp", "signal", "matrix", "feishu"}:
        return None
    if getattr(event, "internal", False):
        return None
    # The hook runs BEFORE Hermes' native auth gate. Unauthorized messages must
    # continue to that gate, never inherit the Sentinel owner's identity.
    if not gateway._is_user_authorized_for_source(source):
        return None
    command = event.get_command()
    if command and command.split("@", 1)[0] in {
        "pause", "resume", "status", "restart", "approve", "deny", "help",
    }:
        return None  # Native gateway controls, never task or skill shortcuts.
    try:
        adapter = gateway._delivery_adapter_for(source)
        if adapter is None:
            return {"action": "skip", "reason": "sentinel-no-delivery-adapter"}
        from gateway.platforms.base import _thread_metadata_for_source
        metadata = _thread_metadata_for_source(source, getattr(event, "message_id", None))

        async def reply(text):
            result = await adapter.send(chat_id=source.chat_id, content=text, metadata=metadata)
            if result is not None and getattr(result, "success", True) is False:
                raise RuntimeError("Channel reply delivery failed")

        paused = gateway._hm_estop_gate(event, source, False)
        if paused:
            await reply(paused)
            return {"action": "skip", "reason": "sentinel-paused"}
        if not gateway._admit_bot_message_for_source(source):
            return {"action": "skip", "reason": "sentinel-bot-loop-guard"}
        home, settings = _settings()
        async def submit(payload):
            async with httpx.AsyncClient(timeout=1800, trust_env=False) as client:
                return await client.post(settings["url"], json=payload,
                    headers={"Authorization": "Bearer " + settings["secret"]})

        payload = {
            "platform": platform, "senderId": str(source.user_id or ""),
            "chatId": str(source.chat_id), "threadId": str(getattr(source, "thread_id", None) or ""),
            "messageId": str(event.message_id or ""), "text": event.text or "",
        }
        # /stop must reach Sentinel immediately while this chat's main turn
        # holds the serialization lock. New/reset wait for its completion.
        if command == "stop":
            response = await submit({**payload, "text": "/stop"})
            answer = response.json()
            await reply(answer.get("text") or answer.get("error") or "Sentinel could not stop this turn.")
            return {"action": "skip", "reason": "sentinel-stop"}
        key = json.dumps([platform, source.user_id, source.chat_id, getattr(source, "thread_id", None)])
        async with _locks.setdefault(key, asyncio.Lock()):
            message_id = str(event.message_id or "")
            if not message_id:
                await reply("This message has no delivery ID, so Sentinel could not safely accept it.")
                return {"action": "skip", "reason": "sentinel-missing-delivery-id"}
            with sqlite3.connect(home / "sentinel-channel-delivery.db") as conn:
                conn.execute("CREATE TABLE IF NOT EXISTS delivered (conversation TEXT, message TEXT, PRIMARY KEY(conversation,message))")
                if conn.execute("SELECT 1 FROM delivered WHERE conversation=? AND message=?", (key, message_id)).fetchone():
                    return {"action": "skip", "reason": "sentinel-already-delivered"}
            text = event.text or ""
            if getattr(event, "media_urls", None):
                session_key = gateway._session_key_for_source(source)
                text = await gateway._prepare_profile_scoped_inbound_message_text(
                    event=event, source=source, history=[], session_key=session_key,
                )
                images = gateway._consume_pending_native_image_paths(session_key)
                if text is not None and images:
                    text += "\n\n[Attached images are saved in this Hermes runtime. Inspect them with your image tools: " + json.dumps(images) + "]"
            if not text:
                return {"action": "skip", "reason": "sentinel-no-content"}
            payload["text"] = "/" + command if command in {"new", "reset"} else text
            # No automatic POST retry: timeout may mean real work already ran.
            response = await submit(payload)
            answer = response.json()
            if response.status_code != 200:
                await reply(answer.get("error") or "Sentinel is unavailable. Please try again shortly.")
                return {"action": "skip", "reason": "sentinel-refused"}
            _, clean_text = adapter.extract_media(answer["text"])
            if clean_text.strip():
                await reply(clean_text)
            await gateway._deliver_media_from_response(answer["text"], event, adapter, thread_metadata=metadata)
            with sqlite3.connect(home / "sentinel-channel-delivery.db") as conn:
                conn.execute("INSERT OR IGNORE INTO delivered VALUES (?,?)", (key, message_id))
            log.info("Sentinel channel turn completed: platform=%s room=%s routing=%s", platform, answer.get("roomId"), answer.get("routing"))
    except Exception:
        # Hermes normally fails open on hook exceptions. Catch all errors here
        # so an outage never silently starts an independent Lisa turn.
        log.exception("Sentinel channel routing failed")
        try:
            await reply("Sentinel is temporarily unavailable. Check the conversation in Sentinel before resubmitting.")
        except Exception:
            log.exception("Sentinel channel error reply could not be delivered")
    return {"action": "skip", "reason": "sentinel-handled"}


def register(ctx):
    ctx.register_hook("pre_gateway_dispatch", _dispatch)
