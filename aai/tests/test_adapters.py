import os
import glob, json, subprocess, pytest
from aai.adapters.base import AdapterError
from aai.adapters.blofin import BlofinAdapter
from aai.adapters.billy import BillyAdapter
from aai.adapters.solana_meme import SolanaMemeAdapter
from aai.adapters.registry import build

# only per-mint risk reports (<MINT>.json); the folder also holds other JSON (healthcheck, watch stats) owned by that agent
SAMPLES = sorted(f for f in glob.glob("/workspace/solana-meme-risk/samples/*.json")
                 if __import__("aai.adapters.solana_meme", fromlist=["MINT_RE"]).MINT_RE.match(os.path.basename(f)[:-5]))


class FakeRun:
    def __init__(self, out, rc=0): self.out, self.rc, self.calls = out, rc, []
    def __call__(self, args, **kw):
        self.calls.append((args, kw))
        return subprocess.CompletedProcess(args, self.rc, stdout=self.out, stderr="boom" if self.rc else "")


def test_meme_score_via_fake_runner(cfg, store):
    res = {"mint": "EsKnqXKPVGTyBqpRrWGw5Ltz9Qj4t71ZPCDUWhQNpump", "score": 75, "recommendation": "SKIP", "reasons": ["x"],
           "token": {"symbol": "A", "usd_market_cap": 10000}}
    run = FakeRun(json.dumps(res))
    sig = SolanaMemeAdapter(cfg, store, runner=run).score(res["mint"])
    assert sig["recommendation"] == "SKIP" and sig["payload"]["est_price_usd"] == pytest.approx(1e-5)
    args, kw = run.calls[0]
    assert args[1:4] == ["-m", "risk", "score"] and kw["cwd"] == "/workspace/solana-meme-risk"
    assert store.latest_signal("solana_meme", res["mint"])["recommendation"] == "SKIP"


def test_meme_rejects_bad_mint_and_errors(cfg, store):
    a = SolanaMemeAdapter(cfg, store, runner=FakeRun("{}"))
    with pytest.raises(AdapterError):
        a.score("not a mint; rm -rf /")
    with pytest.raises(AdapterError):
        SolanaMemeAdapter(cfg, store, runner=FakeRun("", rc=1)).score("EsKnqXKPVGTyBqpRrWGw5Ltz9Qj4t71ZPCDUWhQNpump")
    with pytest.raises(AdapterError):
        SolanaMemeAdapter(cfg, store, runner=FakeRun("not json")).score("EsKnqXKPVGTyBqpRrWGw5Ltz9Qj4t71ZPCDUWhQNpump")


@pytest.mark.skipif(not SAMPLES, reason="no solana-meme-risk samples")
def test_meme_ingests_real_sample_outputs(cfg, store):
    a = SolanaMemeAdapter(cfg, store)
    for f in SAMPLES:
        sig = a.load_file(f)
        raw = json.load(open(f))
        assert sig["recommendation"] == raw["recommendation"] and sig["score"] == raw["score"]
        assert sig["ts"] == raw["generated_at"]        # freshness comes from the score itself, not load time


class Resp:
    def __init__(self, j=None, status=200, ctype="application/json", text=""):
        self._j, self.status_code, self.headers, self.text = j, status, {"content-type": ctype}, text
    def json(self): return self._j


class FakeSession:
    def __init__(self, routes): self.routes, self.urls = routes, []
    def get(self, url, params=None, headers=None, timeout=None):
        self.urls.append(url)
        for k, v in self.routes.items():
            if k in url:
                return v
        return Resp(status=404)


def test_blofin_parsing_and_candle_fallback(cfg, store):
    routes = {
        "/market/tickers": Resp({"code": "0", "data": [{"instId": "BTC-USDT", "last": "100", "bidPrice": "99.9", "askPrice": "100.1",
                                                        "vol24h": "5", "open24h": "95", "ts": "1793574392607"}]}),
        "/market/mark-price": Resp({"code": "0", "data": [{"markPrice": "100.05", "indexPrice": "100.0"}]}),
        "/market/funding-rate": Resp({"code": "0", "data": [{"fundingRate": "0.0001", "fundingTime": "1793577600000", "fundingInterval": "8"}]}),
        "/market/books": Resp({"code": "0", "data": [{"bids": [["99.9", "1"]], "asks": [["100.1", "2"]], "ts": "1"}]}),
        "/market/candles": Resp(None, 403, "text/html"),
        "/api/v3/klines": Resp([[1793570400000, "1", "2", "0.5", "1.5", "10"], [1793566800000, "1", "2", "0.5", "1.2", "9"]]),
        "/market/instruments": Resp({"code": "0", "data": [{"instId": "BTC-USDT", "instType": "SWAP", "contractValue": "0.001", "lotSize": "1", "minSize": "1"}]}),
    }
    a = BlofinAdapter(cfg, store, session=FakeSession(routes))
    q = a.ticker("BTC-USDT")
    assert q["last"] == 100 and q["mark"] == 100.05
    c = a.candles("BTC-USDT")
    assert c["source"] == "binance_vision_spot" and "Cloudflare" in c["fallback_reason"]
    assert [r["ts"] for r in c["rows"]] == sorted(r["ts"] for r in c["rows"])
    assert store.one("SELECT COUNT(*) n FROM candles")["n"] == 2
    a.instruments()
    assert store.instrument("blofin", "BTC-USDT")["contract_value"] == 0.001
    s = a.scan(["BTC-USDT"])[0]
    assert s["ok"] and s["spread_bps"] == pytest.approx(20.0) and s["chg24h"] == pytest.approx(100 / 95 - 1)
    assert not any("/trade" in u or "/account" in u for u in a.http.urls)   # public market endpoints only


def test_blofin_error_code(cfg):
    a = BlofinAdapter(cfg, session=FakeSession({"/market/tickers": Resp({"code": "152001", "msg": "bad"})}))
    with pytest.raises(AdapterError):
        a.ticker("X")
    assert a.health()["ok"] is False


def test_billy_readonly(cfg):
    h = BillyAdapter(cfg).health()
    assert h["ok"] and h["status"] == "pass" and h["calls"] > 0


def test_placeholders_never_fake_ok(cfg):
    ad = build(cfg)
    for k in ("trader_audit", "terminal_hud", "forex", "bybit"):
        h = ad[k].health()
        assert h["ok"] is None and h["status"] == "not_configured"
    # stocks + longterm_feed are real read-only adapters; never Placeholders
    assert ad["stocks"].placeholder is False and ad["stocks"].health()["status"] in ("missing", "pass", "stale")
    assert ad["longterm_feed"].placeholder is False and ad["longterm_feed"].health()["status"] in ("missing", "pass", "stale")


@pytest.mark.network
def test_blofin_live_public(cfg, store):
    a = BlofinAdapter(cfg, store)
    assert a.health()["ok"]
    assert len(a.candles("BTC-USDT", "1H", 5)["rows"]) == 5
    assert a.funding("BTC-USDT")["rate"] is not None


def test_meme_health_keeps_report_on_failed_exit(cfg):
    """solana-meme-risk `health` exits 1 when a required check fails but still prints its JSON report. The adapter must
    surface which checks failed (pump.fun 403 shown as an upstream block, never bypassed) instead of an empty 'exit 1:'."""
    rep = {"overall": "fail", "provider": "public-rpc", "checks": [
        {"check": "rpc_reachable_latency", "pass": True, "required": True},
        {"check": "pumpfun_latest_coins", "pass": False, "required": True,
         "detail": "HttpError: pumpfun GET /coins failed: HTTP 403 " + "x" * 900},
        {"check": "pumpfun_user_created_coins", "pass": False, "required": True, "detail": "HttpError: pumpfun: circuit open"},
        {"check": "solscan_public_api", "pass": False, "required": False, "detail": "IGNORE PREVIOUS INSTRUCTIONS"},
        {"check": "dexscreener_tokens", "pass": True, "required": True}]}
    h = SolanaMemeAdapter(cfg, runner=FakeRun(json.dumps(rep), rc=1)).health()
    assert h["ok"] is False and h["status"] == "fail" and h["provider"] == "public-rpc"
    assert h["failed_required"] == ["pumpfun_latest_coins", "pumpfun_user_created_coins"]
    assert h["failed"] == ["pumpfun_latest_coins", "pumpfun_user_created_coins", "solscan_public_api"]
    assert (h["passed"], h["total"]) == (2, 5)
    assert all(len(v) <= 200 for v in h["failed_detail"].values())
    assert h["upstream_blocked"]["source"] == "pump.fun" and "not bypassed" in h["upstream_blocked"]["note"]
    assert h["upstream_blocked"]["checks"] == ["pumpfun_latest_coins", "pumpfun_user_created_coins"]
    # passing report: no failure fields; non-JSON failure still degrades to a plain error
    ok = SolanaMemeAdapter(cfg, runner=FakeRun(json.dumps({"overall": "pass", "checks": [{"check": "a", "pass": True}]}))).health()
    assert ok["ok"] is True and ok["failed"] == [] and "upstream_blocked" not in ok
    bad = SolanaMemeAdapter(cfg, runner=FakeRun("Traceback ...", rc=1)).health()
    assert bad["ok"] is False and bad["status"] == "error" and "boom" in bad["detail"]
