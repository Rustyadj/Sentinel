"""Pre-execution authorization of Sentinel bot tool calls.

Sentinel creates bot sessions with source ``sentinel-bot`` and, on the same WebSocket, advertises that it
answers server requests. For each tool call in such a session this hook returns ``{"action": "approve"}``,
which sends the call to Hermes's approval gate (``tools.approval.request_tool_approval``). The gate asks
Sentinel before the tool runs and blocks it on deny, timeout, withdrawal or disconnect. Sentinel answers
``once``, so nothing is persisted and the next call is asked again; the per-call ``rule_key`` keeps any
session or permanent allowlist entry from ever matching a later call.

Fail-closed where it can be: inside a bot session any error, or a host setting that would let the gate
auto-approve (yolo, ``approvals.mode: off``), blocks the call. Outside one the hook does nothing. If the
session source cannot be read at all the hook cannot tell a bot session from any other and does nothing;
Sentinel then sees the call start without having been asked and halts the task after the fact.

Written against Hermes 0.21.5 (hermes_cli/plugins.py, tools/approval.py, tui_gateway/server_requests.py).
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


def register(ctx) -> None:
    ctx.register_hook("pre_tool_call", _on_pre_tool_call)
