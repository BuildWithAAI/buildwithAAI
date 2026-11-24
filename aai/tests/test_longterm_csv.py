"""Manual long-term holdings CSV import (audit-only, CLI writer) + LongtermFeedAdapter."""
from __future__ import annotations

import json
import time
from pathlib import Path

import pytest

from aai import longterm as lt
from aai.adapters.longterm_feed import LongtermFeedAdapter
from aai.adapters.registry import build
from aai.hud import create_app


CSV_OK = """symbol,quantity,price_usd,value_usd,verified
VTI,20,300,6000,true
TMC,100,4,400,true
SPCE,10,10,100,true
PLTR,5,100,500,true
"""


@pytest.fixture
def seeded(store, cfg):
    lt.seed(store, cfg)
    return store


@pytest.fixture
def client(cfg, store, monkeypatch):
    monkeypatch.delenv("AAI_HUD_TOKEN", raising=False)
    lt.seed(store, cfg)
    return create_app(cfg, store, build(cfg, store), heavy=False).test_client()


def test_parse_holdings_csv_basic_and_merge():
    rows = lt.parse_holdings_csv(CSV_OK)
    assert {r["symbol"] for r in rows} == {"VTI", "TMC", "SPCE", "PLTR"}
    vti = next(r for r in rows if r["symbol"] == "VTI")
    assert vti["quantity"] == 20 and vti["value_usd"] == 6000 and vti["verified"] is True
    # duplicate symbols merge
    merged = lt.parse_holdings_csv("symbol,quantity,value_usd\nVTI,1,100\nVTI,2,200\n")
    assert len(merged) == 1 and merged[0]["quantity"] == 3 and merged[0]["value_usd"] == 300
    # price fills value
    filled = lt.parse_holdings_csv("symbol,quantity,price_usd\nQQQ,2,400\n")
    assert filled[0]["value_usd"] == 800
    with pytest.raises(lt.HoldingsImportError, match="required"):
        lt.parse_holdings_csv("qty,symbol\n1,VTI\n")
    with pytest.raises(lt.HoldingsImportError, match="empty"):
        lt.parse_holdings_csv("# only a comment\n")


def test_import_cli_only_and_no_tickets(seeded, cfg, tmp_path):
    path = tmp_path / "holdings.csv"
    path.write_text(CSV_OK)
    with pytest.raises(lt.HoldingsImportError, match="CLI only"):
        lt.import_holdings_csv(seeded, path, "onepay_roth", actor="hud")
    with pytest.raises(lt.HoldingsImportError, match="CLI only"):
        lt.import_holdings_csv(seeded, path, "onepay_roth", actor="zoora")
    out = lt.import_holdings_csv(seeded, path, "onepay_roth", actor="cli")
    assert out["ok"] and out["rows"] == 4 and out["holdings_source"] == "manual"
    assert seeded.one("SELECT COUNT(*) n FROM lt_order_tickets")["n"] == 0
    acct = seeded.one("SELECT connected, feed FROM lt_accounts WHERE account_id='onepay_roth'")
    assert acct["connected"] == 1 and acct["feed"] == "manual"
    # still audit-only: draft refused (policy unchanged by CSV import)
    with pytest.raises(lt.TicketingDisabled):
        lt.draft_ticket(seeded, cfg, account_id="onepay_roth", symbol="VTI", side="buy",
                        amount_usd=1, rationale="x", rule_refs=[])


def test_import_from_path_and_audit_verified(seeded, cfg, tmp_path):
    path = tmp_path / "ok.csv"
    path.write_text(CSV_OK)
    lt.import_holdings_csv(seeded, path, "onepay_roth", actor="cli")
    r = lt.account_audit(seeded, cfg, "onepay_roth", persist=False)
    assert r["status"] == "VERIFIED" and r["total_value_usd"] == 7000
    assert r["holdings_source"] == "manual"
    assert seeded.one("SELECT COUNT(*) n FROM lt_order_tickets WHERE account_id='onepay_roth'")["n"] == 0


def test_longterm_feed_adapter_states(cfg, store, tmp_path):
    lt.seed(store, cfg)
    ad = LongtermFeedAdapter(cfg, store)
    miss = ad.panel()
    assert miss["state"] == "MISSING" and miss["n_rows"] == 0
    assert ad.health()["ok"] is False and ad.health()["status"] == "missing"
    path = tmp_path / "h.csv"
    path.write_text(CSV_OK)
    lt.import_holdings_csv(store, path, "onepay_roth", actor="cli")
    ok = ad.panel()
    assert ok["state"] == "OK" and ok["n_rows"] == 4 and ok["holdings_source"] == "manual"
    assert ad.health()["ok"] is True and ad.health()["status"] == "pass"
    # registry wires the real adapter, not a Placeholder
    reg = build(cfg, store)
    assert isinstance(reg["longterm_feed"], LongtermFeedAdapter) and reg["longterm_feed"].placeholder is False


def test_overview_and_pipelines_and_intent(client, store, cfg, tmp_path):
    ov = client.get("/api/zoora/overview").json
    pipe = next(p for p in ov["pipelines"] if p["id"] == "longterm_feed")
    assert pipe["state"] == "MISSING"
    assert ov["longterm"]["holdings_source"] == "none"
    assert ov["longterm"]["holdings"] == []
    assert "lt-holdings-import" in ov["longterm"]["import_hint"]
    fresh = next(f for f in ov["freshness"] if "Long-term" in f["source"])
    assert fresh.get("never") is True
    # spoken intent names the CLI when empty
    intent = client.post("/api/zoora", json={"text": "long-term plan status", "source": "test"}).json
    assert intent["ok"] and "lt-holdings-import" in intent["reply"]

    path = tmp_path / "h.csv"
    path.write_text(CSV_OK)
    lt.import_holdings_csv(store, path, "onepay_roth", actor="cli")
    time.sleep(2.1)  # overview cache max_age=2s
    ov2 = client.get("/api/zoora/overview").json
    pipe2 = next(p for p in ov2["pipelines"] if p["id"] == "longterm_feed")
    assert pipe2["state"] == "OK" and "manual" in pipe2["detail"]
    L = ov2["longterm"]
    assert L["holdings_source"] == "manual" and len(L["holdings"]) == 4
    assert L["roth"]["status"] == "VERIFIED" and L["roth"]["total_value_usd"] == 7000
    fresh2 = next(f for f in ov2["freshness"] if "Long-term" in f["source"])
    assert fresh2.get("never") is not True and fresh2["stale"] is False
    # static HUD still has the import hint hooks + holdings table hooks
    page = client.get("/zoora").data.decode()
    assert "lt-import" in Path("aai/static/zoora/zoora.js").read_text()
    assert "lt-holds" in Path("aai/static/zoora/zoora.js").read_text()
    assert "lt-holdings-import" in Path("aai/static/zoora/zoora.js").read_text()


def test_placeholders_list_excludes_longterm_feed(cfg, store):
    """longterm_feed is a real adapter now; remaining placeholders still never fake ok."""
    ad = build(cfg, store)
    for k in ("trader_audit", "terminal_hud", "forex", "bybit"):
        h = ad[k].health()
        assert h["ok"] is None and h["status"] == "not_configured"
    assert ad["longterm_feed"].placeholder is False
