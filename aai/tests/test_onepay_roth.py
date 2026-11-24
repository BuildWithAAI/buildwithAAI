"""OnePay Roth: user-executed, audit-only (Zoorped decision 2026-11-01)."""
import sqlite3, time, pytest
from aai import audit, longterm as lt


@pytest.fixture
def seeded(store, cfg):
    lt.seed(store, cfg); return store


def test_policy_recorded_user_owner_executor_agents_auditor(seeded):
    p = lt.policy(seeded, "onepay_roth")
    assert (p["owner"], p["executor"], p["agent_role"], p["ticketing"]) == ("user", "user", "auditor", "disabled")
    # no agent can be recorded as executor of any account (CHECK constraint)
    with pytest.raises(sqlite3.IntegrityError):
        seeded.execute("INSERT INTO lt_account_policies VALUES('trezor','user','2040_future','drafter','draft_only','x',0,NULL)")


def test_robinhood_unchanged(seeded, cfg):
    assert lt.policy(seeded, "robinhood") is None
    assert lt.draft_ticket(seeded, cfg, account_id="robinhood", symbol="VTI", side="buy", amount_usd=100,
                           rationale="x", rule_refs=[])["guard_result"] == "pass"


@pytest.mark.parametrize("agent", ["2040_future", "stocks", "trader_audit", "user"])
def test_ticket_creation_rejected_in_code(seeded, cfg, agent):
    with pytest.raises(lt.TicketingDisabled):
        lt.draft_ticket(seeded, cfg, account_id="onepay_roth", symbol="VTI", side="buy", amount_usd=100,
                        rationale="x", rule_refs=[], agent=agent)
    assert seeded.one("SELECT COUNT(*) n FROM lt_order_tickets WHERE account_id='onepay_roth'")["n"] == 0
    assert audit.tail(seeded, 1)[0]["event"] == "lt_ticket_refused"


def test_ticket_creation_rejected_at_db_level(seeded):
    with pytest.raises(sqlite3.IntegrityError, match="audit-only"):
        seeded.execute("""INSERT INTO lt_order_tickets(ticket_id,created_at,agent,account_id,symbol,side,amount_usd,rationale,rule_refs,
                          guard_result) VALUES('raw',?,'2040_future','onepay_roth','VTI','buy',1,'x','[]','pass')""", (time.time(),))


def test_cannot_move_ticket_into_roth_or_loosen_policy(seeded, cfg):
    t = lt.draft_ticket(seeded, cfg, account_id="robinhood", symbol="VTI", side="buy", amount_usd=100, rationale="x", rule_refs=[])
    with pytest.raises(sqlite3.IntegrityError):
        seeded.execute("UPDATE lt_order_tickets SET account_id='onepay_roth' WHERE ticket_id=?", (t["ticket_id"],))
    with pytest.raises(sqlite3.IntegrityError, match="locked"):
        seeded.execute("UPDATE lt_account_policies SET ticketing='draft_only', agent_role='drafter' WHERE account_id='onepay_roth'")
    with pytest.raises(sqlite3.IntegrityError):
        seeded.execute("UPDATE lt_account_policies SET executor='2040_future' WHERE account_id='onepay_roth'")
    with pytest.raises(sqlite3.IntegrityError):
        seeded.execute("DELETE FROM lt_account_policies WHERE account_id='onepay_roth'")


def test_preexisting_roth_draft_is_retired_not_deleted(store, cfg):
    lt.seed(store)
    store.execute("DROP TRIGGER lt_ticket_no_auditor_accounts")   # simulate a ticket from before the policy existed
    store.execute("""INSERT INTO lt_order_tickets(ticket_id,created_at,agent,account_id,symbol,side,amount_usd,rationale,rule_refs,guard_result)
                     VALUES('old',?,'2040_future','onepay_roth','VTI','buy',100,'x','[]','pass')""", (time.time(),))
    r = lt.enforce_policies(store, cfg)
    assert r["retired_drafts"] == ["old"]
    assert store.one("SELECT status FROM lt_order_tickets WHERE ticket_id='old'")["status"] == "rejected"
    with pytest.raises(ValueError):
        lt.confirm_ticket(store, "old", "yes buy it")
    with pytest.raises(sqlite3.IntegrityError, match="audit-only"):   # DB refuses even a raw status flip
        store.execute("UPDATE lt_order_tickets SET status='confirmed_by_user', confirmation_quote='q' WHERE ticket_id='old'")
    assert audit.verify(store)["ok"]


def test_audit_report_empty_holdings_is_unverified(seeded, cfg):
    r = lt.account_audit(seeded, cfg, "onepay_roth")
    assert r["status"] == "UNVERIFIED" and r["holdings_source"] == "none" and r["total_value_usd"] is None
    assert r["holdings"] == [] and r["off_plan"] == []
    assert all(d["actual_pct"] is None and d["breach"] == "unknown" for d in r["drift"])
    assert all(c["breach"] == "unknown" or (c["breach"] == "informational" and c["would_exceed"] is None) for c in r["caps_checked"])
    assert r["executor"] == "user" and r["agent_role"] == "auditor"
    rows = seeded.query("SELECT * FROM lt_drift_checks WHERE run_id=?", (r["run_id"],))
    assert rows and all(x["actual_pct"] is None for x in rows)
    assert seeded.one("SELECT COUNT(*) n FROM lt_order_tickets")["n"] == 0     # audit produces no tickets


def test_audit_report_missing_values_unverified(seeded, cfg):
    lt.ingest_snapshot(seeded, "onepay_roth", [{"symbol": "VTI", "quantity": 10}], "manual")
    r = lt.account_audit(seeded, cfg, "onepay_roth")
    assert r["status"] == "UNVERIFIED" and r["holdings"][0]["actual_pct"] is None and r["total_value_usd"] is None
    assert any("value_usd missing" in i for i in r["data_issues"])


def test_audit_report_sample_holdings(seeded, cfg):
    lt.ingest_snapshot(seeded, "onepay_roth", [
        {"symbol": "VTI", "quantity": 20, "value_usd": 6000, "verified": True},
        {"symbol": "TMC", "quantity": 100, "value_usd": 400, "verified": True},
        {"symbol": "SPCE", "quantity": 10, "value_usd": 100, "verified": True},
        {"symbol": "PLTR", "quantity": 5, "value_usd": 500, "verified": True}], "manual")
    r = lt.account_audit(seeded, cfg, "onepay_roth")
    assert r["status"] == "VERIFIED" and r["total_value_usd"] == 7000
    assert r["off_plan"] == ["PLTR"]
    br = {c["key"]: c["breach"] for c in r["cap_breaches"]}
    assert br["TMC"] == "cap_trim"           # 5.71% > 5% trim line
    assert br["PLTR"] == "above"             # 7.14% > 5% growth single-name cap
    assert "SPCE" not in br                  # 1.43% within caps
    spec = next(c for c in r["caps_checked"] if c["key"] == "speculative_total")
    assert spec["actual_pct"] == pytest.approx(500 / 7000 * 100)
    assert spec["breach"] == "informational" and spec["would_exceed"] is False and spec["enforcement"] == "informational"
    vti = next(d for d in r["drift"] if d["scope"] == "symbol" and d["key"] == "VTI")
    assert vti["actual_pct"] == pytest.approx(6000 / 7000 * 100) and vti["drift_pct"] is not None
    assert seeded.one("SELECT COUNT(*) n FROM lt_order_tickets")["n"] == 0


def test_audit_report_unverified_rows_flagged(seeded, cfg):
    lt.ingest_snapshot(seeded, "onepay_roth", [{"symbol": "VTI", "quantity": 1, "value_usd": 300}], "manual")
    r = lt.account_audit(seeded, cfg, "onepay_roth")
    assert r["status"] == "UNVERIFIED" and r["holdings"][0]["actual_pct"] == pytest.approx(100)


def test_hud_onepay(cfg, store):
    from aai.hud import create_app
    from aai.adapters.registry import build
    client = create_app(cfg, store, build(cfg, store)).test_client()
    lt.seed(store)
    r = client.post("/api/command", json={"cmd": "lt_draft", "ticket": {"account_id": "onepay_roth", "symbol": "VTI", "side": "buy",
                                                                        "amount_usd": 100, "rationale": "x", "rule_refs": []}})
    assert r.status_code == 403
    a = client.get("/api/longterm/audit?account=onepay_roth").json
    assert a["ok"] and a["report"]["status"] == "UNVERIFIED"
    assert client.get("/api/longterm/audit?account=nope").status_code == 404


# ---- 2026-11-02: COUR on-plan (speculative, 3% per-name cap); 10% speculative total is informational for OnePay Roth
def _cfg_with(cfg, mode):
    import copy
    c = copy.deepcopy(cfg); c["longterm"]["account_policies"]["onepay_roth"]["speculative_total_cap"] = mode
    return c


def test_cour_on_plan_speculative_3pct_cap(seeded):
    t = seeded.one("SELECT * FROM lt_targets WHERE symbol='COUR'")
    assert t["tier"] == "speculative" and t["max_pct"] == 3 and t["status"] == "active"


def test_cour_not_off_plan_in_onepay_audit(seeded, cfg):
    lt.ingest_snapshot(seeded, "onepay_roth", [{"symbol": "VTI", "quantity": 1, "value_usd": 9800, "verified": True},
                                               {"symbol": "COUR", "quantity": 1, "value_usd": 200, "verified": True}], "manual")
    r = lt.account_audit(seeded, cfg, "onepay_roth")
    assert r["off_plan"] == [] and next(h for h in r["holdings"] if h["symbol"] == "COUR")["on_plan"]
    assert "COUR" not in {c["key"] for c in r["cap_breaches"]}           # 2% <= 3%


def test_cour_over_3pct_is_cap_breach(seeded, cfg):
    lt.ingest_snapshot(seeded, "onepay_roth", [{"symbol": "VTI", "quantity": 1, "value_usd": 9600, "verified": True},
                                               {"symbol": "COUR", "quantity": 1, "value_usd": 400, "verified": True}], "manual")
    br = {c["key"]: c for c in lt.account_audit(seeded, cfg, "onepay_roth")["cap_breaches"]}
    assert br["COUR"]["breach"] == "above" and br["COUR"]["limit_pct"] == 3


def _over_10pct(store):
    lt.ingest_snapshot(store, "onepay_roth", [{"symbol": "VTI", "quantity": 1, "value_usd": 8800, "verified": True},
                                              {"symbol": "TMC", "quantity": 1, "value_usd": 300, "verified": True},
                                              {"symbol": "SPCE", "quantity": 1, "value_usd": 300, "verified": True},
                                              {"symbol": "SLDP", "quantity": 1, "value_usd": 300, "verified": True},
                                              {"symbol": "COUR", "quantity": 1, "value_usd": 300, "verified": True}], "manual")


def test_spec_total_informational_in_onepay(seeded, cfg):
    _over_10pct(seeded)
    r = lt.account_audit(seeded, cfg, "onepay_roth")
    spec = next(c for c in r["caps_checked"] if c["scope"] == "speculative_total")
    assert spec["actual_pct"] == pytest.approx(12.0) and spec["breach"] == "informational" and spec["would_exceed"] is True
    assert "pending" in spec["note"].lower()
    assert "speculative_total" not in {c["key"] for c in r["cap_breaches"]}
    assert r["informational"] and r["informational"][0]["key"] == "speculative_total"
    row = seeded.one("SELECT * FROM lt_drift_checks WHERE run_id=? AND scope='speculative_total'", (r["run_id"],))
    assert row["key"].endswith(":informational_pending_decision")


def test_spec_total_switch_to_hard(seeded, cfg):
    _over_10pct(seeded)
    r = lt.account_audit(seeded, _cfg_with(cfg, "hard"), "onepay_roth")
    spec = next(c for c in r["cap_breaches"] if c["key"] == "speculative_total")
    assert spec["breach"] == "above" and spec["enforcement"] == "hard" and r["informational"] == []


def test_spec_total_unknown_when_no_holdings_even_if_informational(seeded, cfg):
    spec = next(c for c in lt.account_audit(seeded, cfg, "onepay_roth")["caps_checked"] if c["scope"] == "speculative_total")
    assert spec["actual_pct"] is None and spec["would_exceed"] is None


def test_spec_cap_switch_validated(tmp_path):
    from aai import config
    with pytest.raises(config.ConfigError):
        config.load(overrides={"longterm": {"account_policies": {"onepay_roth": {"speculative_total_cap": "soft"}}},
                               "store": {"path": str(tmp_path / "x.db")}})


def test_robinhood_spec_total_still_hard(seeded, cfg):
    lt.ingest_snapshot(seeded, "robinhood", [{"symbol": "VTI", "quantity": 1, "value_usd": 8800, "verified": True},
                                             {"symbol": "TMC", "quantity": 1, "value_usd": 1200, "verified": True}], "manual")
    r = lt.account_audit(seeded, cfg, "robinhood")
    assert next(c for c in r["cap_breaches"] if c["key"] == "speculative_total")["breach"] == "above"
