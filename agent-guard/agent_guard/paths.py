"""Filesystem locations. Override the root with AGENT_GUARD_HOME (tests, or a copy on another PC)."""
from __future__ import annotations

import os
from pathlib import Path

DEFAULT_HOME = Path(__file__).resolve().parents[1]


def home() -> Path:
    return Path(os.environ.get("AGENT_GUARD_HOME") or DEFAULT_HOME)


def state_dir() -> Path:
    return home() / "state"


def kill_file() -> Path:
    return Path(os.environ.get("AGENT_GUARD_KILL_FILE") or (state_dir() / "KILL_SWITCH"))


def audit_file() -> Path:
    return state_dir() / "audit.jsonl"


def config_file() -> Path:
    return Path(os.environ.get("AGENT_GUARD_CONFIG") or (home() / "config" / "limits.json"))


def approvals_dir() -> Path:
    return home() / "approvals"
