"""Trusted Hermes pre-call gate shared by bots and the Telegram gateway.

The bot-session protocol reuses the parallel bot-authorization implementation.
Telegram sessions additionally require an isolated, memory-disabled profile,
fixed per-update media scope, a protected ownership marker, and a safe tool
surface. The host's approval gate blocks before dispatch on deny/disconnect or
timeout. The audited Hermes hook engine also fails closed on pre-call timeout.
No hook changes the agent's default personality, model or voice integration.
"""

from __future__ import annotations

import uuid
from typing import Any, Dict, Optional

BOT_SESSION_SOURCE = "sentinel-bot"


def _session_source() -> Optional[str]:
    try:
        from gateway.session_context import get_session_env
        return get_session_env("HERMES_SESSION_SOURCE", "") or ""
    except Exception:
        return None


def _gate_would_auto_approve() -> bool:
    from tools import approval, approval_context
    return bool(approval._yolo_active()) or approval_context._get_approval_mode() == "off"


def _on_pre_tool_call(tool_name: str = "", args: Any = None, tool_call_id: str = "", **_: Any) -> Optional[Dict[str, str]]:
    if _session_source() != BOT_SESSION_SOURCE:
        return None
    try:
        if _gate_would_auto_approve():
            return {"action": "block", "message": f"BLOCKED: {tool_name} needs Sentinel's authorization, but this host auto-approves (yolo or approvals.mode off)."}
        return {
            "action": "approve",
            "message": f"Sentinel bot policy check: {tool_name}",
            # Namespaced under plugin_rule:sentinel-bot: by Hermes; Sentinel recognises its own requests by that prefix.
            "rule_key": f"sentinel-bot:{tool_call_id or uuid.uuid4().hex}",
        }
    except Exception:
        return {"action": "block", "message": f"BLOCKED: Sentinel's pre-execution check failed for {tool_name}."}



# Strict Telegram mode shares the bot authorization protocol. It additionally
# refuses local history/memory and escape hatches even if a broad bot grant exists.
# This is a per-session managed profile; existing voice/default profiles are untouched.
import json
import re
from pathlib import Path

_TELEGRAM_SAFE = {"web_search", "web_extract", "skill_view", "skills_list", "todo", "clarify", "read_file", "vision_analyze", "video_analyze", "sentinel_transcribe_audio"}


def _telegram_ready():
    from hermes_cli.config import load_config_readonly
    cfg = load_config_readonly()
    memory = cfg.get("memory", {})
    return (memory.get("memory_enabled") is False and memory.get("user_profile_enabled") is False
            and memory.get("provider", "") in ("", "none") and not _gate_would_auto_approve())


def _telegram_status(nonce):
    from hermes_cli.profiles import get_active_profile_name
    source = _session_source() or ""
    return json.dumps({"nonce": nonce, "version": 1, "source": source,
                       "profile": get_active_profile_name(),
                       "ready": Path("/run/sentinel-telegram-owned").is_file() and bool(re.fullmatch(r"sentinel-telegram:[a-z0-9]{20,40}", source)) and _telegram_ready()})


_original_pre_tool_call = _on_pre_tool_call


def _strict_pre_tool_call(tool_name="", args=None, tool_call_id="", **kwargs):
    try:
        source = _session_source()
        if source is None:
            return {"action": "block", "message": "BLOCKED: cannot establish trusted session context"}
        if not source.startswith("sentinel-telegram:"):
            return _original_pre_tool_call(tool_name, args, tool_call_id, **kwargs)
        if not re.fullmatch(r"sentinel-telegram:[a-z0-9]{20,40}", source) or not _telegram_ready():
            return {"action": "block", "message": "BLOCKED: managed Telegram memory/tool boundary is unavailable"}
        if tool_name not in _TELEGRAM_SAFE:
            return {"action": "block", "message": "BLOCKED: this tool is outside the isolated Telegram tool surface"}
        if tool_name in {"read_file", "vision_analyze", "video_analyze", "sentinel_transcribe_audio"}:
            # Only this update's readonly media. No credential files, local
            # conversation search, other agents' files, or another sender's media.
            root = Path("/sentinel-media") / source.split(":", 1)[1]
            values = args if isinstance(args, dict) else {}
            paths = [v for k, v in values.items() if k in {"path", "file_path", "image_path", "image_url", "video_url", "video_path", "audio_path"} and isinstance(v, str)]
            if not paths or any(not Path(p).resolve().is_relative_to(root.resolve()) for p in paths):
                return {"action": "block", "message": "BLOCKED: media path is outside this message"}
        return {"action": "approve", "message": f"Sentinel Telegram policy check: {tool_name}",
                "rule_key": f"sentinel-bot:{tool_call_id or uuid.uuid4().hex}"}
    except Exception:
        return {"action": "block", "message": "BLOCKED: trusted Telegram check failed"}


def _transcribe_media(args, **_):
    # Reuse Hermes' existing supported gateway transcription backend.
    if not (_session_source() or "").startswith("sentinel-telegram:") or _strict_pre_tool_call("sentinel_transcribe_audio", args).get("action") != "approve":
        return json.dumps({"error": "Media is outside the trusted Telegram session"})
    from tools.transcription_tools import transcribe_audio
    return json.dumps(transcribe_audio(args["file_path"], source="gateway"))


def _skip_owned_telegram(event=None, **_):
    # Install this SAME plugin in the original gateway profile before cutover.
    # Once the root-owned marker is mounted, a resurrected native Telegram
    # consumer cannot dispatch a second agent turn. Other platforms are untouched.
    if not Path("/run/sentinel-telegram-owned").is_file():
        return None
    platform = getattr(getattr(event, "source", None), "platform", None)
    if getattr(platform, "value", platform) == "telegram":
        return {"action": "skip", "reason": "Sentinel owns this Telegram bot"}
    return None


def register(ctx):
    ctx.register_hook("pre_gateway_dispatch", _skip_owned_telegram)
    ctx.register_tool(name="sentinel_transcribe_audio", toolset="sentinel_telegram", schema={
        "name": "sentinel_transcribe_audio", "description": "Transcribe the current Telegram message's staged audio using Hermes' configured STT backend.",
        "parameters": {"type": "object", "properties": {"file_path": {"type": "string"}}, "required": ["file_path"], "additionalProperties": False},
    }, handler=_transcribe_media)
    ctx.register_hook("pre_tool_call", _strict_pre_tool_call)
    ctx.register_command("sentinel-gate-status", _telegram_status,
                         description="Read-only trusted Sentinel Telegram boundary probe")
