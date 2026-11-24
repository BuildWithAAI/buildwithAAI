"""SFX families. Each module exposes `render() -> list[Sound]` and a short `FAMILY` description.

Order matters only for the manifest: families are rendered in this order.
"""

from __future__ import annotations

import importlib

NAMES = ["whoosh", "ui", "keyboard", "desk", "notify", "rekt", "badger"]


def load(name: str):
    if name not in NAMES:
        raise ValueError(f"unknown family {name!r}; known: {', '.join(NAMES)}")
    return importlib.import_module(f"{__name__}.{name}")
