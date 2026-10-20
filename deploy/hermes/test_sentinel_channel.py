"""Run with python -m unittest discover -s deploy/hermes -p 'test_*.py'."""
import importlib.util
import logging
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace, ModuleType
from unittest.mock import AsyncMock, MagicMock, create_autospec, patch

spec = importlib.util.spec_from_file_location("sentinel_channel", Path(__file__).parent / "sentinel-channel/__init__.py")
plugin = importlib.util.module_from_spec(spec)
spec.loader.exec_module(plugin)


async def adapter_send(chat_id, content, reply_to=None, metadata=None):
    """Hermes BasePlatformAdapter.send contract; strict signature catches keyword drift."""
    return SimpleNamespace(success=True)


class ChannelTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        plugin._locks.clear()
        self.source = SimpleNamespace(platform=SimpleNamespace(value="telegram"), user_id="sender", chat_id="chat", thread_id="topic")
        self.event = SimpleNamespace(source=self.source, internal=False, message_id="1", text="hello", media_urls=[], get_command=lambda: None)
        self.adapter = SimpleNamespace(send=create_autospec(adapter_send, return_value=SimpleNamespace(success=True)), extract_media=lambda text: ([], text))
        self.gateway = SimpleNamespace(
            _is_user_authorized_for_source=MagicMock(return_value=True),
            _delivery_adapter_for=MagicMock(return_value=self.adapter),
            _hm_estop_gate=MagicMock(return_value=None),
            _admit_bot_message_for_source=MagicMock(return_value=True),
            _deliver_media_from_response=AsyncMock(),
        )
        base = ModuleType("gateway.platforms.base")
        base._thread_metadata_for_source = lambda src, msg: {"thread_id": src.thread_id}
        self.enterContext(patch.dict(sys.modules, {"gateway.platforms.base": base}))
        self.enterContext(patch.object(plugin, "_settings", return_value=(Path(self.temp.name), {"url": "http://sentinel/api/chat/channel", "secret": "test"})))
        self.post = AsyncMock(return_value=SimpleNamespace(status_code=200, json=lambda: {"text": "Sentinel reply", "roomId": "room", "routing": {"provider": "jev"}}))
        client = SimpleNamespace(post=self.post)
        context = MagicMock()
        context.__aenter__ = AsyncMock(return_value=client)
        context.__aexit__ = AsyncMock(return_value=False)
        self.enterContext(patch.object(plugin.httpx, "AsyncClient", return_value=context))

    async def test_routes_authorized_message_and_preserves_topic(self):
        self.assertEqual((await plugin._dispatch(self.event, self.gateway))["action"], "skip")
        self.assertEqual(self.post.call_args.kwargs["json"]["senderId"], "sender")
        self.assertEqual(self.adapter.send.call_args.kwargs["metadata"], {"thread_id": "topic"})
        self.assertEqual(self.adapter.send.call_args.kwargs["content"], "Sentinel reply")

    async def test_unauthorized_sender_stays_with_native_auth(self):
        self.gateway._is_user_authorized_for_source.return_value = False
        self.assertIsNone(await plugin._dispatch(self.event, self.gateway))
        self.post.assert_not_awaited()

    async def test_outage_does_not_fall_through_to_local_agent(self):
        self.post.side_effect = OSError("offline")
        with self.assertLogs(plugin.log, logging.ERROR):
            self.assertEqual((await plugin._dispatch(self.event, self.gateway))["action"], "skip")
        self.assertIn("unavailable", self.adapter.send.call_args.kwargs["content"])

    async def test_completed_delivery_is_not_sent_twice(self):
        await plugin._dispatch(self.event, self.gateway)
        await plugin._dispatch(self.event, self.gateway)
        self.post.assert_awaited_once()
        self.adapter.send.assert_awaited_once()

    async def test_pause_is_honored(self):
        self.gateway._hm_estop_gate.return_value = "Paused"
        await plugin._dispatch(self.event, self.gateway)
        self.post.assert_not_awaited()
        self.assertEqual(self.adapter.send.call_args.kwargs["content"], "Paused")

    async def test_skill_shortcuts_go_through_sentinel(self):
        self.event.text = "/research topic"
        self.event.get_command = lambda: "research"
        self.assertEqual((await plugin._dispatch(self.event, self.gateway))["action"], "skip")
        self.post.assert_awaited_once()

    async def test_replies_use_native_retrying_delivery(self):
        self.adapter._send_with_retry = create_autospec(adapter_send, return_value=SimpleNamespace(success=True))
        await plugin._dispatch(self.event, self.gateway)
        self.assertEqual(self.adapter._send_with_retry.call_args.kwargs["content"], "Sentinel reply")
        self.adapter.send.assert_not_awaited()

    async def test_non_json_refusal_still_answers_sender(self):
        def not_json():
            raise ValueError("Expecting value")
        self.post.return_value = SimpleNamespace(status_code=502, json=not_json)
        with self.assertLogs(plugin.log, logging.ERROR):
            await plugin._dispatch(self.event, self.gateway)
        self.assertIn("HTTP 502", self.adapter.send.call_args.kwargs["content"])

    async def test_failed_delivery_is_logged_not_marked_delivered(self):
        self.adapter.send.return_value = SimpleNamespace(success=False, error="Bad Request: can't parse entities")
        with self.assertLogs(plugin.log, logging.ERROR) as logs:
            await plugin._dispatch(self.event, self.gateway)
        self.assertIn("can't parse entities", str(logs.records[0].exc_info[1]))
        self.adapter.send.return_value = SimpleNamespace(success=True)
        await plugin._dispatch(self.event, self.gateway)
        self.assertEqual(self.post.await_count, 2)

    async def test_native_maintenance_commands_stay_in_gateway(self):
        self.event.get_command = lambda: "status"
        self.assertIsNone(await plugin._dispatch(self.event, self.gateway))
        self.post.assert_not_awaited()


if __name__ == "__main__":
    unittest.main()
