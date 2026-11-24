import ast
from pathlib import Path

import pytest

from billy.config import LIVE_CONFIRMATION_PHRASE, ExecutionCfg
from billy.execution import ExecutionAdapter, LiveAdapterStub, LiveTradingDisabled, Order, PaperBroker, get_adapter

SRC = Path(__file__).resolve().parents[1] / "src" / "billy"


def order(**kw):
    base = dict(asset="BTC", side="long", order_type="stop_entry", qty=0.1, entry=80000, stop=79000, target=82000,
                risk_usd=100, risk_pct=1.0, tier="base", post_id="1", url="u")
    base.update(kw)
    return Order(**base)


def test_paper_broker_ledger_and_dedupe(settings):
    b = get_adapter(settings)
    assert isinstance(b, PaperBroker) and isinstance(b, ExecutionAdapter)
    assert b.submit(order())["status"] == "accepted_paper"
    assert b.submit(order())["status"] == "duplicate_ignored"
    assert len(b.open_orders()) == 1
    with pytest.raises(ValueError):
        b.submit(order(mode="live"))


def test_live_is_off_by_default_and_refuses():
    assert ExecutionCfg().live_enabled is False and ExecutionCfg().mode == "paper"


def test_live_flag_without_phrase_raises(settings):
    settings.execution.live_enabled = True
    with pytest.raises(LiveTradingDisabled):
        get_adapter(settings)


def test_live_stub_always_raises_even_when_confirmed(settings):
    settings.execution.live_enabled = True
    settings.execution.live_confirmation = LIVE_CONFIRMATION_PHRASE
    a = get_adapter(settings)
    assert isinstance(a, LiveAdapterStub)
    with pytest.raises(LiveTradingDisabled):
        a.submit(order())
    with pytest.raises(LiveTradingDisabled):
        a.open_orders()


def test_mode_cannot_be_live():
    with pytest.raises(Exception):
        ExecutionCfg(mode="live")


def test_no_exchange_order_code_anywhere():
    """Static guard: no trading endpoints, signing or key handling in the package."""
    banned = ["/api/v3/order", "/fapi/", "X-MBX-APIKEY", "hmac", "api_secret", "ccxt", "BINANCE_API"]
    for f in SRC.rglob("*.py"):
        txt = f.read_text()
        for b in banned:
            assert b not in txt, f"{b} found in {f}"
    tree = ast.parse((SRC / "execution" / "live_stub.py").read_text())
    imports = {n.names[0].name for n in ast.walk(tree) if isinstance(n, ast.Import)}
    imports |= {n.module for n in ast.walk(tree) if isinstance(n, ast.ImportFrom) and n.module}
    assert not ({"requests", "urllib", "httpx", "aiohttp", "socket"} & imports)
