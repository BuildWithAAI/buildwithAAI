"""Single healthcheck across store, audit chain, risk config, adapters."""
from __future__ import annotations
import json, os, re, time
from . import audit
from .adapters.registry import build
from .config import HARD_MAX_RISK_PER_TRADE
from .ledger import PaperLedger
from .store import Store, dumps


def run(cfg: dict, store: Store | None = None, network: bool = True, deep: bool = False) -> dict:
    t0 = time.time()
    store = store or Store(cfg["store"]["path"])
    checks = []

    def add(name, required, fn):
        t = time.time()
        try:
            res = fn()
            ok = res.get("ok")
        except Exception as e:  # health must never crash
            res, ok = {"detail": f"{type(e).__name__}: {e}"}, False
        checks.append({"check": name, "pass": ok, "required": required, "ms": int((time.time() - t) * 1000), "detail": res})

    def store_check():
        store.execute("CREATE TEMP TABLE IF NOT EXISTS _hc(x)"); store.execute("INSERT INTO _hc VALUES(1)")
        v = store.one("SELECT value FROM meta WHERE key='schema_version'")
        return {"ok": True, "path": cfg["store"]["path"], "schema_version": v and v["value"],
                "size_bytes": os.path.getsize(cfg["store"]["path"]) if os.path.exists(cfg["store"]["path"]) else None}

    def audit_check():
        v = audit.verify(store)
        return {**v}

    def risk_check():
        r = cfg["risk"]
        ok = r["max_risk_per_trade"] <= HARD_MAX_RISK_PER_TRADE and cfg["account"]["mode"] == "paper"
        led = PaperLedger(store, cfg)
        return {"ok": ok, "mode": cfg["account"]["mode"], "max_risk_per_trade": r["max_risk_per_trade"],
                "kill_switch": led.kill_switch(), "equity": led.equity()}

    add("store_rw", True, store_check)
    add("audit_chain_intact", True, audit_check)
    add("risk_config_and_paper_mode", True, risk_check)
    ad = build(cfg, store)
    def lt_check():
        from . import longterm as lt
        lt_cfg = cfg["longterm"]
        pol = lt.enforce_policies(store, cfg)
        roth = next((p for p in pol["policies"] if p["account_id"] == "onepay_roth"), None)
        roth_ok = bool(roth) and roth["executor"] == "user" and roth["agent_role"] == "auditor" and roth["ticketing"] == "disabled"
        live_roth = store.one("SELECT COUNT(*) n FROM lt_order_tickets WHERE account_id='onepay_roth' AND status IN ('draft','confirmed_by_user')")["n"]
        ok = lt_cfg["mode"] == "draft_tickets_only" and "longterm" not in cfg["risk"]["sector_caps"] and roth_ok and live_roth == 0
        return {"ok": ok, "onepay_roth_policy": roth, "onepay_roth_live_tickets": live_roth, "retired_drafts": pol["retired_drafts"], "mode": lt_cfg["mode"], "kill_switch_scope": lt_cfg["kill_switch_scope"],
                "accounts_seeded": store.one("SELECT COUNT(*) n FROM lt_accounts")["n"], "holdings_source": lt.holdings_source(store)}

    add("longterm_bucket_ringfenced", True, lt_check)
    def hud_token_check():
        tok = os.environ.get("AAI_HUD_TOKEN")
        if tok:
            return {"ok": True, "detail": "AAI_HUD_TOKEN is set; HUD auth is on (header, Bearer, or cookie)."}
        from .hud import resolve_hud_token
        if resolve_hud_token():
            return {"ok": True, "source": "token_file",
                    "detail": "AAI_HUD_TOKEN comes from the 0600 token file scripts/hud_restart.sh loads; HUD auth is on."}
        return {"ok": False,
                "detail": "AAI_HUD_TOKEN is not set; HUD is localhost-only. Set the token before any remote access."}

    add("hud_token_configured", False, hud_token_check)  # optional banner: missing token must stay visible, not fail overall
    add("billy_research_files", False, ad["billy"].health)
    if network:
        add("blofin_public_ticker", True, ad["blofin"].health)
        add("solana_meme_risk_health", True, lambda: ad["solana_meme"].health(quick=not deep))
    for k in ("trader_audit", "terminal_hud", "forex", "bybit"):
        add(f"placeholder_{k}", False, ad[k].health)
    add("stocks_quotes", False, ad["stocks"].health)  # optional: Yahoo equity quotes via intel markets
    add("longterm_holdings", False, ad["longterm_feed"].health)  # optional: manual CSV snapshots; MISSING until imported
    def layout_check():
        from . import shotcheck
        return shotcheck.health()
    add("hud_layout_shotdiff", False, layout_check)  # optional: last out-of-band screenshot grid diff vs blessed baseline
    def zoora_check():
        from .hud import create_app, hud_token
        app = create_app(cfg, store, ad, heavy=False)
        c = app.test_client()
        h = {"X-AAI-Token": hud_token()} if hud_token() else {}
        # Stream: short max_sec so healthcheck does not hang on the generator.
        stream = c.get("/api/zoora/stream?max_sec=2&tick_sec=0.05", headers=h)
        stream_ok = (stream.status_code == 200
                     and "text/event-stream" in (stream.content_type or "")
                     and b"event:" in stream.data)
        res = {"page": c.get("/zoora", headers=h).status_code, "overview": c.get("/api/zoora/overview", headers=h).status_code,
               "stream": stream.status_code, "stream_ctype": (stream.content_type or "").split(";")[0],
               "stream_has_event": bool(stream_ok),
               "status_intent": c.post("/api/zoora", json={"text": "status", "source": "healthcheck"}, headers=h).status_code,
               "trade_refused": c.post("/api/zoora", json={"text": "place a real order to buy BTC", "source": "healthcheck"},
                                       headers=h).status_code,
               "place_order_refused": c.post("/api/command", json={"cmd": "place_order"}, headers=h).status_code,
               "economy": c.get("/api/economy", headers=h).status_code,
               "economy_history": c.get("/api/economy/history", headers=h).status_code,
               "equity_curve": c.get("/api/zoora/equity-curve?days=7", headers=h).status_code,
               "stocks": c.get("/api/stocks", headers=h).status_code,
               "economy_intent": c.post("/api/zoora", json={"text": "economy ladder", "source": "healthcheck"}, headers=h).status_code,
               "intel": c.get("/api/intel", headers=h).status_code,
               "intel_feed": c.get("/api/intel/rates", headers=h).status_code,
               "intel_unknown_404": c.get("/api/intel/nope", headers=h).status_code,
               "brief_intent": c.post("/api/zoora", json={"text": "brief me", "source": "healthcheck"}, headers=h).status_code,
               "auth": "on" if hud_token() else "off"}
        if hud_token():
            res["no_token_rejected"] = c.get("/api/zoora/overview").status_code
        ok = (res["page"] == 200 and res["overview"] == 200 and stream_ok and res["status_intent"] == 200 and res["trade_refused"] == 403
              and res["place_order_refused"] == 403 and res["economy"] == 200 and res["economy_history"] == 200 and res["equity_curve"] == 200 and res["stocks"] == 200 and res["economy_intent"] == 200
              and res["intel"] == 200 and res["intel_feed"] == 200 and res["intel_unknown_404"] == 404 and res["brief_intent"] == 200
              and res.get("no_token_rejected", 401) == 401)
        return {"ok": ok, **res}

    def zoora_live():
        from . import runtime
        import requests
        d = runtime.read_hud()
        if not d or not d.get("alive"):
            return {"ok": None, "status": "not_running", "detail": d}
        from .hud import resolve_hud_token
        tok = resolve_hud_token()  # env, else the 0600 file hud_restart.sh loads; never printed
        base = f"http://{d['host']}:{d['port']}"
        hdr = {"X-AAI-Token": tok} if tok else {}
        r = requests.get(base + "/api/zoora/overview", headers=hdr, timeout=10)
        p = requests.get(base + "/zoora", headers=hdr, timeout=10, allow_redirects=False)
        out = {"ok": r.status_code == 200 and p.status_code == 200, "url": base + "/zoora", "pid": d["pid"],
               "overview": r.status_code, "page": p.status_code, "localhost_only": d["host"] in ("127.0.0.1", "localhost", "::1"),
               "auth": "on" if tok else "off"}
        if tok:
            out["no_token_rejected"] = requests.get(base + "/api/zoora/overview", timeout=10).status_code
            out["ok"] = out["ok"] and out["no_token_rejected"] == 401

        def open_url(path: str) -> str:
            # the token never goes on a browser command line: a single-use 60 s ticket is swapped for the cookie
            return hud_ticket_url(base, path, tok) if tok else base + path

        if tok:
            out["login_console"] = browser_console_errors(base + "/zoora/login")
        try:
            out["console"] = browser_console_errors(open_url("/zoora?nosse=1"))
        except Exception as e:  # ticket mint failed: report it, never fall back to the raw token
            out["console"] = {"ok": False, "errors": [f"ticket mint failed: {type(e).__name__}"], "n_errors": 1}
        # also a narrow layout (headless Chrome clamps windows to >= 500 px, so this covers the 820 px breakpoint,
        # not the 480 px one) and an arena-arm deep link (opens the arm detail drawer on load)
        arm = None
        try:
            arms = (((r.json().get("ext") or {}).get("perps") or {}).get("paper") or {}).get("arms") or []
            ok_ids = [a for a in arms if re.fullmatch(r"[\w-]{1,40}", str(a.get("id") or ""))]
            ok_ids.sort(key=lambda a: -(len(a.get("open_trades") or []) + len(a.get("resting") or []) + len(a.get("trades") or [])))
            arm = ok_ids[0]["id"] if ok_ids else None  # the busiest arm exercises the most drawer code
        except (ValueError, AttributeError, TypeError):
            arm = None
        layouts = {
            "narrow_500": browser_console_errors(open_url("/zoora?nosse=1"), window=(500, 900)),
            # force high-contrast for one load (?hc=1 does not write localStorage) so the theme CSS/JS path is exercised
            "hc_theme": browser_console_errors(open_url("/zoora?nosse=1&hc=1"), window=(1440, 900)),
            # true 390 px: headless Chrome clamps --window-size to >=500, so a same-origin iframe harness
            # (X-Frame-Options SAMEORIGIN + frame-ancestors 'self' only when ?embed=1) exercises the 480 px CSS.
            "narrow_390": browser_console_errors(open_url("/zoora/narrow"), window=(1440, 900), budget_ms=8000),
        }
        if arm:
            layouts["arm_deeplink"] = browser_console_errors(open_url(f"/zoora?nosse=1#arm={arm}"), window=(1440, 900))
        out["console_layouts"] = {k: {"ok": v.get("ok"), "n_errors": v.get("n_errors"), "errors": v.get("errors"),
                                      **({"status": v["status"]} if "status" in v else {})} for k, v in layouts.items()}
        if out["console"].get("ok") is False or (out.get("login_console") or {}).get("ok") is False or any(v.get("ok") is False for v in layouts.values()):
            out["ok"] = False
        return out

    add("zoora_endpoints", True, zoora_check)
    add("zoora_live_hud", False, zoora_live)
    req_fail = [c["check"] for c in checks if c["required"] and not c["pass"]]
    rep = {"overall": "pass" if not req_fail else "fail", "failed_required": req_fail, "checked_at": time.time(),
           "ms": int((time.time() - t0) * 1000), "network": network, "checks": checks}
    store.execute("INSERT INTO health_runs(ts,overall,report) VALUES(?,?,?)", (rep["checked_at"], rep["overall"], dumps(rep)))
    return rep


def hud_ticket_url(base: str, path: str, tok: str) -> str:
    """Mint a single-use login ticket on the live HUD and return base+path with ?ticket=... (fragment kept last)."""
    import requests
    r = requests.post(base + "/api/zoora/auth/ticket", headers={"X-AAI-Token": tok, "Content-Type": "application/json"},
                      data="{}", timeout=10)
    r.raise_for_status()
    t = r.json()["ticket"]
    p, _, frag = path.partition("#")
    return base + p + ("&" if "?" in p else "?") + "ticket=" + t + ("#" + frag if frag else "")


_CHROMES = ("google-chrome", "google-chrome-stable", "chromium", "chromium-browser")
def browser_console_errors(url: str, budget_ms: int = 6000, timeout: float = 45.0, window: tuple | None = None) -> dict:
    """Load `url` in headless Chrome and report every JS console message (uncaught errors, CSP refusals, console.*).
    The Zoora client logs nothing on a healthy load, so any CONSOLE line is a finding. Localhost URLs only."""
    import shutil, subprocess
    from urllib.parse import urlparse
    u = urlparse(url)
    if u.scheme == "http" and u.hostname not in ("127.0.0.1", "localhost", "::1"):
        return {"ok": None, "status": "refused", "detail": "console check only loads localhost or file:// pages"}
    if u.scheme not in ("http", "file"):
        return {"ok": None, "status": "refused", "detail": "unsupported scheme"}
    exe = next((shutil.which(c) for c in _CHROMES if shutil.which(c)), None)
    if not exe:
        return {"ok": None, "status": "no_browser", "detail": "headless Chrome not installed"}
    # headless Chrome (--headless=new) runs on its own temporary profile, so a ticket cookie never outlives the check.
    # (An explicit --user-data-dir makes it hang after --dump-dom, so it is not passed.) --disable-extensions keeps a
    # machine-policy force-installed extension from logging into the console; parse_console drops any that still do.
    cmd = [exe, "--headless=new", "--no-sandbox", "--disable-gpu", "--enable-logging=stderr", "--v=0", "--disable-extensions",
           f"--virtual-time-budget={int(budget_ms)}"]
    if window:
        cmd.append(f"--window-size={int(window[0])},{int(window[1])}")
    cmd += ["--dump-dom", url]
    try:
        p = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    except subprocess.TimeoutExpired:
        return {"ok": None, "status": "timeout", "detail": f"browser did not finish in {timeout:.0f}s"}
    return parse_console(p.stderr or "", len(p.stdout or ""))


_CONSOLE_RX = None


def parse_console(stderr: str, dom_bytes: int = 0) -> dict:
    """Console findings from headless Chrome's stderr. Lines whose source is a browser extension
    (chrome-extension://, e.g. a machine-policy force-installed password manager) are not the page's and are
    counted as `ignored_extension`, never as Zoora findings; everything else still fails the check."""
    import re
    global _CONSOLE_RX
    if _CONSOLE_RX is None:
        _CONSOLE_RX = re.compile(r':CONSOLE(?:\(\d+\)|:\d+)\]\s*(.*)$')
    msgs, ignored = [], 0
    for line in (stderr or "").splitlines():
        m = _CONSOLE_RX.search(line)
        if not m:
            continue
        if re.search(r'source:\s*chrome-extension://', m.group(1)):
            ignored += 1
            continue
        msgs.append(m.group(1)[:300])
    out = {"ok": not msgs, "errors": msgs[:10], "n_errors": len(msgs), "dom_bytes": dom_bytes}
    if ignored:
        out["ignored_extension"] = ignored
    return out

