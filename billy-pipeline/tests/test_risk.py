from datetime import datetime, timezone

import pandas as pd
import pytest
from pydantic import ValidationError

from billy.config import RiskCfg
from billy.risk import OpenRisk, RiskEngine, rolling_corr

T = datetime(2026, 10, 7, 12, tzinfo=timezone.utc)  # Wednesday


def eng(**kw):
    base = dict(max_notional_per_trade_pct=1000, max_gross_notional_pct=2000)
    base.update(kw)
    return RiskEngine(RiskCfg(**base))


def test_base_and_confirmed_tiers():
    e = eng()
    d = e.size(ts=T, equity=10_000, asset="BTC", side="long", entry=100, stop=98, confirmed=False, open_positions=[])
    assert d.approved and d.risk_pct == pytest.approx(1.0) and d.qty == pytest.approx(50)
    d = e.size(ts=T, equity=10_000, asset="BTC", side="long", entry=100, stop=98, confirmed=True, open_positions=[])
    assert d.risk_pct == pytest.approx(2.0) and d.tier == "confirmed"


def test_total_open_risk_cap_3pct():
    e = eng()
    opens = [OpenRisk("ETH", "long", 200, 1000)]
    d = e.size(ts=T, equity=10_000, asset="BTC", side="long", entry=100, stop=98, confirmed=True, open_positions=opens)
    assert d.approved and d.risk_pct == pytest.approx(1.0) and "clipped_to_total_risk_cap" in d.notes
    opens = [OpenRisk("ETH", "long", 290, 1000)]
    d = e.size(ts=T, equity=10_000, asset="BTC", side="long", entry=100, stop=98, confirmed=False, open_positions=opens)
    assert not d.approved and d.reason == "total_risk_cap"


def test_hard_caps_in_config():
    with pytest.raises(ValidationError):
        RiskCfg(max_trade_risk_pct=5)
    with pytest.raises(ValidationError):
        RiskCfg(max_total_risk_pct=4)
    with pytest.raises(ValidationError):
        RiskCfg(confirmed_risk_pct=3.5)


def test_invalid_stop_and_asset_limit():
    e = eng()
    assert e.size(ts=T, equity=1e4, asset="BTC", side="long", entry=100, stop=101, confirmed=False,
                  open_positions=[]).reason == "invalid_stop"
    assert e.size(ts=T, equity=1e4, asset="BTC", side="short", entry=100, stop=99, confirmed=False,
                  open_positions=[]).reason == "invalid_stop"
    assert e.size(ts=T, equity=1e4, asset="BTC", side="long", entry=100, stop=99, confirmed=False,
                  open_positions=[OpenRisk("BTC", "long", 0, 0)]).reason == "asset_position_limit"
    assert e.size(ts=T, equity=0, asset="BTC", side="long", entry=100, stop=99, confirmed=False,
                  open_positions=[]).reason == "no_equity"


def test_notional_cap_clips_risk():
    e = RiskEngine(RiskCfg(max_notional_per_trade_pct=100))
    d = e.size(ts=T, equity=10_000, asset="BTC", side="long", entry=100, stop=99.5, confirmed=False, open_positions=[])
    assert d.approved and d.notional_usd == pytest.approx(10_000) and d.risk_pct == pytest.approx(0.5)
    d = e.size(ts=T, equity=10_000, asset="BTC", side="long", entry=100, stop=99.95, confirmed=False, open_positions=[])
    assert d.reason == "size_too_small"
    full = [OpenRisk("ETH", "long", 0, 20_000)]
    d = e.size(ts=T, equity=10_000, asset="BTC", side="long", entry=100, stop=99, confirmed=False, open_positions=full)
    assert d.reason == "gross_notional_cap"


def test_daily_kill_switch():
    e = eng()
    e.on_equity(T.replace(hour=0), 10_000)
    e.on_equity(T.replace(hour=5), 9_650)
    assert e.kill_switch_active(T)
    assert e.size(ts=T, equity=9_650, asset="BTC", side="long", entry=100, stop=98, confirmed=False,
                  open_positions=[]).reason == "daily_loss_kill_switch"
    assert not e.kill_switch_active(T.replace(day=8))


def test_correlation_haircut_and_no_lookahead():
    idx = pd.date_range("2026-08-01", periods=60, freq="1D", tz="UTC")
    base = pd.Series(range(100, 160), index=idx, dtype=float) * (1 + 0.01 * (pd.Series(range(60), index=idx) % 3))
    corr = rolling_corr({"BTC": base, "ETH": base * 2}, idx[40].to_pydatetime(), 30)
    assert corr.loc["BTC", "ETH"] == pytest.approx(1.0)
    assert rolling_corr({"BTC": base}, idx[3].to_pydatetime(), 30).empty
    e = eng()
    d = e.size(ts=T, equity=1e4, asset="ETH", side="long", entry=100, stop=98, confirmed=False,
               open_positions=[OpenRisk("BTC", "long", 100, 1000)], corr=corr)
    assert d.risk_pct == pytest.approx(0.5) and d.notes[0].startswith("corr_haircut")
    d = e.size(ts=T, equity=1e4, asset="ETH", side="long", entry=100, stop=98, confirmed=False,
               open_positions=[OpenRisk("BTC", "short", 100, 1000)], corr=corr)
    assert d.risk_pct == pytest.approx(1.0)


def test_weekend_mult():
    e = eng(weekend_size_mult=0.5)
    sat = datetime(2026, 10, 10, 12, tzinfo=timezone.utc)
    d = e.size(ts=sat, equity=1e4, asset="BTC", side="long", entry=100, stop=98, confirmed=False, open_positions=[])
    assert d.risk_pct == pytest.approx(0.5)
