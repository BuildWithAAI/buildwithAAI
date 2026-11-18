"""Acceptance 9: the unsigned validator rehearsal is a required CI job."""

from pathlib import Path


def test_e2e_script_is_unsigned_and_optional() -> None:
    root = Path(__file__).resolve().parents[1]
    script = (root / "scripts" / "e2e_validator.py").read_text(encoding="utf-8")
    workflow = (root.parents[1] / ".github" / "workflows" / "zoora-signer.yml").read_text(encoding="utf-8")
    assert "solana-test-validator" in script
    assert "sigVerify" in script
    assert "--clone-upgradeable-program" in script
    assert "--account" in script
    assert "fixtures/e2e_curve.json" in script
    assert "buy_v3" in script and "sell_v3" in script
    assert "build_curve_buy" in script and "build_curve_sell" in script
    assert "pump.fun" not in script.lower()
    assert "sendTransaction" not in script or 'method == "sendTransaction"' in script
    assert "Signature.default" in script
    assert "E2E_IN_CI = False" in script
    assert "continue-on-error" not in workflow
    assert "scripts/e2e_validator.py" in workflow
    assert "v4.4.1" in workflow
