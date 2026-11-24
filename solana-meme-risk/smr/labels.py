"""Known-entity labels (CEX hot wallets, routers/bots) loaded from data/labels/known_entities.json.
Every entry carries a citation (source_url) and verification timestamp; see tools/verify_labels.py."""
from __future__ import annotations
import json, os
from dataclasses import dataclass


@dataclass(frozen=True)
class Label:
    address: str
    name: str
    category: str      # cex | service
    source_url: str
    verified_at: str


class Labels:
    def __init__(self, path: str | None = None, entries: dict | None = None):
        raw = entries if entries is not None else (json.load(open(path)).get("entities", {}) if path and os.path.exists(path) else {})
        self._m = {a: Label(a, e.get("name") or "?", e.get("category") or "cex", e.get("source_url", ""), e.get("verified_at", ""))
                   for a, e in raw.items()}

    def get(self, addr: str | None) -> Label | None:
        return self._m.get(addr) if addr else None

    def is_non_linking(self, addr: str | None) -> bool:
        """CEX hot wallets and shared services must never link two wallets into a cluster."""
        return addr in self._m

    def name(self, addr):
        l = self.get(addr)
        return f"{l.name} ({l.category})" if l else None

    def __len__(self):
        return len(self._m)
