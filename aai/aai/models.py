from __future__ import annotations
import time, uuid
from dataclasses import dataclass, field, asdict

# Trading sectors only. Long-term holdings are a separate capital bucket (aai/longterm.py), never a trading sector.
SECTORS = ("solana_meme", "perps", "billy", "forex", "stocks")
NON_TRADING_BUCKETS = ("longterm",)


@dataclass
class Idea:
    sector: str
    symbol: str
    side: str                       # "long" | "short"
    entry: float
    stop: float | None              # None only allowed for full-loss sectors (solana_meme)
    target: float | None = None
    source: str = "manual"
    venue: str | None = None
    requested_risk: float | None = None   # fraction of equity; clamped to [1%, 3%]
    rationale: str = ""
    signal_id: int | None = None
    payload: dict = field(default_factory=dict)
    ts: float = field(default_factory=time.time)
    id: str = field(default_factory=lambda: "idea_" + uuid.uuid4().hex[:12])

    def to_dict(self):
        return asdict(self)

    @classmethod
    def from_dict(cls, d: dict) -> "Idea":
        keys = cls.__dataclass_fields__.keys()
        d = {k: v for k, v in d.items() if k in keys}
        for k in ("entry", "stop", "target", "requested_risk"):
            if d.get(k) is not None:
                d[k] = float(d[k])
        return cls(**d)


@dataclass
class Check:
    name: str
    passed: bool
    detail: str

    def to_dict(self):
        return {"name": self.name, "pass": self.passed, "detail": self.detail}


@dataclass
class Decision:
    idea_id: str
    approved: bool
    checks: list[Check]
    risk_frac: float = 0.0
    risk_usd: float = 0.0
    qty: float = 0.0
    notional: float = 0.0
    fill_px_est: float | None = None
    inputs: dict = field(default_factory=dict)

    @property
    def reasons(self):
        return [f"{'PASS' if c.passed else 'FAIL'} {c.name}: {c.detail}" for c in self.checks]

    @property
    def failed(self):
        return [c.name for c in self.checks if not c.passed]

    def to_dict(self):
        return {"idea_id": self.idea_id, "approved": self.approved, "risk_frac": self.risk_frac, "risk_usd": self.risk_usd,
                "qty": self.qty, "notional": self.notional, "fill_px_est": self.fill_px_est,
                "checks": [c.to_dict() for c in self.checks], "failed": self.failed}
