"""Agent-guard kill switch. An unreadable switch is KILLED."""

from __future__ import annotations

import json
from pathlib import Path


class AgentGuardKill:
    def __init__(self, path: Path | None) -> None:
        self.path = path

    def poll(self) -> str:
        if self.path is None:
            return "killed"
        try:
            payload = json.loads(self.path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError, UnicodeError):
            return "killed"
        if isinstance(payload, dict) and payload.get("status") == "clear":
            return "clear"
        return "killed"
