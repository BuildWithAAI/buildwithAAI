"""Health framework. Output shape is identical to smr's healthcheck (AAI Terminal parses both):

  {"overall": "pass"|"fail", "provider": str, "checked_at": int (unix s),
   "checks": [{"check": str, "pass": bool, "required": bool, "ms": int, "detail": any}]}

overall = pass iff every required check passed. Optional checks may fail (e.g. a geo-blocked venue).
"""
from __future__ import annotations
import time, traceback


class SkipCheck(Exception):
    pass


class Health:
    def __init__(self, provider: str):
        self.provider, self.checks = provider, []

    def run(self, name: str, fn, required: bool = True):
        t0 = time.monotonic()
        try:
            detail = fn()
            ok = True
            if isinstance(detail, tuple) and len(detail) == 2 and isinstance(detail[0], bool):
                ok, detail = detail
        except SkipCheck as e:
            ok, detail = True, f"skipped: {e}"
        except Exception as e:  # health must never raise
            ok, detail = False, f"{type(e).__name__}: {str(e)[:300]}"
            if not str(e):
                detail = traceback.format_exc(limit=2)[-300:]
        self.checks.append({"check": name, "pass": bool(ok), "required": bool(required),
                            "ms": int((time.monotonic() - t0) * 1000), "detail": detail})
        return ok

    def add(self, check: dict) -> None:
        self.checks.append({k: check[k] for k in ("check", "pass", "required", "ms", "detail")})

    def result(self) -> dict:
        overall = "pass" if all(c["pass"] for c in self.checks if c["required"]) else "fail"
        return {"overall": overall, "provider": self.provider, "checked_at": int(time.time()), "checks": self.checks}


def validate_shape(d: dict) -> list[str]:
    """Return a list of problems (empty = valid). Used by tests and when ingesting smr's health JSON."""
    errs = []
    if set(d) != {"overall", "provider", "checked_at", "checks"}:
        errs.append(f"top-level keys {sorted(d)}")
    if d.get("overall") not in ("pass", "fail"):
        errs.append("overall")
    for c in d.get("checks", []):
        if set(c) != {"check", "pass", "required", "ms", "detail"}:
            errs.append(f"check keys {sorted(c)}")
        elif not (isinstance(c["check"], str) and isinstance(c["pass"], bool) and isinstance(c["required"], bool) and isinstance(c["ms"], int)):
            errs.append(f"check types {c.get('check')}")
    return errs
