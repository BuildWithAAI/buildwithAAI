"""Delegation to solana-meme-risk (smr) through its STABLE CLI only. We never import smr internals or
modify its files: `python -m risk score <MINT> --summary` and `python -m risk health [--quick]`."""
from __future__ import annotations
import json, os, re, subprocess


class SmrError(RuntimeError):
    pass


def _run(settings, args, timeout):
    if not os.path.isdir(settings.smr_home):
        raise SmrError(f"SMR_HOME not found: {settings.smr_home}")
    py = settings.smr_python if os.path.exists(settings.smr_python) else "python3"
    p = subprocess.run([py, "-m", "risk", *args], cwd=settings.smr_home, capture_output=True, text=True, timeout=timeout)
    return p


def _first_json(text: str):
    i = text.find("{")
    if i < 0:
        raise SmrError("no JSON in smr output")
    return json.JSONDecoder().raw_decode(text[i:])[0]


def score_summary(settings, mint: str, extra_args: list[str] | None = None) -> dict:
    if not re.fullmatch(r"[1-9A-HJ-NP-Za-km-z]{32,44}", mint):
        raise SmrError(f"not a base58 Solana mint: {mint!r}")
    p = _run(settings, ["score", mint, "--summary", *(extra_args or [])], settings.smr_timeout_s)
    if p.returncode != 0:
        raise SmrError(f"smr score exit {p.returncode}: {(p.stderr or p.stdout)[-300:]}")
    return _first_json(p.stdout)


def health(settings, quick: bool = True, timeout: float = 300) -> dict:
    p = _run(settings, ["health"] + (["--quick"] if quick else []), timeout)
    return _first_json(p.stdout)


REASON_RE = re.compile(r"^([a-z0-9_]+) \+(\d+): (.*)$")


def reasons_from_summary(s: dict) -> list[dict]:
    out = []
    for t in s.get("top_reasons") or []:
        m = REASON_RE.match(t)
        if m:
            code, pts, detail = m.group(1), int(m.group(2)), m.group(3)
        else:
            code, pts, detail = "smr_reason", 0, t
        out.append({"code": code, "points": min(100, pts), "severity": "hard" if code in (s.get("hard_flags") or []) else "warn", "detail": detail[:300]})
    for h in s.get("hard_flags") or []:
        if not any(r["code"] == h for r in out):
            out.append({"code": re.sub(r"[^a-z0-9_]", "_", h.lower()), "points": 0, "severity": "hard", "detail": "smr hard flag"})
    return out
