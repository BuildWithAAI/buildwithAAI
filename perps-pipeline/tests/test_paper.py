import numpy as np
import pandas as pd

from perps.data.adapters.base import ExchangeAdapter, now_ms
from perps.data.models import InstrumentSpec
from perps.paper.engine import PaperEngine
from perps.paper.ledger import Ledger
from perps.reporting.status import build_status, status_markdown
from perps.strategies import REGISTRY

from .helpers import Scripted

H = 3_600_000


class FakeAdapter(ExchangeAdapter):
    name = "blofin"
    verified_live = True

    def __init__(self, n=300):
        last_open = (now_ms() // H) * H - H  # most recent CLOSED 1H bar
        ts = np.arange(last_open - (n - 1) * H, last_open + 1, H)
        self.bars = pd.DataFrame({"ts": ts, "open": 100.0, "high": 100.5, "low": 99.5, "close": 100.0,
                                  "volume": 1.0, "quote_volume": 100.0})
        self.last = 100.0

    def fetch_instruments(self):
        return [self.fetch_instrument("UNIT-USDT")]

    def fetch_instrument(self, symbol):
        return InstrumentSpec(exchange="blofin", symbol=symbol, exchange_symbol=symbol, base="UNIT", quote="USDT",
                              contract_value=1.0, min_size=0.001, lot_size=0.001, tick_size=0.01, max_leverage=50)

    def fetch_tickers(self):
        return pd.DataFrame([{"symbol": "UNIT-USDT", "last": self.last, "bid": self.last - 0.01,
                              "ask": self.last + 0.01, "quote_volume_24h": 1e6, "ts": now_ms()}])

    def fetch_candles_page(self, symbol, timeframe, end_ms, limit):
        return self.bars.copy()

    def fetch_candles(self, symbol, timeframe, start_ms, end_ms=None):
        return self.bars[self.bars.ts >= start_ms].reset_index(drop=True)

    def fetch_funding_page(self, symbol, end_ms, limit):
        return pd.DataFrame(columns=["ts", "funding_rate"])

    def fetch_open_interest(self, symbol):
        return pd.DataFrame(columns=["ts", "open_interest", "open_interest_ccy"])


def test_paper_open_then_stop_out_and_ledger(settings, monkeypatch):
    monkeypatch.setitem(REGISTRY, "scripted", Scripted)
    settings.strategies["scripted"] = {"params": {"signals": {-1: 1}, "stop_dist": 1.0, "take_profit_r": 0}}
    ad = FakeAdapter()
    eng = PaperEngine(settings, ad)
    out = eng.step("scripted", "1H", ["UNIT-USDT"])
    assert len(out.opened) == 1 and not out.errors
    o = out.opened[0]
    assert o["entry"] > 100.01  # ask + slippage
    assert abs(o["risk_usd"] - 1.5) < 0.01  # 1.5% of $100

    # same bar again -> no duplicate entry
    out2 = PaperEngine(settings, ad).step("scripted", "1H", ["UNIT-USDT"])
    assert not out2.opened

    # a new closed bar trades through the stop -> stopped out on replay
    settings.strategies["scripted"]["params"]["signals"] = {}
    nxt = int(ad.bars.ts.iloc[-1]) + H
    ad.bars = pd.concat([ad.bars, pd.DataFrame([{"ts": nxt, "open": 100.0, "high": 100.2, "low": 98.0,
                                                 "close": 98.5, "volume": 1.0, "quote_volume": 1.0}])],
                        ignore_index=True)
    ad.last = 98.5
    eng3 = PaperEngine(settings, ad)
    out3 = eng3.step("scripted", "1H", ["UNIT-USDT"])
    assert len(out3.closed) == 1 and out3.closed[0]["reason"] == "stop"
    assert -1.6 < out3.closed[0]["net_pnl"] < -1.3
    led = Ledger(settings.state_dir / "paper.sqlite")
    assert led.open_positions() == []
    assert abs(float(led.get("cash")) - (100 + out3.closed[0]["net_pnl"])) < 1e-6
    st = build_status(settings, ad)
    assert st["execution_enabled"] is False and st["paper"]["closed_trades"] == 1
    assert "Paper account" in status_markdown(st)


def test_paper_respects_kill_switch(settings, monkeypatch, tmp_path):
    monkeypatch.setitem(REGISTRY, "scripted", Scripted)
    settings.strategies["scripted"] = {"params": {"signals": {-1: 1}, "stop_dist": 1.0}}
    settings.risk.kill_switch = True
    out = PaperEngine(settings, FakeAdapter()).step("scripted", "1H", ["UNIT-USDT"])
    assert not out.opened and out.skipped[0]["reason"] == "manual kill switch"


def test_paper_tick_honours_global_agent_guard_kill(settings, monkeypatch, tmp_path):
    monkeypatch.setitem(REGISTRY, "scripted", Scripted)
    settings.strategies["scripted"] = {"params": {"signals": {-1: 1}, "stop_dist": 1.0}}
    settings.risk.kill_switch_file = None  # even with no local kill file configured
    g = tmp_path / "GLOBAL_KILL"
    monkeypatch.setenv("AGENT_GUARD_KILL_FILE", str(g))
    g.write_text("{}")
    out = PaperEngine(settings, FakeAdapter()).step("scripted", "1H", ["UNIT-USDT"])
    assert not out.opened and out.skipped[0]["reason"] == "manual kill switch"
    st = build_status(settings, None, offline=True)
    assert st["kill_switch"]["global_agent_guard"] is True
