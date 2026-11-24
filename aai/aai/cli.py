"""aai CLI: healthcheck | hud | score | load-score | scan | ingest-perps | submit | kill | resume | risk | economy | economy-grant | economy-grants | economy-reconcile | economy-snapshot | economy-events | lt-holdings-import | audit | intel"""
from __future__ import annotations
import argparse, json, os, socket, sys
from . import audit, config, economy, grants, snapshots, health, improve_lock, longterm as lt, reports, runtime
from .adapters.registry import build
from .ledger import PaperLedger
from .models import Idea
from .store import Store


def free_port(host="127.0.0.1") -> int:
    with socket.socket() as s:
        s.bind((host, 0)); return s.getsockname()[1]


def main(argv=None):
    ap = argparse.ArgumentParser(prog="aai", description="AAI unified pipeline (paper only)")
    sub = ap.add_subparsers(dest="cmd", required=True)
    h = sub.add_parser("healthcheck"); h.add_argument("--offline", action="store_true"); h.add_argument("--deep", action="store_true")
    u = sub.add_parser("hud"); u.add_argument("--port", type=int); u.add_argument("--host")
    s = sub.add_parser("score"); s.add_argument("mint")
    l = sub.add_parser("load-score"); l.add_argument("path")
    sc = sub.add_parser("scan"); sc.add_argument("symbols", nargs="*", default=["BTC-USDT", "ETH-USDT", "SOL-USDT"])
    ip = sub.add_parser("ingest-perps"); ip.add_argument("symbols", nargs="*", default=["BTC-USDT", "ETH-USDT", "SOL-USDT"]); ip.add_argument("--bar", default="1H")
    sb = sub.add_parser("submit"); sb.add_argument("json", help="idea JSON")
    k = sub.add_parser("kill"); k.add_argument("reason")
    r = sub.add_parser("resume"); r.add_argument("--confirm", required=True); r.add_argument("reason")
    sub.add_parser("risk")
    sub.add_parser("economy", help="read-only paper scorecard, ladder stage eligibility, paper weights")
    eg = sub.add_parser("economy-grant", help="HUMAN ONLY: record a granted paper ladder stage (0 = revoke). ECONOMY.md E2")
    eg.add_argument("strategy"); eg.add_argument("stage", type=int)
    eg.add_argument("--by", required=True, help="who signs off (a human)"); eg.add_argument("--quote", required=True, help="verbatim sign-off")
    eg.add_argument("--confirm", required=True, help="must be GRANT")
    gl = sub.add_parser("economy-grants", help="read-only granted-stage registry history"); gl.add_argument("strategy", nargs="?"); gl.add_argument("-n", type=int, default=50)
    sub.add_parser("economy-reconcile", help="log auto-demotions where a granted stage is above current eligibility")
    es = sub.add_parser("economy-snapshot", help="append today's economy snapshot + stage-change events (once per CT day). ECONOMY.md E6")
    es.add_argument("--force", action="store_true", help="take another snapshot even if today's exists")
    ee = sub.add_parser("economy-events", help="read-only stage-change feed + snapshot history"); ee.add_argument("-n", type=int, default=30)
    sub.add_parser("lt-seed"); sub.add_parser("lt-summary")
    la = sub.add_parser("lt-audit"); la.add_argument("account", nargs="?", default="onepay_roth")
    li = sub.add_parser("lt-holdings-import", help="CLI-only: import a manual holdings CSV (audit-only, append-only; never tickets)")
    li.add_argument("path", help="CSV with symbol,quantity[,cost_basis_usd,price_usd,value_usd,verified]")
    li.add_argument("--account", default="onepay_roth", help="longterm account_id (default onepay_roth)")
    li.add_argument("--source", default="manual", choices=["manual", "plaid", "exchange_readonly_api", "onchain_public"],
                    help="source label stored on the snapshot (DB CHECK; default manual)")
    vr = sub.add_parser("ingest-report"); vr.add_argument("path")
    a2 = sub.add_parser("audit"); a2.add_argument("-n", type=int, default=20); a2.add_argument("--verify", action="store_true")
    ht = sub.add_parser("hud-ticket", help="print a single-use 60 s login URL for the running locked HUD (headless screenshots)")
    ht.add_argument("path", nargs="?", default="/zoora", help="HUD path, e.g. '/zoora?nosse=1' (fragment allowed)")
    il = sub.add_parser("improve-lock", help="lock for automated improvement runs (.improve.lock)")
    il.add_argument("action", choices=["acquire", "release", "status"]); il.add_argument("--owner", default="manual")
    il.add_argument("--ttl", type=int, default=1800, help="seconds before a held lock counts as stale")
    il.add_argument("--force", action="store_true", help="release even if held by another owner")
    it = sub.add_parser("intel", help="institutional market intel (aai/intel): refresh feeds into the cache, status, show")
    it.add_argument("action", choices=["refresh", "status", "show", "brief"])
    it.add_argument("feeds", nargs="*", help="feed names (default: all); 'show' takes one")
    it.add_argument("--force", action="store_true", help="refresh even if not due / breaker open")
    ga = sub.add_parser("guard-audit", help="run agent-guard audit.py with a hard timeout; records timed_out instead of hanging")
    ga.add_argument("--timeout", type=float, default=240)
    sc = sub.add_parser("shot-check", help="HUD screenshot layout regression vs blessed baselines (records verdict for healthcheck/HUD)")
    sc.add_argument("action", choices=["check", "bless", "status"])
    sc.add_argument("layout", nargs="?", help="desk | phone"); sc.add_argument("png", nargs="?", help="screenshot PNG path")
    a = ap.parse_args(argv)
    if a.cmd == "shot-check":
        from . import shotcheck
        if a.action == "status":
            print(json.dumps(shotcheck.summary(), indent=2)); return
        if not a.layout or not a.png:
            sys.exit(f"shot-check {a.action} needs LAYOUT PNG")
        try:
            res = shotcheck.check(a.layout, a.png) if a.action == "check" else shotcheck.bless(a.layout, a.png)
        except (ValueError, OSError) as e:
            sys.exit(f"shot-check {a.action}: {e}")
        print(json.dumps(res, indent=2))
        sys.exit(0 if res.get("ok") else (2 if res.get("verdict") in ("ERROR", "NO_BASELINE") else 1))
    if a.cmd == "guard-audit":
        from . import guard_audit
        res = guard_audit.run(timeout=a.timeout)
        try:
            res["saved"] = guard_audit.save(res)  # HUD agent-guard chip reads this (status/elapsed/time only)
        except OSError as e:
            res["saved"] = {"error": str(e)[:200]}
        print(json.dumps(res, indent=2)); sys.exit({"pass": 0, "timed_out": 4}.get(res["status"], 1))
    if a.cmd == "hud-ticket":
        from .hud import resolve_hud_token
        from .health import hud_ticket_url
        if not a.path.startswith("/zoora") or "//" in a.path:
            sys.exit("path must be a /zoora... HUD path")
        d = runtime.read_hud()
        if not d or not d.get("alive"):
            sys.exit("HUD is not running (scripts/hud_restart.sh)")
        base = f"http://{d['host']}:{d['port']}"
        tok = resolve_hud_token()
        print(hud_ticket_url(base, a.path, tok) if tok else base + a.path)  # the token itself is never printed
        return
    if a.cmd == "improve-lock":
        res = {"acquire": lambda: improve_lock.acquire(a.owner, a.ttl), "release": lambda: improve_lock.release(a.owner, a.force),
               "status": improve_lock.status}[a.action]()
        print(json.dumps(res, indent=2)); sys.exit(0 if res.get("ok", True) else 3)

    cfg = config.load()
    store = Store(cfg["store"]["path"])
    out = lambda o: print(json.dumps(o, indent=2, default=str))
    if a.cmd == "healthcheck":
        rep = health.run(cfg, store, network=not a.offline, deep=a.deep)
        out(rep); sys.exit(0 if rep["overall"] == "pass" else 1)
    if a.cmd == "hud":
        from .hud import create_app
        host = a.host or cfg["hud"]["host"]
        port = a.port or cfg["hud"]["port"] or free_port(host)
        if host not in ("127.0.0.1", "localhost", "::1"):  # hard rule: no env override
            sys.exit(f"refusing to bind {host}: the HUD is localhost-only (see IMPROVEMENTS.md, remote access needs approval)")
        print(f"AAI HUD on http://{host}:{port}  (Zoora at /zoora, auth={'on' if os.environ.get('AAI_HUD_TOKEN') else 'off'})", flush=True)
        app = create_app(cfg, store, heavy=True)
        runtime.write_hud(host, port)
        app.run(host=host, port=port, debug=False, use_reloader=False, threaded=True)
        return
    if a.cmd == "intel":
        from .intel.service import Intel
        intel = Intel(cfg, store)
        bad = [f for f in a.feeds if f not in intel.feeds]
        if bad:
            sys.exit(f"unknown feed(s) {bad}; one of: {', '.join(intel.feeds)}")
        if a.action == "refresh":
            res = intel.refresh(a.feeds or None, force=a.force)
            out(res); sys.exit(0 if all(r.get("ok") is not False for r in res) else 1)
        if a.action == "status":
            out([{k: v[k] for k in ("feed", "status", "source", "fetched_ct", "age_sec", "latency_ms", "consecutive_fails", "last_error",
                                     "stale_reason", "breaker_open_until") if k in v} for v in (intel.view(n) for n in (a.feeds or intel.feeds))])
        elif a.action == "show":
            if len(a.feeds) != 1:
                sys.exit("intel show takes exactly one feed")
            out(intel.view(a.feeds[0], history=True))
        else:
            print(intel.brief_text())
        return
    ad = build(cfg, store)
    led = PaperLedger(store, cfg)
    if a.cmd == "score":
        sig = ad["solana_meme"].score(a.mint)
        audit.record(store, "signal_scored", actor="cli", ref=a.mint, inputs={"mint": a.mint}, outcome=sig["recommendation"], reasons=sig["payload"]["reasons"])
        out(sig)
    elif a.cmd == "load-score":
        out(ad["solana_meme"].load_file(a.path))
    elif a.cmd == "scan":
        out(ad["blofin"].scan(a.symbols))
    elif a.cmd == "ingest-perps":
        ad["blofin"].instruments()
        res = {}
        for sym in a.symbols:
            c = ad["blofin"].candles(sym, a.bar)
            res[sym] = {"candles": len(c["rows"]), "source": c["source"], "ticker": ad["blofin"].ticker(sym)["last"], "funding": ad["blofin"].funding(sym)["rate"]}
        out(res)
    elif a.cmd == "submit":
        out(led.submit(Idea.from_dict(json.loads(a.json)), actor="cli").to_dict())
    elif a.cmd == "kill":
        out(led.set_kill_switch(True, a.reason, "cli"))
    elif a.cmd == "resume":
        if a.confirm != "RESUME":
            sys.exit("refusing: --confirm RESUME required")
        out(led.set_kill_switch(False, a.reason, "cli"))
    elif a.cmd == "economy":
        out(economy.scorecard(store, cfg))
    elif a.cmd == "economy-grant":
        try:
            out(grants.grant(store, cfg, a.strategy, a.stage, by=a.by, quote=a.quote, confirm=a.confirm, actor="cli"))
        except grants.GrantError as e:
            sys.exit(f"refused: {e}")
    elif a.cmd == "economy-grants":
        out(grants.history(store, a.strategy, a.n))
    elif a.cmd == "economy-reconcile":
        out(grants.reconcile(store, cfg, actor="cli"))
    elif a.cmd == "economy-snapshot":
        out(snapshots.take(store, cfg, actor="cli", force=a.force))
    elif a.cmd == "economy-events":
        out(snapshots.history(store, a.n))
    elif a.cmd == "risk":
        out(led.risk_summary())
    elif a.cmd == "lt-seed":
        out(lt.seed(store, cfg))
    elif a.cmd == "lt-audit":
        lt.enforce_policies(store, cfg); out(lt.account_audit(store, cfg, a.account, actor="cli"))
    elif a.cmd == "lt-summary":
        out({**lt.summary(store), "tickets": lt.tickets(store)})
    elif a.cmd == "lt-holdings-import":
        try:
            out(lt.import_holdings_csv(store, a.path, a.account, source=a.source, actor="cli"))
        except (lt.HoldingsImportError, ValueError) as e:
            sys.exit(f"refused: {e}")
    elif a.cmd == "ingest-report":
        res = reports.ingest(store, json.load(open(a.path))); out(res); sys.exit(0 if res["ok"] else 1)
    elif a.cmd == "audit":
        out(audit.verify(store) if a.verify else audit.tail(store, a.n))


if __name__ == "__main__":
    main()
