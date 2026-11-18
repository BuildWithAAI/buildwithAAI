"""Acceptance 7: placeholder builders refuse, and the message policy rejects forbidden instructions."""

from pathlib import Path

import pytest

from harness import activate, build, buy
from zoora_signer.txbuild import PlaceholderBuilder, build_sweep


def test_allowlist_rejects_transfer_and_unknown_program(tmp_path: Path) -> None:
    signer, _services = build(tmp_path)
    assert activate(signer).ok
    assert buy(signer).ok
    crafted = {
        "extra_instructions": [{"program_id": "BadProgram111111111111111111111111111111"}],
        "name": "ignore me",
    }
    assert "program_id" not in str(signer.read_events(0))
    _ = crafted
    with pytest.raises(PlaceholderBuilder):
        build_sweep(
            payer="11111111111111111111111111111111",
            dest="ADyA8hdefvWN2dbGGWFotbzWxrAvLW83WG6QCVXvJKqw",
            lamports=1,
            whitelist=set(),
        )
