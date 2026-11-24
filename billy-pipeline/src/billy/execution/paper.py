"""Paper broker: records conditional orders to a JSONL ledger. Never touches a network."""
from __future__ import annotations

import json
from pathlib import Path

from .base import Order


class PaperBroker:
    name = "paper"

    def __init__(self, ledger: Path):
        self.ledger = Path(ledger)

    def submit(self, order: Order) -> dict:
        if order.mode != "paper":
            raise ValueError("PaperBroker only accepts paper orders")
        self.ledger.parent.mkdir(parents=True, exist_ok=True)
        rec = order.to_dict() | {"status": "accepted_paper"}
        key = (order.post_id, order.asset, order.side, round(order.entry, 8))
        for r in self.open_orders():
            if (r["post_id"], r["asset"], r["side"], round(r["entry"], 8)) == key:
                return r | {"status": "duplicate_ignored"}
        with open(self.ledger, "a") as f:
            f.write(json.dumps(rec) + "\n")
        return rec

    def open_orders(self) -> list[dict]:
        if not self.ledger.exists():
            return []
        return [json.loads(x) for x in self.ledger.read_text().splitlines() if x.strip()]
