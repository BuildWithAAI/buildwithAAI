"""Vet gate. The sidecar is a subprocess so Lumen cannot forge the verdict."""

from __future__ import annotations

import json
import re
import subprocess
import sys
from dataclasses import dataclass

from zoora_signer.constants import (
    VET_BUDGET_S,
    VET_CONFIG_VERSION,
    VET_FRESH_MS,
    VET_SCHEMA,
    VET_TIMEOUT_S,
)
from zoora_signer.signing import verify_ed25519

MINT_RE_TEXT = r"^[1-9A-HJ-NP-Za-km-z]{32,44}$"
CLOCK_FUTURE_MS = 2_000


@dataclass(frozen=True)
class VetAssessment:
    ok: bool
    code: str
    service_error: bool
    stale: bool
    config_version: str
    code_version: str
    reason_codes: tuple[str, ...]
    evaluated_ms: int = 0


def _reasons(data: dict[str, object]) -> tuple[str, ...]:
    raw = data.get("reasons")
    if not isinstance(raw, list):
        return ()
    codes: list[str] = []
    for item in raw:
        if isinstance(item, dict) and isinstance(item.get("code"), str):
            codes.append(str(item["code"]))
    return tuple(codes)


def assess_vet(
    *,
    exit_code: int | None,
    raw_text: str,
    timed_out: bool,
    mint: str,
    now_ms: int,
    public_key: bytes | None,
) -> VetAssessment:
    empty = VetAssessment(False, "VET", True, False, "", "", ())
    if timed_out:
        return VetAssessment(False, "TIMEOUT", True, False, "", "", ())
    if exit_code is None:
        return empty
    try:
        parsed = json.loads(raw_text)
    except json.JSONDecodeError:
        return VetAssessment(False, "BAD_JSON", True, False, "", "", ())
    if not isinstance(parsed, dict):
        return VetAssessment(False, "BAD_JSON", True, False, "", "", ())
    data = {key: value for key, value in parsed.items() if key not in {"name", "symbol", "uri", "description"}}
    config = str(data.get("config_version") or "")
    code_version = str(data.get("code_version") or "")
    reasons = _reasons(data)
    if data.get("schema") != VET_SCHEMA:
        return VetAssessment(False, "SCHEMA", False, False, config, code_version, reasons)
    if data.get("mint") != mint:
        return VetAssessment(False, "WRONG_MINT", False, False, config, code_version, reasons)
    if config != VET_CONFIG_VERSION:
        return VetAssessment(False, "CONFIG_VERSION", False, False, config, code_version, reasons)
    if exit_code == 3:
        return VetAssessment(False, "EXIT_3", True, False, config, code_version, reasons)
    if exit_code != 0:
        verdict = str(data.get("verdict") or "EXIT")
        return VetAssessment(False, verdict, False, False, config, code_version, reasons)
    if data.get("verdict") != "PASS" or data.get("allow") is not True:
        verdict = str(data.get("verdict") or "FAIL")
        return VetAssessment(False, verdict, False, False, config, code_version, reasons)
    evaluated = data.get("evaluated_at")
    if not isinstance(evaluated, int | float):
        return VetAssessment(False, "STALE", False, True, config, code_version, reasons)
    evaluated_ms = int(float(evaluated) * 1000)
    age = now_ms - evaluated_ms
    if age > VET_FRESH_MS or age < -CLOCK_FUTURE_MS:
        return VetAssessment(False, "STALE", False, True, config, code_version, reasons)
    if public_key is not None and not _signature_ok(public_key, data, evaluated):
        return VetAssessment(False, "BAD_SIGNATURE", False, False, config, code_version, reasons)
    return VetAssessment(True, "PASS", False, False, config, code_version, reasons, evaluated_ms)


def _signature_ok(public_key: bytes, data: dict[str, object], evaluated: int | float) -> bool:
    sig = data.get("sig")
    if not isinstance(sig, str):
        return False
    try:
        signature = bytes.fromhex(sig)
    except ValueError:
        return False
    message = "|".join(
        (
            str(data.get("mint")),
            str(data.get("config_version")),
            str(evaluated),
            str(data.get("verdict")),
        )
    ).encode()
    return verify_ed25519(public_key, message, signature)


class SubprocessVet:
    """Calls the pinned ``smr.vet`` module with this interpreter. The module path is not configurable."""

    MODULE = "smr.vet"

    def __init__(self, timeout_s: float = VET_TIMEOUT_S, budget_s: int = VET_BUDGET_S) -> None:
        self.timeout_s = timeout_s
        self.budget_s = budget_s

    def vet(self, mint: str) -> tuple[int | None, str, bool]:
        if re.fullmatch(MINT_RE_TEXT, mint) is None:
            return 3, "", False
        try:
            proc = subprocess.run(
                [sys.executable, "-m", self.MODULE, mint, "--budget-s", str(self.budget_s)],
                capture_output=True,
                timeout=self.timeout_s,
                check=False,
                shell=False,
            )
        except subprocess.TimeoutExpired:
            return None, "", True
        except OSError:
            return None, "", False
        return proc.returncode, proc.stdout.decode("utf-8", "replace"), False
