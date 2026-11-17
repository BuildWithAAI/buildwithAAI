"""Acceptance 5: kill paths hold everything. Only an owner sell releases a position."""

from pathlib import Path

from harness import activate, build, buy, sell


def test_kill_paths(tmp_path: Path) -> None:
    for reason, state in (
        ("owner", None),
        ("agent", "killed"),
        ("down", "error"),
    ):
        signer, services = build(tmp_path / reason)
        assert activate(signer).ok
        assert buy(signer).ok
        if reason == "owner":
            signer.halt("owner")
        else:
            services.kill.state = state or "clear"
            signer.poll_kill()
        assert signer.activity() == "HALTED"
        assert sell(signer).code == "KILL_HOLD"
        assert signer.run_scheduled_exits() == []
        assert signer.open_trade_count() == 1
        assert signer.owner_sell("4wTV1YmiEkRvAtNtsSGPtUrqRYQMe5SKy2uB4Jjaxnjf").ok
        assert signer.open_trade_count() == 0
        refused = signer.telegram("resume")
        assert refused.code == "TELEGRAM_HALT_ONLY"
        assert signer.activity() == "HALTED"


def test_daily_loss_still_allows_zoora_sells(tmp_path: Path) -> None:
    signer, _services = build(tmp_path)
    assert activate(signer).ok
    assert buy(signer).ok
    import sqlite3

    conn = sqlite3.connect(signer.path)
    conn.execute("UPDATE signer_state SET ledger_sol_lamports = 0, buy_halt_reason = 'daily_loss'")
    conn.execute("UPDATE equity_day SET start_equity_cents = 100000")
    conn.commit()
    conn.close()
    assert sell(signer).ok
