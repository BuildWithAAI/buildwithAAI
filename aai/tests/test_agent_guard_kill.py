"""agent-guard global kill switch overlay (added by Security agent, 2026-11-03)."""
import json


def test_global_kill_overrides_and_db_untouched(tmp_path, monkeypatch, cfg, store):
    from aai.ledger import PaperLedger
    led = PaperLedger(store, cfg)
    kf = tmp_path / "KILL_SWITCH"
    monkeypatch.setenv("AGENT_GUARD_KILL_FILE", str(kf))
    assert led.kill_switch()["on"] is False
    kf.write_text(json.dumps({"reason": "drill"}))
    ks = led.kill_switch()
    assert ks["on"] is True and ks["global"] is True and "drill" in ks["reason"]
    assert store.get_control("kill_switch", {"on": False})["on"] is False
    kf.unlink()
    assert led.kill_switch()["on"] is False
