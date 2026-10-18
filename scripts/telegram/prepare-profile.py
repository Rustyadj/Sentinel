#!/usr/bin/env python3
"""Prepare ONLY a new managed profile. Never clone credentials, memory or history.

Run with Hermes' Python (PyYAML is already installed there). Create the target
first using `hermes profile create <name> --no-skills`, then pass its actual path.
"""
import argparse
from pathlib import Path
import shutil
import yaml


def prepare(source, target, plugin):
    source, target, plugin = Path(source).resolve(), Path(target).resolve(), Path(plugin).resolve()
    if source == target or target in source.parents:
        raise ValueError("Source and managed profile must be separate homes")
    if not (source / "config.yaml").is_file() or not plugin.is_dir():
        raise ValueError("Source config and read-only plugin directory must exist")
    if (target / "state.db").exists() or (target / ".sentinel-managed").exists() or any((target / item).exists() and any((target / item).iterdir()) for item in ["sessions", "memories"]):
        raise ValueError("Refusing to overwrite a used or previously managed profile")
    target.mkdir(parents=True, exist_ok=True)
    config = yaml.safe_load((source / "config.yaml").read_text()) or {}
    config["memory"] = {**config.get("memory", {}), "memory_enabled": False, "user_profile_enabled": False, "provider": ""}
    config["fallback_model"], config["fallback_providers"] = None, []
    config["approvals"] = {**config.get("approvals", {}), "mode": "manual"}
    config["plugins"] = {"enabled": ["sentinel-bot-gate"]}
    config["platform_toolsets"] = {"cli": ["web", "file", "vision", "sentinel_telegram", "skills", "todo", "clarify"]}
    # No platform adapter, old source history or credential-based Telegram path.
    config.pop("telegram", None)
    config["platforms"] = {}
    config.pop("mcp_servers", None)
    config.pop("mcp", None)
    (target / "config.yaml").write_text(yaml.safe_dump(config, sort_keys=False))
    if (source / "SOUL.md").is_file(): shutil.copy2(source / "SOUL.md", target / "SOUL.md")
    plugins = target / "plugins"
    plugins.mkdir(exist_ok=True)
    (plugins / "sentinel-bot-gate").symlink_to(plugin, target_is_directory=True)
    (target / ".sentinel-managed").write_text("Telegram memory authority: Sentinel; source history remains in the original Hermes profile.\n")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source"); parser.add_argument("target"); parser.add_argument("plugin")
    args = parser.parse_args()
    prepare(args.source, args.target, args.plugin)
    print("Managed profile prepared; original profile unchanged. Configure model credentials through protected launch environment.")
