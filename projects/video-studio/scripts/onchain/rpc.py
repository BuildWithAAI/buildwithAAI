"""Minimal Solana JSON-RPC client: disk cache, rate limit, exponential backoff.

Python 3 standard library only. No case data lives here.

    from rpc import RPC
    rpc = RPC(cache_dir="/path/to/private/cache")      # cache holds raw responses
    sigs = rpc.call("getSignaturesForAddress", [addr, {"limit": 1000}])

Rules this client enforces:
  * every successful raw response is written to <cache_dir>/<method>/<sha256>.json
    and served from there on later calls, so nothing is fetched twice;
  * at most `rps` requests per second across ALL processes on this machine that
    use this module (one shared lock file serialises the clock; override its
    path with the ONCHAIN_RPC_LOCK environment variable);
  * HTTP 429 / 5xx / network errors / JSON-RPC rate-limit errors are retried with
    exponential backoff (1 s, 2 s, 4 s ... capped at 60 s, with jitter).

The cache directory may contain wallet addresses: keep it in a gitignored place.
"""

import fcntl
import hashlib
import json
import os
import random
import time
import urllib.error
import urllib.request

DEFAULT_URL = "https://api.mainnet-beta.solana.com"
# Shared by every process that imports this module, so parallel jobs together
# stay under the limit. data/ is gitignored in this repo.
_HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_LOCK = os.environ.get(
    "ONCHAIN_RPC_LOCK",
    os.path.join(os.path.dirname(os.path.dirname(_HERE)), "data", "private", ".rpc-ratelimit"))


# Seconds between calls of one method, shared by all processes (see _wait_turn).
METHOD_INTERVALS = {
    "getTransaction": float(os.environ.get("ONCHAIN_RPC_TX_INTERVAL", "1.05")),
    "getSignaturesForAddress": float(os.environ.get("ONCHAIN_RPC_SIG_INTERVAL", "1.05")),
}


class RPCError(Exception):
    pass


class RPC:
    def __init__(self, cache_dir, url=DEFAULT_URL, rps=4.0, max_retries=8, timeout=60):
        self.url = url
        self.cache_dir = cache_dir
        self.min_interval = 1.0 / float(rps)
        self.max_retries = max_retries
        self.timeout = timeout
        os.makedirs(cache_dir, exist_ok=True)
        self._lock_path = DEFAULT_LOCK
        os.makedirs(os.path.dirname(self._lock_path), exist_ok=True)
        self.stats = {"cache_hits": 0, "network_calls": 0, "retries": 0}

    # ---------- cache ----------
    def _key(self, method, params):
        blob = json.dumps([method, params], sort_keys=True, separators=(",", ":"))
        return hashlib.sha256(blob.encode()).hexdigest()

    def _path(self, method, params):
        d = os.path.join(self.cache_dir, method)
        os.makedirs(d, exist_ok=True)
        return os.path.join(d, self._key(method, params) + ".json")

    def cached(self, method, params):
        p = self._path(method, params)
        if os.path.exists(p):
            with open(p) as f:
                return json.load(f)
        return None

    # ---------- rate limit (cross-process) ----------
    def _wait_turn(self, method=None):
        """Global pacing (<= rps overall) plus per-method pacing.

        The public mainnet-beta endpoint answers with
        `x-ratelimit-method-limit: 10` for getTransaction and
        getSignaturesForAddress (10 calls per 10 s per IP), so those methods
        are paced at METHOD_INTERVALS[method] seconds across all processes.
        """
        per = METHOD_INTERVALS.get(method, 0.0)
        mpath = self._lock_path + ".methods.json"
        with open(self._lock_path, "a+") as f:
            fcntl.flock(f, fcntl.LOCK_EX)
            try:
                # The lock file itself holds one float (last call, any method):
                # kept that way so older copies of this module stay compatible.
                f.seek(0)
                raw = f.read().strip()
                try:
                    last_all = float(raw) if raw else 0.0
                except ValueError:
                    last_all = 0.0
                try:
                    with open(mpath) as mf:
                        state = json.load(mf)
                except (OSError, ValueError):
                    state = {}
                now = time.time()
                wait = max(last_all + self.min_interval - now,
                           (state.get(method, 0.0) + per - now) if per else 0.0)
                if wait > 0:
                    time.sleep(wait)
                t = time.time()
                if method:
                    state[method] = t
                    with open(mpath + ".tmp", "w") as mf:
                        json.dump(state, mf)
                    os.replace(mpath + ".tmp", mpath)
                f.seek(0)
                f.truncate()
                f.write(repr(t))
                f.flush()
            finally:
                fcntl.flock(f, fcntl.LOCK_UN)

    # ---------- call ----------
    def call(self, method, params, cache_null=False, refresh=False):
        """Return the JSON-RPC `result`. Raw envelope is cached on disk."""
        p = self._path(method, params)
        if not refresh and os.path.exists(p):
            self.stats["cache_hits"] += 1
            with open(p) as f:
                return json.load(f)["result"]
        body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}).encode()
        delay = 1.0
        last_err = None
        for attempt in range(self.max_retries + 1):
            self._wait_turn(method)
            self.stats["network_calls"] += 1
            req = urllib.request.Request(
                self.url, data=body,
                headers={"Content-Type": "application/json", "User-Agent": "onchain-audit/0.1"})
            try:
                with urllib.request.urlopen(req, timeout=self.timeout) as r:
                    env = json.loads(r.read())
                if "error" in env:
                    code = env["error"].get("code")
                    msg = str(env["error"].get("message", ""))
                    # -32429 / -32005 / "rate" -> back off; other errors are final
                    if code in (-32429, -32005, 429) or "rate" in msg.lower() or code == -32603:
                        last_err = RPCError(f"{code} {msg}")
                    else:
                        raise RPCError(f"{method}: {code} {msg}")
                else:
                    if env.get("result") is not None or cache_null:
                        tmp = p + ".tmp"
                        with open(tmp, "w") as f:
                            json.dump(env, f)
                        os.replace(tmp, p)
                    return env.get("result")
            except urllib.error.HTTPError as e:
                if e.code == 429 or 500 <= e.code < 600:
                    last_err = e
                else:
                    raise
            except (urllib.error.URLError, TimeoutError, ConnectionError, json.JSONDecodeError) as e:
                last_err = e
            self.stats["retries"] += 1
            sleep = min(60.0, delay) * (0.8 + 0.4 * random.random())
            time.sleep(sleep)
            delay *= 2
        raise RPCError(f"{method} failed after {self.max_retries} retries: {last_err}")

    # ---------- helpers ----------
    @staticmethod
    def _tx_params(signature, version):
        return [signature, {"encoding": "jsonParsed", "maxSupportedTransactionVersion": version,
                            "commitment": "finalized"}]

    def get_transaction(self, signature, cache_only=False):
        """jsonParsed transaction. Asks with maxSupportedTransactionVersion 0
        first; if the node answers -32015 (a newer tx version) it retries with
        version 1. With cache_only=True, returns None instead of fetching."""
        for v in (0, 1):
            hit = self.cached("getTransaction", self._tx_params(signature, v))
            if hit is not None:
                self.stats["cache_hits"] += 1
                return hit["result"]
        if cache_only:
            return None
        try:
            return self.call("getTransaction", self._tx_params(signature, 0))
        except RPCError as e:
            if "-32015" not in str(e):
                raise
            return self.call("getTransaction", self._tx_params(signature, 1))

    def signatures_in_window(self, address, t_start, t_end, page_limit=1000,
                             max_pages=400, start_before=None, log=None):
        """All signatures for `address` with t_start <= blockTime < t_end.

        Pages backwards from the newest signature (or `start_before`) with the
        `before` cursor until blockTime < t_start. Returns (rows, meta).
        The first page (no cursor) is a snapshot of 'now'; it is cached like any
        other response, so reruns are reproducible.
        """
        rows, before, pages = [], start_before, 0
        while pages < max_pages:
            opts = {"limit": page_limit, "commitment": "finalized"}
            if before:
                opts["before"] = before
            page = self.call("getSignaturesForAddress", [address, opts], cache_null=True) or []
            pages += 1
            if not page:
                break
            for r in page:
                bt = r.get("blockTime")
                if bt is None:
                    continue
                if t_start <= bt < t_end:
                    rows.append(r)
            oldest = page[-1].get("blockTime") or 0
            if log:
                log(f"  page {pages}: {len(page)} sigs, oldest blockTime {oldest}, kept {len(rows)}")
            if oldest < t_start or len(page) < page_limit:
                break
            before = page[-1]["signature"]
        return rows, {"pages": pages, "complete": pages < max_pages}
