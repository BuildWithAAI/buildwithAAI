from __future__ import annotations

import json

import pytest
from pydantic import ValidationError

from aai_fx.cli import build_parser
from aai_fx.config import AppConfig
from aai_fx.execution.mt5_adapter import LiveTradingNotConfirmed, MT5Broker, MT5NotAvailable, MT5OrderRequest
from aai_fx.reporting.audit import AuditLog

REQ = MT5OrderRequest("EURUSD", 1, 0.10, stop=1.0950, target=1.1100)


def test_refuses_by_default(tmp_path) -> None:  # type: ignore[no-untyped-def]
    audit = AuditLog(tmp_path / "a.jsonl")
    with pytest.raises(LiveTradingNotConfirmed):
        MT5Broker(audit=audit).place_order(REQ)
    audit.close()
    rec = json.loads((tmp_path / "a.jsonl").read_text().splitlines()[-1])
    assert rec["event"] == "live_order_refused"


@pytest.mark.parametrize("ctor,call", [(True, False), (False, True), (False, False)])
def test_requires_both_confirmations(ctor: bool, call: bool) -> None:
    with pytest.raises(LiveTradingNotConfirmed):
        MT5Broker(confirm_live=ctor, dry_run=True).place_order(REQ, confirm_live=call)


@pytest.mark.parametrize("truthy", ["yes", 1, "True", [1]])
def test_truthy_values_are_not_confirmation(truthy) -> None:  # type: ignore[no-untyped-def]
    with pytest.raises(LiveTradingNotConfirmed):
        MT5Broker(confirm_live=truthy).place_order(REQ, confirm_live=True)
    with pytest.raises(LiveTradingNotConfirmed):
        MT5Broker(confirm_live=True).place_order(REQ, confirm_live=truthy)


def test_confirmed_dry_run_sends_nothing() -> None:
    out = MT5Broker(confirm_live=True, dry_run=True).place_order(REQ, confirm_live=True)
    assert out["dry_run"] is True
    assert out["request"]["symbol"] == "EURUSD" and out["request"]["sl"] == 1.0950


def test_confirmed_live_on_linux_cannot_send(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    monkeypatch.setattr("sys.platform", "linux")
    with pytest.raises(MT5NotAvailable):
        MT5Broker(confirm_live=True, dry_run=False).place_order(REQ, confirm_live=True)


def test_config_cannot_express_live_mode() -> None:
    with pytest.raises(ValidationError):
        AppConfig.model_validate({"execution": {"mode": "live"}})


def test_cli_has_no_live_command() -> None:
    p = build_parser()
    sub = next(a for a in p._actions if a.dest == "cmd")
    assert not any("live" in c for c in sub.choices)  # type: ignore[union-attr]
