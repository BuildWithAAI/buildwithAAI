"""Acceptance 11: LIVE without ROUTE_APPROVED stays simulation-only."""

from pathlib import Path

from harness import activate, build, buy


class RecordingBroadcaster:
    enabled = True

    def __init__(self) -> None:
        self.payloads: list[bytes] = []

    def submit(self, payload: bytes) -> None:
        self.payloads.append(payload)


def test_live_refused_without_route(tmp_path: Path) -> None:
    recorder = RecordingBroadcaster()
    signer, services = build(tmp_path, broadcaster=recorder)
    assert services.secrets.has_signing_key()
    assert signer.set_mode("LIVE").code == "ROUTE_REQUIRED"
    assert signer.mode() == "DRY_RUN"
    assert activate(signer).ok
    decision = buy(signer)
    assert decision.ok
    assert decision.simulated
    assert recorder.payloads == []
    assert signer.s.broadcaster.calls == 0 if hasattr(signer.s.broadcaster, "calls") else recorder.payloads == []


def test_route_source_is_in_the_chain(tmp_path: Path) -> None:
    signer, _services = build(tmp_path)
    assert signer.set_route("written permission 2026-11-17", "2026-11-17").ok
    assert signer.route_approved()
    assert signer.set_mode("LIVE").ok
    assert signer.mode() == "LIVE"
    text = " ".join(payload for _row, _kind, payload in signer.read_events(0))
    assert "written permission 2026-11-17" in text
    refused = signer.set_route("", "2026-11-17")
    assert refused.ok is False
