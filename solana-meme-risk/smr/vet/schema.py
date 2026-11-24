"""vet/1 result schema (typed). DESIGN/REFERENCE ONLY: the gate reads public data; it never signs, trades or holds keys.

Verdict rules (see docs/VET_GATE_SPEC.md):
  FAIL     any check failed (also: invalid input, not a pump.fun SOL-quoted mint)
  UNKNOWN  no check failed, but at least one required check is unknown (timeout, source error, stale or missing data)
  PASS     every required check passed with fresh data
The executor must treat UNKNOWN exactly like FAIL (allow == verdict is PASS)."""
from __future__ import annotations
from dataclasses import dataclass, field, asdict
from typing import Any, Optional

SCHEMA_VERSION = "vet/1"
PASS, FAIL, UNKNOWN = "PASS", "FAIL", "UNKNOWN"
ST_PASS, ST_FAIL, ST_UNKNOWN = "pass", "fail", "unknown"
SEV_FAIL, SEV_UNKNOWN, SEV_WARN, SEV_INFO = "fail", "unknown", "warn", "info"

# Required checks, in report order. Every one must be "pass" for verdict PASS.
CHECKS = ("input", "authority", "mayhem", "market", "holders", "bundle_sniper", "creator_history", "funding_cluster")


@dataclass
class Reason:
    code: str                      # stable machine code, e.g. "TOP10_TOO_HIGH"
    check: str                     # one of CHECKS
    severity: str                  # fail | unknown | warn | info
    observed: Any = None           # measured value (number/bool/str/None); never raw token metadata
    threshold: Any = None          # the limit it was compared with (None if not a comparison)
    message: str = ""              # short human text built only from numbers / fixed strings


@dataclass
class CheckResult:
    name: str
    status: str = ST_UNKNOWN       # pass | fail | unknown
    required: bool = True
    latency_ms: Optional[int] = None
    data_as_of: Optional[float] = None   # unix seconds of the OLDEST datum this check used
    slot: Optional[int] = None           # RPC context slot when known
    sources: list = field(default_factory=list)
    metrics: dict = field(default_factory=dict)
    reasons: list = field(default_factory=list)   # list[Reason]

    def add(self, code, severity, observed=None, threshold=None, message=""):
        self.reasons.append(Reason(code, self.name, severity, observed, threshold, message))
        if severity == SEV_FAIL:
            self.status = ST_FAIL
        elif severity == SEV_UNKNOWN and self.status != ST_FAIL:
            self.status = ST_UNKNOWN
        return self

    def finish(self):
        """pass only if nothing failed and nothing is unknown."""
        sev = {r.severity for r in self.reasons}
        self.status = ST_FAIL if SEV_FAIL in sev else ST_UNKNOWN if SEV_UNKNOWN in sev else ST_PASS
        return self


@dataclass
class VetResult:
    mint: str
    verdict: str
    checks: dict                   # name -> CheckResult
    evaluated_at: float
    valid_until: float             # executor must re-vet after this (send-time recheck)
    latency_ms: int
    budget_ms: int
    config_version: str
    code_version: str
    sources_used: list
    data_as_of: dict               # {"oldest": ts, "newest": ts}
    cache: dict = field(default_factory=dict)
    schema: str = SCHEMA_VERSION

    @property
    def reasons(self):
        return [r for c in self.checks.values() for r in c.reasons]

    @property
    def allow(self) -> bool:
        return self.verdict == PASS

    def to_dict(self) -> dict:
        d = {"schema": self.schema, "mint": self.mint, "verdict": self.verdict, "allow": self.allow,
             "evaluated_at": round(self.evaluated_at, 3), "valid_until": round(self.valid_until, 3),
             "latency_ms": self.latency_ms, "budget_ms": self.budget_ms,
             "config_version": self.config_version, "code_version": self.code_version,
             "data_as_of": self.data_as_of, "sources_used": sorted(set(self.sources_used)), "cache": self.cache,
             "reasons": [asdict(r) for r in self.reasons if r.severity in (SEV_FAIL, SEV_UNKNOWN, SEV_WARN)],
             "checks": {}}
        for n, c in self.checks.items():
            d["checks"][n] = {"status": c.status, "required": c.required, "latency_ms": c.latency_ms,
                              "data_as_of": c.data_as_of, "slot": c.slot, "sources": sorted(set(c.sources)),
                              "metrics": c.metrics, "reasons": [asdict(r) for r in c.reasons]}
        return d


def aggregate(checks: dict) -> str:
    sts = [c.status for c in checks.values() if c.required]
    if ST_FAIL in sts:
        return FAIL
    if ST_UNKNOWN in sts or len([n for n in CHECKS if n in checks]) < len(CHECKS):
        return UNKNOWN
    return PASS
