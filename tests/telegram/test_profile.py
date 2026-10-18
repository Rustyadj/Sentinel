import importlib.util
from pathlib import Path
import tempfile
import unittest
import yaml

spec = importlib.util.spec_from_file_location("profile_preparation", Path(__file__).resolve().parents[2] / "scripts/telegram/prepare-profile.py")
profile = importlib.util.module_from_spec(spec)
spec.loader.exec_module(profile)

class ProfileTests(unittest.TestCase):
    def test_only_personality_and_config_are_copied_not_memory_or_tokens(self):
        with tempfile.TemporaryDirectory() as folder:
            source, target, plugin = (Path(folder) / name for name in ["original", "managed", "plugin"])
            source.mkdir(); plugin.mkdir()
            (source / "config.yaml").write_text(yaml.safe_dump({"model": "existing-model", "memory": {"memory_enabled": True}, "mcp_servers": {"secret": "server"}}))
            (source / "SOUL.md").write_text("Existing Lisa personality")
            (source / ".env").write_text("TELEGRAM_BOT_TOKEN=never-copy")
            (source / "memories").mkdir(); (source / "memories/MEMORY.md").write_text("Private memory")
            before = (source / "config.yaml").read_bytes()
            profile.prepare(source, target, plugin)
            cfg = yaml.safe_load((target / "config.yaml").read_text())
            self.assertEqual(cfg["model"], "existing-model")
            self.assertFalse(cfg["memory"]["memory_enabled"])
            self.assertFalse(cfg["memory"]["user_profile_enabled"])
            self.assertEqual((target / "SOUL.md").read_text(), "Existing Lisa personality")
            self.assertFalse((target / ".env").exists()); self.assertFalse((target / "memories").exists())
            self.assertEqual((source / "config.yaml").read_bytes(), before)
            with self.assertRaises(ValueError): profile.prepare(source, target, plugin)

if __name__ == "__main__": unittest.main()
