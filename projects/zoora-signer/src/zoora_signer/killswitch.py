"""Agent-guard kill switch.

Agent-guard's ``engage()`` is not in this repository. The contract from the
Head of Systems review is the file it writes: ``state/KILL_SWITCH``, with no
heartbeat. Presence of that file, of ``killed``, or of the file named by
``AGENT_GUARD_KILL_FILE`` is killed. Any unreadable or ambiguous path is
killed. A clear requires none of those files and a fresh heartbeat written by
``zoora_signer.heartbeat.write_heartbeat``.
"""

from __future__ import annotations

import json
import os
import time
from collections.abc import Callable
from pathlib import Path

from zoora_signer.heartbeat import HEARTBEAT_NAME, permissions_ok

HEARTBEAT_MAX_MS = 15_000
_FUTURE_MS = 2_000
ENV_KILL_FILE = "AGENT_GUARD_KILL_FILE"


class AgentGuardKill:
    def __init__(self, root: Path | None, now_ms: Callable[[], int] | None = None) -> None:
        self.root = root
        self._now = now_ms or (lambda: time.time_ns() // 1_000_000)

    def poll(self) -> str:
        if self.root is None or not self.root.is_dir():
            return "killed"
        for path in self._kill_files():
            present = _file_present(path)
            if present is None or present:
                return "killed"
        heartbeat = self.root / HEARTBEAT_NAME
        try:
            if not permissions_ok(heartbeat):
                return "killed"
            payload = json.loads(heartbeat.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError, UnicodeError):
            return "killed"
        if not isinstance(payload, dict) or type(payload.get("ts_ms")) is not int:
            return "killed"
        if payload.get("status", "clear") != "clear":
            return "killed"
        age = self._now() - int(payload["ts_ms"])
        if age < -_FUTURE_MS or age > HEARTBEAT_MAX_MS:
            return "killed"
        return "clear"

    def _kill_files(self) -> list[Path]:
        assert self.root is not None
        paths = [self.root / "killed", self.root / "state" / "KILL_SWITCH"]
        named = os.environ.get(ENV_KILL_FILE)
        if named:
            paths.append(Path(named))
        return paths


def _file_present(path: Path) -> bool | None:
    """True when the kill file exists, False when it does not, None if unreadable."""

    try:
        return path.is_file()
    except OSError:
        return None
