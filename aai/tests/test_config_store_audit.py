import sqlite3, pytest
from aai import audit, config


def test_rejects_risk_above_3pct(tmp_path):
    with pytest.raises(config.ConfigError):
        config.load(overrides={"risk": {"max_risk_per_trade": 0.05}, "store": {"path": str(tmp_path / "x.db")}})


def test_rejects_sector_override_above_3pct(tmp_path):
    with pytest.raises(config.ConfigError):
        config.load(overrides={"risk": {"sector_max_risk_per_trade": {"perps": 0.04}}, "store": {"path": str(tmp_path / "x.db")}})


def test_rejects_live_mode(tmp_path):
    with pytest.raises(config.ConfigError):
        config.load(overrides={"account": {"mode": "live"}, "store": {"path": str(tmp_path / "x.db")}})


def test_rejects_min_below_1pct(tmp_path):
    with pytest.raises(config.ConfigError):
        config.load(overrides={"risk": {"min_risk_per_trade": 0.005}, "store": {"path": str(tmp_path / "x.db")}})


def test_schema_created(store):
    tables = {r["name"] for r in store.query("SELECT name FROM sqlite_master WHERE type='table'")}
    for t in ("instruments", "quotes", "candles", "funding", "signals", "ideas", "risk_decisions", "orders", "fills", "positions", "audit_log", "control"):
        assert t in tables


def test_audit_chain_and_append_only(store):
    for i in range(5):
        audit.record(store, "e", inputs={"i": i}, reasons=[str(i)])
    assert audit.verify(store) == {"ok": True, "entries": 5, "broken_at": None}
    with pytest.raises(sqlite3.IntegrityError):
        store.execute("UPDATE audit_log SET outcome='x' WHERE seq=2")
    with pytest.raises(sqlite3.IntegrityError):
        store.execute("DELETE FROM audit_log WHERE seq=2")


def test_audit_detects_tamper(store):
    for i in range(3):
        audit.record(store, "e", inputs={"i": i})
    store.execute("DROP TRIGGER audit_no_update")          # simulate someone bypassing the trigger
    store.execute("UPDATE audit_log SET inputs='{\"i\":99}' WHERE seq=2")
    v = audit.verify(store)
    assert v["ok"] is False and v["broken_at"] == 2
