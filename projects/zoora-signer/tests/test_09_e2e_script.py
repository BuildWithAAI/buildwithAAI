"""Acceptance 9: the validator end-to-end script is documented and not part of CI."""

from pathlib import Path


def test_e2e_script_is_documented_and_offline() -> None:
    root = Path(__file__).resolve().parents[1]
    script = (root / "scripts" / "e2e_validator.py").read_text(encoding="utf-8")
    assert "solana-test-validator" in script
    assert "sigVerify" in script
    assert "--clone" in script
    assert "pump.fun" not in script.lower()
    workflow = (root.parents[1] / ".github" / "workflows" / "zoora-signer.yml").read_text(encoding="utf-8")
    assert "e2e_validator" not in workflow
    assert "E2E_IN_CI = False" in script
