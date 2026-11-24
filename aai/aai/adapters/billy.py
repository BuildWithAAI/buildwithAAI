"""Read-only view of /workspace/billy research. Rules are UNVALIDATED; the risk engine rejects billy ideas."""
from __future__ import annotations
import csv, os, collections
from .base import Adapter


class BillyAdapter(Adapter):
    name, sector = "billy_research", "billy"

    def __init__(self, cfg, store=None):
        super().__init__(cfg, store)
        self.path = cfg["adapters"]["billy"]["repo_path"]

    def calls(self) -> list[dict]:
        with open(os.path.join(self.path, "calls.csv"), newline="") as f:
            return list(csv.DictReader(f))

    def summary(self) -> dict:
        rows = self.calls()
        c = collections.Counter(r.get("outcome") for r in rows)
        return {"calls": len(rows), "outcomes": dict(c), "research_status": "research_only_unvalidated",
                "source": os.path.join(self.path, "calls.csv")}

    def health(self) -> dict:
        need = ["calls.csv", "rules_draft.md", "style_profile.md"]
        missing = [n for n in need if not os.path.exists(os.path.join(self.path, n))]
        if missing:
            return {"ok": False, "status": "missing", "detail": missing}
        return {**self.summary(), "ok": True, "status": "pass", "research_status": "research_only_unvalidated"}
