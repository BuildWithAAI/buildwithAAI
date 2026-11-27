"""T8c aai-forex closed-trade ledger per book + T8d "forex book not running" silent INFO alarm. Tmp files only."""
import json, os, time
from datetime import datetime
from zoneinfo import ZoneInfo

import pytest

from aai import guard, sources, zoora
from aai.adapters.registry import build
from aai.hud import create_app

ROOT = os.path.dirname(os.path.dirname(__file__))
NY = ZoneInfo("America/New_York")


def _ny(*a):
    return datetime(*a, tzinfo=NY).timestamp()


def _trade(pair="EURUSD", side=1, net=50.0, r=1.0, exit_ts="2026-11-20T12:00:00+00:00", kind="TARGET"):
    return {"pair": pair, "side": side, "lots": 0.2, "entry_ts": "2026-11-18T00:00:00+00:00", "exit_ts": exit_ts,
            "entry_price": 1.07, "exit_price": 1.08, "exit_kind": kind, "gross_pnl": net + 2, "commission": 2.0,
            "net_pnl": net, "initial_risk": 50.0, "r_multiple": r, "bars_held": 7, "strategy": "trend_swing", "swap": 0.0}


def _book(tmp_path, name, last_bar="2026-11-20T00:00:00+00:00", trades=None, raw=None):
    d = tmp_path / "aai-forex" / "state" / "paper"
    d.mkdir(parents=True, exist_ok=True)
    (d / f"{name}.json").write_text(json.dumps({"broker": {"cash": 10000.0, "positions": [], "pending": []}, "equity": 10000.0,
                                                "last_seen": {"EURUSD": last_bar}, "risk": {"peak_equity": 10000.0}}))
    if trades is not None or raw is not None:
        (d / name).mkdir(exist_ok=True)
        p = d / name / "trades.jsonl"
        p.write_text(raw if raw is not None else "".join(json.dumps(t) + "\n" for t in trades))
        return p
    return d / f"{name}.json"


def test_ledger_counts_win_rate_sum_r_and_read_only(tmp_path):
    p = _book(tmp_path, "trend_swing", trades=[
        _trade(net=50.0, r=1.0, exit_ts="2026-11-20T12:00:00+00:00"),
        _trade(pair="USDJPY", side=-1, net=-26.0, r=-0.52, exit_ts="2026-11-22T12:00:00+00:00", kind="STOP"),
        _trade(net=101.5, r=2.03, exit_ts="2026-11-21T12:00:00+00:00")])
    with open(p, "a") as f:
        f.write("{bad json\n" + json.dumps({"pair": "EURUSD", "net_pnl": "12"}) + "\n" + '{"net_pnl": NaN, "r_multiple": 1}\n\n')
    before = (os.path.getmtime(p), os.path.getsize(p))
    L = sources.forex_book(str(p.parent.parent / "trend_swing.json"))["ledger"]
    assert L["status"] == "ok" and L["closed"] == 3 and L["wins"] == 2 and L["win_rate"] == 66.7
    assert L["sum_r"] == 2.51 and L["avg_r"] == 0.84 and L["net_pnl"] == 125.5 and L["bad"] == 3 and not L["partial"]
    assert L["last_exit"] == sources._ts("2026-11-22T12:00:00+00:00")
    assert [t["pair"] for t in L["recent"]] == ["USDJPY", "EURUSD", "EURUSD"] and L["recent"][0]["side"] == "SHORT"
    assert L["recent"][0]["exit_kind"] == "STOP" and set(L["recent"][0]) == {"pair", "side", "exit_kind", "r", "net", "entry_ts", "exit_ts", "bars_held"}
    assert (os.path.getmtime(p), os.path.getsize(p)) == before


def test_ledger_missing_empty_and_tail_cap(tmp_path, monkeypatch):
    p = _book(tmp_path, "session_breakout")
    L = sources.forex_book(str(p))["ledger"]
    assert L["status"] == "none" and L["closed"] == 0 and L["win_rate"] is None and L["recent"] == []
    _book(tmp_path, "empty", raw="")
    assert sources.forex_ledger(str(tmp_path / "aai-forex" / "state" / "paper" / "empty"))["status"] == "empty"
    monkeypatch.setattr(sources, "FX_LEDGER_MAX_BYTES", 2000)
    lp = _book(tmp_path, "big", trades=[_trade(r=0.1, net=1.0) for _ in range(60)])
    L = sources.forex_ledger(str(lp.parent))
    assert L["partial"] and 0 < L["closed"] < 60 and L["bad"] == 0     # only the newest ~2000 bytes, no half line


def test_fx_market_open_week():
    assert not zoora.fx_market_open(_ny(2026, 11, 28, 12))     # Saturday
    assert not zoora.fx_market_open(_ny(2026, 11, 29, 16))     # Sunday before 17:00 NY
    assert zoora.fx_market_open(_ny(2026, 11, 29, 17, 5))      # Sunday open
    assert zoora.fx_market_open(_ny(2026, 11, 25, 3))          # Wednesday
    assert zoora.fx_market_open(_ny(2026, 11, 27, 13))         # Friday before the close
    assert not zoora.fx_market_open(_ny(2026, 11, 27, 17, 30))  # Friday after the close


def test_not_running_books():
    now = _ny(2026, 11, 25, 12)
    fx = {"paper": [{"book": "trend_swing", "last_bar": now - 5 * 86400}, {"book": "h4", "last_bar": now - 3600},
                    {"book": "broken", "error": "unreadable", "last_bar": None}, {"book": "new", "last_bar": None},
                    {"book": "session_breakout", "last_bar": now - 28 * 86400}]}
    out = zoora.fx_not_running(fx, now)
    assert [x["book"] for x in out] == ["session_breakout", "trend_swing"] and out[1]["age_sec"] == 5 * 86400
    assert zoora.fx_not_running(fx, _ny(2026, 11, 28, 12)) == []    # weekend: the market is shut, no alarm
    assert zoora.fx_not_running({"paper": [{"book": "a", "last_bar": now - 3.9 * 86400}]}, now) == []
    assert zoora.fx_not_running(None, now) == []


def test_voice_books_line():
    now = time.time()
    ov = {"now": now, "ext": {"forex": {"paper": [
        {"book": "a", "open": 0, "last_bar": now - 3600, "ledger": {"closed": 2, "wins": 1, "sum_r": 1.5}},
        {"book": "b", "open": 1, "last_bar": now - 3600, "ledger": {"closed": 1, "wins": 1, "sum_r": 0.75}},
        {"book": "bad", "error": "unreadable"}]}}}
    s = zoora.Zoora._fx_books_line(ov)
    assert "2 forex paper books are holding 1 open position" in s and "3 closed trades logged, 67% winners, +2.2R" in s
    assert "not running" not in s
    flat = {"now": _ny(2026, 11, 25, 12), "ext": {"forex": {"paper": [{"book": "a", "open": 0, "last_bar": _ny(2026, 10, 30, 12), "ledger": {"closed": 0}}]}}}
    s = zoora.Zoora._fx_books_line(flat)
    assert "is all flat, with no closed trades logged yet" in s and "It stopped processing bars; the newest is 26.0 days old" in s and "not running" in s
    assert zoora.Zoora._fx_books_line({"ext": {}}) == ""


@pytest.fixture
def client(cfg, store, monkeypatch):
    monkeypatch.delenv("AAI_HUD_TOKEN", raising=False)
    monkeypatch.delenv("XAI_API_KEY", raising=False)
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    old = sources._ts("2026-10-30T21:00:00+00:00")
    ext = {"forex": {"name": "aai-forex", "status": "ok", "stale": False, "age_sec": 60, "ts": time.time() - 60, "signals": [],
                     "bias": [], "kill_switch": False,
                     "paper": [{"book": "trend_swing", "last_bar": old, "open": 0, "pending": 0, "ledger": {"closed": 0, "status": "none"}},
                               {"book": "session_breakout", "last_bar": old, "open": 0, "pending": 0, "ledger": {"closed": 0, "status": "none"}}]},
           "agent_guard": {"name": "agent-guard", "status": "ok", "highs": [], "summary": {}, "global_kill_switch": False}}
    monkeypatch.setattr(sources, "cheap_all", lambda: json.loads(json.dumps(ext)))
    monkeypatch.setattr(guard, "global_kill", lambda: {"engaged": False, "reason": None})
    monkeypatch.setattr(zoora, "fx_market_open", lambda now: True)
    ad = build(cfg, store)
    ad["solana_meme"].health = lambda quick=True: {"ok": True}
    return create_app(cfg, store, ad, heavy=False).test_client()


def test_overview_one_silent_info_alarm_and_voice(client):
    ov = client.get("/api/zoora/overview").json
    al = [a for a in ov["alerts"] if a["id"].startswith("fx_stopped_")]
    assert len(al) == 1 and al[0]["sev"] == "info" and not al[0].get("chime") and al[0]["title"] == "Forex paper books not running"
    assert "session breakout last bar Oct 30" in al[0]["detail"] and "trend swing last bar Oct 30" in al[0]["detail"]
    assert "Zoora never runs the forex scan" in al[0]["detail"]
    again = client.get("/api/zoora/overview").json
    assert [a["id"] for a in again["alerts"] if a["id"].startswith("fx_stopped_")] == [al[0]["id"]]   # stable id, no re-raise
    r = client.post("/api/zoora", json={"text": "any forex ideas?", "source": "test"})
    assert r.status_code == 200 and "forex scan is not running" in r.json["reply"]


def test_hud_wiring_textcontent_only():
    js = open(os.path.join(ROOT, "aai", "static", "zoora", "zoora.js")).read()
    body = js[js.index("function fxLedgerCell(L)"):js.index("function renderSecurity(ov)")]
    assert "innerHTML" not in body and "fxLedgerCell(b.ledger)" in body and "CLOSED" in body and "colspan: 7" in body
