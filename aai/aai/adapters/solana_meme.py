"""Adapter for /workspace/solana-meme-risk. Integrates via its CLI (subprocess); never modifies that repo's code.
Note: running its scorer uses that tool's own cache (data/cache.db, funding_graph.db) as designed."""
from __future__ import annotations
import json, os, re, subprocess, time
from .base import Adapter, AdapterError

MINT_RE = re.compile(r"^[1-9A-HJ-NP-Za-km-z]{32,44}$")
PUMP_SUPPLY = 1_000_000_000      # pump.fun tokens have a fixed 1B supply
HEALTH_DETAIL_MAX = 200          # per failed check, from solana-meme-risk's own report (untrusted text)
HEALTH_FAILED_MAX = 8
UPSTREAM_NOTE = "pump.fun returns HTTP 403 from this box; shown as degraded, not bypassed"
_BLOCK_RE = re.compile(r"\b403\b|circuit open")


def upstream_blocked_checks(failed) -> list[str]:
    """Names of failed pump.fun checks whose detail is an HTTP 403 or an open circuit breaker (the upstream block).
    Shared by `aai healthcheck` and the Zoora pipelines panel so both say exactly the same thing."""
    return sorted({str(c.get("check"))[:60] for c in failed if isinstance(c, dict)
                   and "pump" in str(c.get("check")).lower() and _BLOCK_RE.search(str(c.get("detail")))})


class SolanaMemeAdapter(Adapter):
    name, sector = "solana_meme_risk", "solana_meme"

    def __init__(self, cfg, store=None, runner=None):
        super().__init__(cfg, store)
        self.c = cfg["adapters"]["solana_meme"]
        self.runner = runner or subprocess.run

    def _run(self, args, timeout):
        repo = self.c["repo_path"]
        if not os.path.isdir(repo):
            raise AdapterError(f"solana-meme-risk not found at {repo}")
        try:
            p = self.runner([self.c["python"], "-m", "risk", *args], cwd=repo, capture_output=True, text=True, timeout=timeout)
        except subprocess.TimeoutExpired:
            raise AdapterError(f"solana-meme-risk timed out after {timeout}s")
        if p.returncode != 0:
            err = AdapterError(f"solana-meme-risk exit {p.returncode}: {(p.stderr or '')[-500:]}")
            try:  # its `health` exits 1 on a failed check but still prints the JSON report on stdout: keep it
                rep = json.loads(p.stdout or "")
                err.report = rep if isinstance(rep, dict) else None
            except ValueError:
                pass
            raise err
        try:
            return json.loads(p.stdout)
        except json.JSONDecodeError as e:
            raise AdapterError(f"non-JSON output: {e}; head={p.stdout[:200]!r}")

    def score(self, mint: str, buyers=None, hops=None, trace_limit=None) -> dict:
        if not MINT_RE.match(mint or ""):
            raise AdapterError("invalid mint address")
        args = ["score", mint, "--buyers", str(buyers or self.c["buyers"]), "--hops", str(hops or self.c["hops"])]
        tl = trace_limit or self.c.get("trace_limit")
        if tl:
            args += ["--trace-limit", str(tl)]
        res = self._run(args, self.c["timeout_sec"])
        return self.ingest(res, ts=time.time())

    def ingest(self, res: dict, ts: float | None = None) -> dict:
        """Normalize a risk JSON and persist it as a signal. ts defaults to the score's own generated_at (honest freshness)."""
        for k in ("mint", "score", "recommendation"):
            if k not in res:
                raise AdapterError(f"risk JSON missing '{k}'")
        ts = ts if ts is not None else float(res.get("generated_at") or 0)
        tok = res.get("token") or {}
        mcap = tok.get("usd_market_cap")
        norm = {"mint": res["mint"], "symbol": tok.get("symbol"), "name": tok.get("name"), "score": res["score"],
                "recommendation": res["recommendation"], "suggested_size": res.get("suggested_size"),
                "confidence": res.get("confidence"), "hard_flags": res.get("hard_flags", []), "flags": res.get("flags", []),
                "reasons": res.get("reasons", []), "small_size": res.get("small_size"),
                "usd_market_cap": mcap, "est_price_usd": (mcap / PUMP_SUPPLY) if mcap else None,
                "data_warnings": res.get("data_warnings", []), "generated_at": res.get("generated_at"),
                "source": "solana-meme-risk"}
        sid = None
        if self.store is not None:
            cur = self.store.execute("INSERT INTO signals(ts,sector,source,symbol,kind,score,recommendation,payload) VALUES(?,?,?,?,?,?,?,?)",
                                     (ts, self.sector, "solana-meme-risk", res["mint"], "rug_risk_score", res["score"], res["recommendation"],
                                      json.dumps(norm, default=str)))
            sid = cur.lastrowid
        return {"id": sid, "ts": ts, "score": res["score"], "recommendation": res["recommendation"], "payload": norm}

    def load_file(self, path: str) -> dict:
        with open(path) as f:
            return self.ingest(json.load(f))

    def health(self, quick=True) -> dict:
        t = time.time()
        try:
            rep = self._run(["health"] + (["--quick"] if quick else []), timeout=120)
        except AdapterError as e:
            rep = getattr(e, "report", None)
            if not (isinstance(rep, dict) and isinstance(rep.get("checks"), list)):
                return {"ok": False, "status": "error", "detail": str(e), "ms": int((time.time() - t) * 1000)}
        return self._health_summary(rep, int((time.time() - t) * 1000))

    @staticmethod
    def _health_summary(rep: dict, ms: int) -> dict:
        """Summarise solana-meme-risk's own health report. Its text is another agent's output: plain str, capped,
        never acted on. A pump.fun HTTP 403 is reported as an upstream block (shown honestly, never bypassed)."""
        checks = [c for c in rep.get("checks", []) if isinstance(c, dict)]
        failed = [c for c in checks if not c.get("pass")]
        req = [str(c.get("check"))[:60] for c in failed if c.get("required")]
        detail = {str(c.get("check"))[:60]: str(c.get("detail"))[:HEALTH_DETAIL_MAX] for c in failed[:HEALTH_FAILED_MAX]}
        blocked = upstream_blocked_checks(failed)
        out = {"ok": rep.get("overall") == "pass", "status": str(rep.get("overall") or "unknown")[:20],
               "provider": str(rep.get("provider") or "")[:40] or None, "failed": [str(c.get("check"))[:60] for c in failed],
               "failed_required": req, "passed": len(checks) - len(failed), "total": len(checks), "ms": ms}
        if detail:
            out["failed_detail"] = detail
        if blocked:
            out["upstream_blocked"] = {"source": "pump.fun", "checks": blocked, "note": UPSTREAM_NOTE}
        return out
