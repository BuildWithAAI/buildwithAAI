"""Execution interface. Only the paper broker is functional; see live_stub.py."""
from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from typing import Protocol, runtime_checkable

from ..config import LIVE_CONFIRMATION_PHRASE, Settings


class LiveTradingDisabled(RuntimeError):
    pass


@dataclass
class Order:
    asset: str
    side: str
    order_type: str  # "stop_entry" | "limit_entry" | "market"
    qty: float
    entry: float
    stop: float
    target: float
    risk_usd: float
    risk_pct: float
    tier: str
    post_id: str
    url: str
    created_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat(timespec="seconds"))
    mode: str = "paper"

    def to_dict(self) -> dict:
        return asdict(self)


@runtime_checkable
class ExecutionAdapter(Protocol):
    name: str

    def submit(self, order: Order) -> dict: ...

    def open_orders(self) -> list[dict]: ...


def _require_agent_guard() -> None:
    """Live path only: refuse unless agent-guard is importable and the global kill switch is off.
    A future live adapter must also call agent_guard.check_order() per order (see SECURITY_POLICY.md)."""
    import os
    import sys
    sys.path.insert(0, os.environ.get("AGENT_GUARD_PATH", "/workspace/agent-guard"))
    try:
        from agent_guard import killswitch
    except Exception as exc:  # noqa: BLE001
        raise LiveTradingDisabled(f"agent-guard not importable ({exc}); live trading refused (fail closed)") from exc
    try:
        killswitch.require_not_engaged("billy", "enable live adapter")
    except Exception as exc:  # noqa: BLE001
        raise LiveTradingDisabled(str(exc)) from exc


def get_adapter(settings: Settings) -> ExecutionAdapter:
    """Always returns the paper broker. A live request raises unless BOTH the config flag and the
    exact confirmation phrase are set, and even then the stub refuses (no live adapter exists)."""
    from .live_stub import LiveAdapterStub
    from .paper import PaperBroker

    ex = settings.execution
    if ex.live_enabled:
        if ex.live_confirmation != LIVE_CONFIRMATION_PHRASE:
            raise LiveTradingDisabled("live_enabled=true but live_confirmation phrase missing/wrong")
        _require_agent_guard()  # agent-guard: fail closed on the live path (kill switch + guard importable)
        return LiveAdapterStub(settings)
    return PaperBroker(settings.paths.paper_ledger)
