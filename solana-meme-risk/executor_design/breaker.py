"""Circuit breaker: halts NEW BUYs automatically; only a manual owner reset clears it. SELLs are unaffected.

Thresholds are PROPOSED, pending Zoorped's explicit confirmation. Pure Python; the real executor persists
the state file under C:\\ProgramData\\solexec\\state\\breaker.json (ACL: executor user only)."""
from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field
from pathlib import Path


@dataclass(frozen=True)
class BreakerConfig:  # PROPOSED
    max_consecutive_losses: int = 4
    max_consecutive_exec_errors: int = 3        # send errors + simulation errors + inspector rejections
    max_drawdown_pct_of_deposit: float = 0.20   # equity peak-to-now, as fraction of owner deposit basis
    max_consecutive_rpc_failures: int = 3       # health probe: getHealth/getSlot/blockhash fetch failures


@dataclass
class Breaker:
    cfg: BreakerConfig = field(default_factory=BreakerConfig)
    deposit_basis_usd: float | None = None
    tripped: bool = False
    reason: str | None = None
    consecutive_losses: int = 0
    consecutive_exec_errors: int = 0
    consecutive_rpc_failures: int = 0
    equity_peak_usd: float | None = None
    history: list = field(default_factory=list)

    def _trip(self, reason: str):
        if not self.tripped:
            self.tripped, self.reason = True, reason
            self.history.append({"event": "trip", "reason": reason})

    def record_trade_closed(self, pnl_usd: float):
        self.consecutive_losses = self.consecutive_losses + 1 if pnl_usd < 0 else 0
        if self.consecutive_losses >= self.cfg.max_consecutive_losses:
            self._trip(f"consecutive_losses>={self.cfg.max_consecutive_losses}")

    def record_exec_result(self, ok: bool, kind: str = "send"):
        self.consecutive_exec_errors = 0 if ok else self.consecutive_exec_errors + 1
        if self.consecutive_exec_errors >= self.cfg.max_consecutive_exec_errors:
            self._trip(f"consecutive_exec_errors>={self.cfg.max_consecutive_exec_errors} (last={kind})")

    def record_rpc_health(self, ok: bool):
        self.consecutive_rpc_failures = 0 if ok else self.consecutive_rpc_failures + 1
        if self.consecutive_rpc_failures >= self.cfg.max_consecutive_rpc_failures:
            self._trip(f"rpc_unhealthy>={self.cfg.max_consecutive_rpc_failures}")

    def record_equity(self, equity_usd: float):
        self.equity_peak_usd = equity_usd if self.equity_peak_usd is None else max(self.equity_peak_usd, equity_usd)
        if not self.deposit_basis_usd:
            self._trip("deposit_basis_unset")
            return
        if self.equity_peak_usd - equity_usd >= self.cfg.max_drawdown_pct_of_deposit * self.deposit_basis_usd:
            self._trip(f"drawdown>={self.cfg.max_drawdown_pct_of_deposit:.0%}_of_deposit")

    def reset(self, *, confirm: str, actor: str):
        """Manual only. Requires the literal confirmation and an owner actor; counters are cleared."""
        if confirm != "RESET" or actor != "owner":
            raise PermissionError("breaker reset requires confirm='RESET' and actor='owner'")
        self.history.append({"event": "reset", "prior_reason": self.reason, "actor": actor})
        self.tripped, self.reason = False, None
        self.consecutive_losses = self.consecutive_exec_errors = self.consecutive_rpc_failures = 0

    def save(self, path: Path):
        path.write_text(json.dumps(asdict(self), default=str))

    @classmethod
    def load(cls, path: Path) -> "Breaker":
        d = json.loads(path.read_text())
        d["cfg"] = BreakerConfig(**d["cfg"])
        return cls(**d)
