"""Acceptance 10: hash chain and a secret scan of the sample log."""

from pathlib import Path

from harness import activate, build, buy
from zoora_signer.db import connect, verify_chain


def test_chain_detects_tampering_and_logs_have_no_secrets(tmp_path: Path) -> None:
    signer, services = build(tmp_path)
    assert activate(signer).ok
    assert buy(signer).ok
    conn = connect(signer.path)
    event_key = services.secrets.get_event_hmac()
    assert event_key is not None
    assert verify_chain(conn, event_key)
    conn.execute("UPDATE events SET payload = '{\"tampered\":true}' WHERE id = 1")
    assert verify_chain(conn, event_key) is False
    assert verify_chain(conn, b"x" * 32) is False
    conn.close()
    hud = (tmp_path / "hud.jsonl").read_text(encoding="utf-8")
    secret = services.secrets.get_signing_key()
    assert secret is not None
    url = services.secrets.get_rpc_url()
    assert url is not None
    mac = services.secrets.get_hmac_key()
    assert mac is not None
    assert secret.hex() not in hud
    assert url not in hud
    assert mac.hex() not in hud
    assert event_key.hex() not in hud
    assert "api-key" not in hud
    assert "helius" in hud
    poisoned = hud + "\n" + "https://example.invalid/rpc?api-key=not-a-real-key"
    assert "api-key=" in poisoned
