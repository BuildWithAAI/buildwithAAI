"""Agent-guard kill switch.

A `killed` file in the guard directory means killed. Its absence is not, by
itself, a clear: the heartbeat must also be fresh. An unreadable directory,
heartbeat, or timestamp counts as killed. Deleting `killed` while the
heartbeat is fresh is a real clear.
"""

from __future__ import annotations

import json
import time
from collections.abc import Callable
from pathlib import Path

HEARTBEAT_MAX_MS = 15_000
_FUTURE_MS = 2_000


class AgentGuardKill:
    def __init__(self, root: Path | None, now_ms: Callable[[], int] | None = None) -> None:
        self.root = root
        self._now = now_ms or (lambda: time.time_ns() // 1_000_000)

    def poll(self) -> str:
        if self.root is None or not self.root.is_dir():
            return "killed"
        try:
            if (self.root / "killed").exists():
                return "killed"
            payload = json.loads((self.root / "heartbeat.json").read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError, UnicodeError):
            return "killed"
        if not isinstance(payload, dict) or type(payload.get("ts_ms")) is not int:
            return "killed"
        age = self._now() - int(payload["ts_ms"])
        if age < -_FUTURE_MS or age > HEARTBEAT_MAX_MS:
            return "killed"
        return "clear"
