"""`python -m aai health`: aai-core sources + caches + schema + tests, plus smr's own health (nested).

Same JSON shape as smr. Required checks: >=1 crypto perp venue, forex (yahoo), equity (yahoo), cache rw,
schema, imports, quick tests, smr health (quick) overall=pass. Individual venues (bybit/blofin/okx),
frankfurter and smr's optional checks are reported but optional.
"""
from __future__ import annotations
import os, subprocess, sys, tempfile, time
from ..config import Settings, REPO
from ..data.registry import Market
from ..infra.cache import DiskCache, make_key
from ..infra.health import Health, SkipCheck, validate_shape
from ..risk import decision as D
from . import smr_bridge


def run(quick: bool = False, tests: bool = True, smr: bool = True, settings: Settings | None = None) -> dict:
    st = settings or Settings()
    h = Health(provider="public:" + ",".join(st.perp_venues) + ",yahoo,frankfurter" + ("+smr" if smr else ""))
    m = Market(st, DiskCache(st.cache_path, "off"))   # health must hit the network, not the cache
    pf = m.feed("crypto_perp")
    ok_venues = []

    for name, v in pf.venues.items():
        def chk(v=v, name=name):
            st_ = time.time()
            rows = v.candles("BTC", "USDT", "1h", 5)
            q = v.quote("BTC", "USDT")
            ok_venues.append(name)
            return {"candles": len(rows), "last": q.last, "spread_bps": q.spread_bps, "funding_rate": (q.perp or {}).get("funding_rate"),
                    "oi_usd": (q.perp or {}).get("open_interest_usd")}
        h.run(f"crypto_perp:{name}", chk, required=False)
    h.run("crypto_perp:any_venue", lambda: (bool(ok_venues), {"working": ok_venues, "order": st.perp_venues}), required=True)

    fx = m.feed("forex")
    h.run("forex:yahoo_eurusd", lambda: {"candles_1h": len(fx.candles("EURUSD", "1h", 50).candles), "last": fx.quote("EURUSD").last}, required=True)
    h.run("forex:frankfurter_ecb", lambda: (lambda r: (r.get("rate") is not None, r))(fx.ecb_check("EURUSD")), required=False)
    eq = m.feed("equity")
    h.run("equity:yahoo_spy", lambda: {"candles_1d": len(eq.candles("SPY", "1d").candles), "last": eq.quote("SPY").last}, required=True)

    def cache_rw():
        c = DiskCache(st.cache_path, "readwrite"); k = make_key("health", time.time())
        c.set(k, {"x": 1}, 60); return (c.get(k, 60) == {"x": 1}, st.cache_path)
    h.run("cache_db_rw", cache_rw)

    def schema_ok():
        import json, jsonschema
        jsonschema.Draft202012Validator.check_schema(json.load(open(D.SCHEMA_PATH)))
        return D.SCHEMA_PATH
    h.run("schema:risk_decision.v1", schema_ok)

    def imports():
        import importlib
        mods = ["aai_core.infra.cache", "aai_core.infra.resilience", "aai_core.infra.http", "aai_core.infra.health",
                "aai_core.infra.replay", "aai_core.infra.logging", "aai_core.data.crypto", "aai_core.data.forex",
                "aai_core.data.equity", "aai_core.risk.sizing", "aai_core.risk.vol", "aai_core.risk.liquidity",
                "aai_core.risk.portfolio", "aai_core.risk.guardrails", "aai_core.risk.decision", "aai_core.hub.assess"]
        for x in mods:
            importlib.import_module(x)
        return f"{len(mods)} modules"
    h.run("imports", imports)

    if tests:
        def run_tests():
            p = subprocess.run([sys.executable, "-m", "pytest", "-q", "-m", "not network", "-p", "no:cacheprovider", os.path.join(REPO, "tests")],
                               cwd=REPO, capture_output=True, text=True, timeout=300)
            tail = (p.stdout.strip().splitlines() or ["no output"])[-1]
            return (p.returncode == 0, tail)
        h.run("tests_quick", run_tests)

    if smr:
        def smr_health():
            r = smr_bridge.health(st, quick=True)
            probs = validate_shape(r)
            failed = [c["check"] for c in r.get("checks", []) if not c["pass"]]
            return (r.get("overall") == "pass" and not probs,
                    {"overall": r.get("overall"), "provider": r.get("provider"), "n_checks": len(r.get("checks", [])),
                     "failed": failed, "shape_problems": probs, "home": st.smr_home})
        h.run("smr_health", smr_health, required=True)

    if not quick:
        def e2e():
            from .assess import assess
            d = assess("crypto_perp", "BTCUSDT", bankroll=10000, risk_pct=1, settings=st, market=m)
            return {"line": d["line"], "schema_valid": not D.validate(d)}
        h.run("e2e_assess_crypto_perp", e2e)
    return h.result()
