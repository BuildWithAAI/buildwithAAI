import json, sqlite3, time, pytest
from aai import audit, config, longterm as lt, reports
from aai.models import Idea


@pytest.fixture
def seeded(store):
    lt.seed(store); return store


def test_config_rejects_longterm_as_trading_sector(tmp_path):
    with pytest.raises(config.ConfigError):
        config.load(overrides={"risk": {"sector_caps": {"longterm": 0.03}}, "store": {"path": str(tmp_path / "x.db")}})
    with pytest.raises(config.ConfigError):
        config.load(overrides={"longterm": {"leverage_allowed": True}, "store": {"path": str(tmp_path / "x.db")}})


def test_seed_idempotent(seeded):
    a = lt.seed(seeded)
    assert a["lt_accounts"] == 9 and a["lt_sleeves"] == 8
    assert sum(r["target_pct"] for r in seeded.query("SELECT target_pct FROM lt_sleeves WHERE portfolio='stocks_2040'")) == pytest.approx(100)


def test_trading_path_rejects_longterm(ledger):
    d = ledger.submit(Idea(sector="longterm", symbol="VTI", side="long", entry=300, stop=280))
    assert not d.approved and "trading_bucket_only" in d.failed


def test_kill_switch_ringfenced(seeded, cfg, ledger):
    ledger.set_kill_switch(True, "perps blowup", "test")
    assert lt.tickets(seeded) == []                                  # kill switch emitted no longterm tickets
    r = lt.draft_ticket(seeded, cfg, account_id="robinhood", symbol="VTI", side="buy", amount_usd=500,
                        rationale="monthly contribution", rule_refs=["core_60"])
    assert r["guard_result"] == "pass"                               # not blocked by the trading kill switch
    lt.ingest_snapshot(seeded, "robinhood", [{"symbol": "VTI", "quantity": 10, "value_usd": 3000}], "manual")
    assert ledger.equity()["equity"] == 10000                        # longterm value never enters trading equity


def test_lt02_trading_origin_sell_blocked(seeded, cfg):
    r = lt.draft_ticket(seeded, cfg, account_id="trezor", symbol="BTC", side="sell", quantity=0.1, amount_usd=7000,
                        rationale="derisk", rule_refs=[], origin="trading_kill_switch")
    assert r["guard_result"] == "blocked" and any(g["id"] == "LT-02" and g["status"] == "fail" for g in r["guards"])


def test_lt01_trading_account_blocked(seeded, cfg):
    r = lt.draft_ticket(seeded, cfg, account_id="blofin_perps", symbol="BTC", side="buy", amount_usd=100, rationale="x", rule_refs=[])
    assert r["guard_result"] == "blocked"


def test_lt03_lt04_core_sells(seeded, cfg):
    r = lt.draft_ticket(seeded, cfg, account_id="trezor", symbol="BTC", side="sell", quantity=0.1, amount_usd=7000, rationale="x", rule_refs=[])
    assert r["guard_result"] == "blocked"                            # no floor set -> never fully sell
    seeded.execute("UPDATE lt_crypto_core SET core_floor_qty=0.5, initial_capital_usd=10000 WHERE symbol='BTC'")
    lt.ingest_snapshot(seeded, "trezor", [{"symbol": "BTC", "quantity": 1.0, "value_usd": 78000}], "manual")
    r = lt.draft_ticket(seeded, cfg, account_id="trezor", symbol="BTC", side="sell", quantity=0.1, amount_usd=7800, rationale="x", rule_refs=[])
    assert {g["id"]: g["status"] for g in r["guards"]}["LT-04"] == "fail"   # no strength cycle read
    seeded.execute("INSERT INTO lt_cycle_reads(as_of,asset,phase,evidence) VALUES(?,?,?,?)", (time.time(), "BTC", "strength_recover_initials", "test"))
    r = lt.draft_ticket(seeded, cfg, account_id="trezor", symbol="BTC", side="sell", quantity=0.1, amount_usd=7800, rationale="x", rule_refs=[])
    assert r["guard_result"] == "pass"
    r = lt.draft_ticket(seeded, cfg, account_id="trezor", symbol="BTC", side="sell", quantity=0.6, amount_usd=7800, rationale="x", rule_refs=[])
    assert r["guard_result"] == "blocked"                            # would go below floor
    r = lt.draft_ticket(seeded, cfg, account_id="trezor", symbol="BTC", side="sell", quantity=0.1, amount_usd=12000, rationale="x", rule_refs=[])
    assert r["guard_result"] == "blocked"                            # more than initials


def test_lt05_lt06_lt09_weights(seeded, cfg):
    r = lt.draft_ticket(seeded, cfg, account_id="robinhood", symbol="TMC", side="buy", amount_usd=100, rationale="x", rule_refs=[])
    assert r["guard_result"] == "pass" and r["unverified"]           # LT-09: unknown, labelled UNVERIFIED
    lt.ingest_snapshot(seeded, "robinhood", [{"symbol": "VTI", "quantity": 30, "value_usd": 9500},
                                                {"symbol": "TMC", "quantity": 100, "value_usd": 250}], "manual")
    assert lt.draft_ticket(seeded, cfg, account_id="robinhood", symbol="TMC", side="buy", amount_usd=20, rationale="x", rule_refs=[])["guard_result"] == "pass"
    assert lt.draft_ticket(seeded, cfg, account_id="robinhood", symbol="TMC", side="buy", amount_usd=200, rationale="x", rule_refs=[])["guard_result"] == "blocked"
    assert lt.draft_ticket(seeded, cfg, account_id="robinhood", symbol="RKLB", side="buy", amount_usd=1000, rationale="x", rule_refs=[])["guard_result"] == "blocked"


def test_lt07_lt08(seeded, cfg):
    with pytest.raises(ValueError):
        lt.draft_ticket(seeded, cfg, account_id="robinhood", symbol="VTI", side="short", amount_usd=1, rationale="x", rule_refs=[])
    assert lt.draft_ticket(seeded, cfg, account_id="robinhood", symbol="VTI", side="buy", amount_usd=1, instrument_type="options",
                           rationale="x", rule_refs=[])["guard_result"] == "blocked"
    assert lt.draft_ticket(seeded, cfg, account_id="phantom", symbol="SOL", side="transfer_to_cold", quantity=1, destination="trezor",
                           rationale="x", rule_refs=[])["guard_result"] == "pass"
    assert lt.draft_ticket(seeded, cfg, account_id="phantom", symbol="SOL", side="transfer_to_cold", quantity=1, destination="exodus",
                           rationale="x", rule_refs=[])["guard_result"] == "blocked"


def test_lt10_confirmation(seeded, cfg):
    ok = lt.draft_ticket(seeded, cfg, account_id="robinhood", symbol="VTI", side="buy", amount_usd=500, rationale="x", rule_refs=[])
    bad = lt.draft_ticket(seeded, cfg, account_id="blofin_perps", symbol="VTI", side="buy", amount_usd=500, rationale="x", rule_refs=[])
    with pytest.raises(ValueError):
        lt.confirm_ticket(seeded, ok["ticket_id"], "  ")
    with pytest.raises(ValueError):
        lt.confirm_ticket(seeded, bad["ticket_id"], "yes buy it")
    with pytest.raises(sqlite3.IntegrityError):                      # DB trigger also refuses
        seeded.execute("UPDATE lt_order_tickets SET status='confirmed_by_user' WHERE ticket_id=?", (bad["ticket_id"],))
    with pytest.raises(ValueError):
        lt.mark_done(seeded, ok["ticket_id"], "done")                # not confirmed yet
    t = lt.confirm_ticket(seeded, ok["ticket_id"], "Zoorped: yes, buy $500 VTI in OnePay")
    assert t["status"] == "confirmed_by_user"
    assert lt.mark_done(seeded, ok["ticket_id"], "Zoorped: bought it")["status"] == "done_by_user"
    assert audit.verify(seeded)["ok"]


def test_snapshots_append_only(seeded):
    lt.ingest_snapshot(seeded, "trezor", [{"symbol": "BTC", "quantity": 1}], "manual")
    with pytest.raises(sqlite3.IntegrityError):
        seeded.execute("UPDATE lt_holdings_snapshots SET quantity=2")
    with pytest.raises(ValueError):
        lt.ingest_snapshot(seeded, "blofin_perps", [{"symbol": "BTC", "quantity": 1}], "manual")


def test_report_schema(store):
    rep = json.load(open("tests/fixture_report_2040.json"))
    assert reports.ingest(store, rep)["ok"]
    assert not reports.ingest(store, {**rep, "no_trades_placed": False})["ok"]
    bad = {**rep, "ideas": [{"instrument": "BTC-USDT", "side": "long", "entry": 1, "stop": 0.9, "risk_pct": 5, "reason": "x"}]}
    assert not reports.ingest(store, bad)["ok"]
    lt_bad = json.loads(json.dumps(rep)); lt_bad["longterm"]["weights"][0]["actual_pct"] = 61
    assert not reports.ingest(store, lt_bad)["ok"]                  # holdings_source none => weights must be null
