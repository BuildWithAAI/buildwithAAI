"""Coin vetting gate (DESIGN/REFERENCE ONLY): vet(mint) -> VetResult with verdict PASS / FAIL / UNKNOWN.
UNKNOWN must be treated as FAIL by any caller. See docs/VET_GATE_SPEC.md."""
from .schema import VetResult, CheckResult, Reason, SCHEMA_VERSION, PASS, FAIL, UNKNOWN, CHECKS
from .vconfig import VetConfig, VetThresholds, CONFIG_VERSION
from .gate import vet

__all__ = ["vet", "VetResult", "CheckResult", "Reason", "VetConfig", "VetThresholds", "SCHEMA_VERSION", "CONFIG_VERSION",
           "PASS", "FAIL", "UNKNOWN", "CHECKS"]
