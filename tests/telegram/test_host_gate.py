"""Host plugin unit tests. No live Hermes profile, token, model or tool is used."""
import importlib.util
import json
from pathlib import Path
import sys
import types
import unittest
from unittest.mock import patch

source_file = Path(__file__).resolve().parents[2] / "deploy/hermes/plugins/sentinel-bot-gate/__init__.py"
spec = importlib.util.spec_from_file_location("sentinel_gate", source_file)
gate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gate)
SOURCE = "sentinel-telegram:c123456789012345678901234"

class HostGateTests(unittest.TestCase):
    def call(self, tool, args=None):
        with patch.object(gate, "_session_source", return_value=SOURCE), patch.object(gate, "_telegram_ready", return_value=True):
            return gate._strict_pre_tool_call(tool, args or {}, tool_call_id="call-1")

    def test_tools_are_gated_before_execution(self):
        self.assertEqual(self.call("web_search")["action"], "approve")
        self.assertTrue(self.call("web_search")["rule_key"].startswith("sentinel-bot:"))

    def test_escape_tools_are_denied_even_with_broad_sentinel_grants(self):
        for tool in ["terminal", "execute_code", "memory", "delegate_task", "cronjob", "session_search", "write_file", "patch", "mcp_unknown"]:
            self.assertEqual(self.call(tool)["action"], "block", tool)

    def test_only_current_update_media_can_be_read(self):
        self.assertEqual(self.call("read_file", {"path": "/sentinel-media/" + SOURCE.split(":")[1] + "/0.jpg"})["action"], "approve")
        for path in ["/opt/data/.env", "/sentinel-media/someone-else/0.jpg", "/sentinel-media/" + SOURCE.split(":")[1] + "/../../secret"]:
            self.assertEqual(self.call("read_file", {"path": path})["action"], "block")

    def test_missing_session_context_fails_closed(self):
        with patch.object(gate, "_session_source", return_value=None):
            self.assertEqual(gate._strict_pre_tool_call("web_search")["action"], "block")

    def test_unavailable_memory_boundary_fails_closed(self):
        with patch.object(gate, "_session_source", return_value=SOURCE), patch.object(gate, "_telegram_ready", return_value=False):
            self.assertEqual(gate._strict_pre_tool_call("web_search")["action"], "block")

    def test_plugin_exception_fails_closed(self):
        with patch.object(gate, "_session_source", side_effect=RuntimeError("failed")):
            self.assertEqual(gate._strict_pre_tool_call("web_search")["action"], "block")

    def test_approval_ids_are_per_call_and_never_session_grants(self):
        with patch.object(gate, "_session_source", return_value=SOURCE), patch.object(gate, "_telegram_ready", return_value=True):
            self.assertNotEqual(gate._strict_pre_tool_call("web_search")["rule_key"], gate._strict_pre_tool_call("web_search")["rule_key"])

    def test_proof_is_scoped_to_current_profile_source_and_nonce(self):
        profiles = types.ModuleType("hermes_cli.profiles")
        profiles.get_active_profile_name = lambda: "sentinel-lisa"
        with patch.object(gate.Path, "is_file", return_value=True), patch.dict(sys.modules, {"hermes_cli.profiles": profiles}), patch.object(gate, "_session_source", return_value=SOURCE), patch.object(gate, "_telegram_ready", return_value=True):
            proof = json.loads(gate._telegram_status("nonce"))
        self.assertEqual(proof, {"nonce": "nonce", "version": 1, "source": SOURCE, "profile": "sentinel-lisa", "ready": True})

    def test_native_telegram_dispatch_is_blocked_after_cutover(self):
        event = types.SimpleNamespace(source=types.SimpleNamespace(platform=types.SimpleNamespace(value="telegram")))
        with patch.object(gate.Path, "is_file", return_value=True):
            self.assertEqual(gate._skip_owned_telegram(event)["action"], "skip")
            event.source.platform.value = "voice"
            self.assertIsNone(gate._skip_owned_telegram(event))
        with patch.object(gate.Path, "is_file", return_value=False):
            event.source.platform.value = "telegram"
            self.assertIsNone(gate._skip_owned_telegram(event))

if __name__ == "__main__":
    unittest.main()
