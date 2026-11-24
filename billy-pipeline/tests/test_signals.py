from datetime import datetime, timezone

import pytest

from billy.models import Scenario, Signal
from billy.signals import build_candidates, notify_discord, render_markdown
from billy.signals.today import to_orders
from billy.strategy import EventCalendar


class Sess:
    def __init__(self, status=204):
        self.calls, self.status = [], status

    def post(self, url, json, timeout):
        self.calls.append((url, json))
        return type("R", (), {"status_code": self.status})()


def test_discord_noop_when_unset(monkeypatch):
    monkeypatch.delenv("DISCORD_WEBHOOK_URL", raising=False)
    s = Sess()
    assert notify_discord("hi", session=s) is False and s.calls == []


def test_discord_refuses_non_discord_url(monkeypatch):
    monkeypatch.setenv("DISCORD_WEBHOOK_URL", "https://evil.example.com/hook")
    s = Sess()
    assert notify_discord("hi", session=s) is False and s.calls == []


def test_discord_posts_truncated(monkeypatch):
    monkeypatch.setenv("DISCORD_WEBHOOK_URL", "https://discord.com/api/webhooks/1/abc")
    s = Sess()
    assert notify_discord("x" * 5000, session=s) is True
    assert len(s.calls[0][1]["content"]) <= 1900


def _sig(pid, asset, ts, side, level, bias=1, target=None):
    return Signal(post_id=pid, asset=asset, post_ts=ts, url=f"https://x.com/cryptoWZRD_/status/{pid}",
                  close_label="bullish", bias=bias, parse_status="actionable",
                  scenarios=[Scenario(side=side, cond="above" if side == "long" else "below", level=level,
                                      target=target, kind="breakout", explicit=True)])


def test_candidates_sized_and_labelled(settings, mk_md):
    md = mk_md({"BTC": [100.0] * 80, "ETH": [98.5, 99.5] * 40})
    settings.assets = ["BTC", "ETH"]
    now = md.h1["ETH"].index[-1].to_pydatetime()
    post = md.h1["ETH"].index[-5].to_pydatetime()
    two = _sig("11", "ETH", post, "long", 100.0, bias=0, target=104.0)
    two.scenarios.append(Scenario(side="short", cond="below", level=98.0, kind="breakout", explicit=True))
    sigs = [two]
    cal = EventCalendar.from_yaml(settings.paths.events_file)
    p = build_candidates(sigs, md, settings, cal, now=now)
    assert "EXAMPLE" in p["EXAMPLE_ONLY"] and p["equity_example"] == 10_000
    assert len(p["candidates"]) == 2 and all(c["status"] == "waiting" for c in p["candidates"])
    acts = [c for c in p["candidates"] if c["actionable"]]
    assert acts and all(c["risk_pct"] <= 3.0 for c in acts)
    assert p["total_open_risk_pct_if_all_filled"] <= 3.0
    md_txt = render_markdown(p)
    assert "EXAMPLE ONLY" in md_txt and "ETH" in md_txt
    orders = to_orders(p)
    assert orders and all(o.mode == "paper" and o.order_type == "stop_entry" for o in orders)


def test_candidates_empty(settings, mk_md):
    md = mk_md({"BTC": [100.0] * 30})
    settings.assets = ["BTC"]
    p = build_candidates([], md, settings, EventCalendar([]), now=datetime(2026, 6, 2, tzinfo=timezone.utc))
    assert p["candidates"] == [] and "No candidates" in render_markdown(p)
