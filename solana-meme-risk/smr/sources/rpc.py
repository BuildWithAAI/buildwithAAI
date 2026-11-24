"""Solana JSON-RPC with an endpoint pool.

Each endpoint has its own token bucket and circuit breaker. Calls go to the first healthy endpoint
(priority order: Helius if HELIUS_API_KEY is set, then publicnode, then api.mainnet-beta) and fail
over on rate limits / errors. Responses are cached deterministically (see smr.cache).
"""
from __future__ import annotations
import os, threading, time
import requests
from ..cache import DiskCache, make_key, CacheMiss
from ..resilience import TokenBucket, CircuitBreaker, backoff_delays
from .. import logging_setup as L

log = L.get("rpc")

# TTL seconds; None = immutable. Signature pages anchored with `before` are immutable for finalized history.
RPC_TTL = {"getTransaction": None, "getBlockTime": None, "getSignaturesForAddress": 120, "getAccountInfo": 60,
           "getMultipleAccounts": 60, "getTokenLargestAccounts": 60, "getProgramAccounts": 60, "getSlot": 0,
           "getHealth": 0, "getVersion": 0}
RETRY_CODES = {-32004, -32005, -32007, -32009, -32014, -32016, 429, -32429}
NOT_RETRYABLE_MSG = ("not supported", "excluded from account secondary indexes", "Invalid param")
FAILOVER_CODES = {-32020}   # e.g. publicnode cannot resolve a `before` anchor signature -> ask another endpoint
# A null result for these is retried on the next endpoint before being believed. Measured 2026-11-01: publicnode
# returns null for *version 1* transactions (new tx format, widely used by trading bots); mainnet-beta serves them.
NULL_FAILOVER_METHODS = {"getTransaction"}
# Per-method HTTP timeout (seconds). Measured 2026-11-03: mainnet-beta serves historical getTransaction in ~5-7 s;
# a call still hanging at 15 s is almost always stuck, so it is abandoned and retried (same request, same result)
# instead of blocking a tracer thread for the full default timeout. Env SMR_RPC_TX_TIMEOUT_S overrides.
def _default_method_timeouts():
    return {"getTransaction": float(os.environ.get("SMR_RPC_TX_TIMEOUT_S", "15"))}


class RpcError(Exception):
    pass


class _Ep:
    def __init__(self, ep):
        self.cfg = ep
        self.bucket = TokenBucket(ep.rps, ep.burst)
        self.breaker = CircuitBreaker(ep.name)
        self.stats = {"calls": 0, "ok": 0, "rate_limited": 0, "errors": 0, "lat_ms_sum": 0.0}
        self.session = requests.Session()


class RpcPool:
    def __init__(self, endpoints, cache: DiskCache, max_attempts: int = 7, timeout: float = 45, method_timeouts=None):
        self.eps = [_Ep(e) for e in endpoints]
        self.cache, self.max_attempts, self.timeout = cache, max_attempts, timeout
        self.method_timeouts = _default_method_timeouts() if method_timeouts is None else dict(method_timeouts)
        self._lock = threading.Lock()
        self.stats = {"calls": 0, "cache_hits": 0, "null_failovers": 0, "history_skips": 0, "timeouts": 0}

    def _timeout_for(self, method):
        return min(self.timeout, self.method_timeouts.get(method, self.timeout))

    @property
    def name(self):
        return "+".join(e.cfg.name for e in self.eps)

    def _ttl(self, method, params):
        ttl = RPC_TTL.get(method, 60)
        if method == "getSignaturesForAddress" and len(params) > 1 and isinstance(params[1], dict) and params[1].get("before"):
            ttl = None   # history strictly before a finalized signature never changes
        return ttl

    def call(self, method: str, params=None, *, ttl="auto", prefer_gpa=False, skip_eps=()):
        params = params or []
        ttl = self._ttl(method, params) if ttl == "auto" else ttl
        k = make_key("rpc", method, params)
        hit = self.cache.get(k, ttl)
        if hit is not None:
            self.stats["cache_hits"] += 1
            if isinstance(hit, dict) and len(hit) == 1:      # outcomes captured only by the fixture recorder
                if "__rpc_error__" in hit:
                    raise RpcError(hit["__rpc_error__"])
                if "__null__" in hit:
                    return None
            return hit
        try:
            res = self._network(method, params, prefer_gpa, skip_eps)
        except RpcError as e:
            if self.cache.recorder is not None:
                self.cache.recorder[k] = {"__rpc_error__": str(e)}
            raise
        if res is not None:
            self.cache.set(k, res, ttl)
        elif self.cache.recorder is not None:
            self.cache.recorder[k] = {"__null__": True}
        return res

    def _candidates(self, method):
        eps = [e for e in self.eps if method != "getProgramAccounts" or e.cfg.supports_gpa]
        return eps or self.eps

    def _network(self, method, params, prefer_gpa=False, skip_eps=()):
        last_err = None
        delays = backoff_delays(self.max_attempts)
        skip = set(skip_eps)
        got_null = False
        for attempt in range(self.max_attempts):
            eps = [e for e in self._candidates(method) if e.breaker.allow() and e.cfg.name not in skip]
            if not eps:
                if got_null:
                    return None
                if skip:
                    raise RpcError(f"{method}: {last_err}")
                time.sleep(next(delays, 5)); continue
            ep = eps[attempt % len(eps)] if attempt and len(eps) > 1 else eps[0]
            ep.bucket.acquire()
            ep.stats["calls"] += 1; self.stats["calls"] += 1
            t = time.monotonic()
            try:
                r = ep.session.post(ep.cfg.url, json={"jsonrpc": "2.0", "id": 1, "method": method, "params": params}, timeout=self._timeout_for(method))
                ep.stats["lat_ms_sum"] += (time.monotonic() - t) * 1000
                if r.status_code == 429:
                    ep.stats["rate_limited"] += 1
                    ep.bucket.penalize(float(r.headers.get("Retry-After") or 2))
                    last_err = f"{ep.cfg.name} HTTP 429"; continue
                if r.status_code >= 500:
                    ep.breaker.failure(); ep.stats["errors"] += 1
                    last_err = f"{ep.cfg.name} HTTP {r.status_code}"; time.sleep(next(delays, 2)); continue
                j = r.json()
            except (requests.RequestException, ValueError) as e:
                if isinstance(e, requests.Timeout):
                    ep.stats["timeouts"] = ep.stats.get("timeouts", 0) + 1
                    with self._lock:
                        self.stats["timeouts"] += 1
                ep.breaker.failure(); ep.stats["errors"] += 1
                last_err = f"{ep.cfg.name} {type(e).__name__}: {e}"; time.sleep(next(delays, 2)); continue
            if "error" in j:
                err = j["error"]; code = err.get("code"); msg = str(err.get("message"))
                if code in (429, -32429) or "Too many" in msg or "rate limit" in msg.lower():
                    ep.stats["rate_limited"] += 1; ep.bucket.penalize(2.0)
                    last_err = f"{ep.cfg.name} rate limited"; continue
                if code in FAILOVER_CODES:
                    skip.add(ep.cfg.name); last_err = f"{ep.cfg.name} {code} {msg}"; continue
                if code in RETRY_CODES:
                    last_err = f"{ep.cfg.name} {code} {msg}"; time.sleep(next(delays, 2)); continue
                if any(s in msg for s in NOT_RETRYABLE_MSG) and len(self._candidates(method)) > 1 and attempt == 0:
                    last_err = f"{ep.cfg.name}: {msg}"; ep.breaker.failure(); continue
                ep.breaker.success()
                raise RpcError(f"{method} via {ep.cfg.name}: {err}")
            ep.breaker.success(); ep.stats["ok"] += 1
            res = j.get("result")
            if res is None and method in NULL_FAILOVER_METHODS and len(self._candidates(method)) > 1:
                got_null = True; skip.add(ep.cfg.name); self.stats["null_failovers"] += 1
                ep.stats["nulls"] = ep.stats.get("nulls", 0) + 1
                last_err = f"{ep.cfg.name} returned null"
                continue
            return res
        if got_null:
            return None
        L.event(log, "rpc retries exhausted", method=method, err=last_err, level=30)
        raise RpcError(f"{method}: retries exhausted ({last_err})")

    # ---- wrappers -------------------------------------------------------------------------------------------------
    def _history_skips(self, block_time, now=None):
        """Endpoints whose served tx history cannot reach `block_time`; never skips every candidate."""
        if not block_time:
            return ()
        now = time.time() if now is None else now
        age_h = (now - block_time) / 3600.0
        cands = self._candidates("getTransaction")
        skip = {e.cfg.name for e in cands if getattr(e.cfg, "tx_history_hours", None) is not None and age_h > e.cfg.tx_history_hours}
        return () if len(skip) >= len(cands) else tuple(sorted(skip))

    def get_transaction(self, sig, block_time=None):
        """block_time (optional, from the signatures page) lets us skip endpoints that cannot serve a tx that old.
        The cache key does not depend on it, so results are identical with or without the hint."""
        skip = self._history_skips(block_time)
        if skip:
            with self._lock:
                self.stats["history_skips"] += 1
        return self.call("getTransaction", [sig, {"encoding": "jsonParsed", "maxSupportedTransactionVersion": 1, "commitment": "confirmed"}],
                         skip_eps=skip)

    def get_signatures(self, address, limit=1000, before=None, until=None, ttl="auto"):
        opts = {"limit": limit}
        if before: opts["before"] = before
        if until: opts["until"] = until
        return self.call("getSignaturesForAddress", [address, opts], ttl=ttl) or []

    def get_account_info(self, address, encoding="jsonParsed"):
        return self.call("getAccountInfo", [address, {"encoding": encoding}])

    def get_multiple_accounts(self, addresses):
        out = []
        for i in range(0, len(addresses), 100):
            res = self.call("getMultipleAccounts", [addresses[i:i + 100], {"encoding": "jsonParsed"}])
            out.extend((res or {}).get("value", []))
        return out

    def get_token_accounts_for_mint(self, mint, token_program):
        return self.call("getProgramAccounts", [token_program, {"encoding": "jsonParsed", "filters": [{"memcmp": {"offset": 0, "bytes": mint}}]}]) or []

    def health(self):
        out = {}
        for e in self.eps:
            t = time.monotonic()
            try:
                r = e.session.post(e.cfg.url, json={"jsonrpc": "2.0", "id": 1, "method": "getSlot"}, timeout=15).json()
                out[e.cfg.name] = {"ok": "result" in r, "latency_ms": round((time.monotonic() - t) * 1000), "slot": r.get("result")}
            except Exception as ex:
                out[e.cfg.name] = {"ok": False, "error": str(ex)[:200]}
        return out

    def snapshot(self):
        return {"cache_hits": self.stats["cache_hits"], "network_calls": self.stats["calls"],
                "history_skips": self.stats["history_skips"], "timeouts": self.stats["timeouts"],
                "endpoints": {e.cfg.name: {**{k: v for k, v in e.stats.items() if k != "lat_ms_sum"},
                                           "avg_latency_ms": round(e.stats["lat_ms_sum"] / max(1, e.stats["calls"]), 1),
                                           "breaker": e.breaker.snapshot()} for e in self.eps}}
