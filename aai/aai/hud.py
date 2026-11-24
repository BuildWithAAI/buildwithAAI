"""HUD: Flask JSON API + the Zoora command HUD (served at / and /zoora; the old JSON page is at /classic).

Binds 127.0.0.1 by default. When AAI_HUD_TOKEN is set, EVERY page and /api/* route requires it, supplied as the
X-AAI-Token header, an "Authorization: Bearer" header, or the HttpOnly SameSite=Strict cookie set by /zoora/login
(or by opening /?token=... once). Host must be 127.0.0.1 or localhost, optionally :57025; anything else is 403
(DNS-rebinding defence). POSTs must be JSON and same-origin. There is no live-execution command;
everything is paper. Zoora (aai/zoora.py) can only read, run health checks, score a mint, or log paper ideas."""
from __future__ import annotations
import hashlib, hmac, html, json, os, secrets, threading, time
from urllib.parse import urlencode
from pathlib import Path
from flask import Flask, Response, jsonify, make_response, redirect, request, stream_with_context
from . import audit, change_stream, guard, health as health_mod, longterm as lt, reports
from .health_cache import HealthReportCache
from .adapters.base import AdapterError
from .adapters.registry import build
from .ledger import PaperLedger
from .models import Idea
from .store import Store
from .zoora import Zoora

STATIC = Path(__file__).resolve().parent / "static" / "zoora"
COOKIE = "aai_token"
OPEN_PATHS = ("/zoora/login",)
# DNS-rebinding defence: only loopback Host headers, with or without the HUD port.
ALLOWED_HOSTS = frozenset({"127.0.0.1", "127.0.0.1:57025", "localhost", "localhost:57025"})
CSP = ("default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; "
       "connect-src 'self'; worker-src 'self'; manifest-src 'self'; media-src 'self'; object-src 'none'; "
       "base-uri 'none'; frame-ancestors 'none'; form-action 'self'")
# Same-origin framing only when ?embed=1 (390 px console harness). HUD stays localhost-only.
CSP_EMBED = CSP.replace("frame-ancestors 'none'", "frame-ancestors 'self'")

PAGE = """<!doctype html><meta charset=utf-8><title>AAI HUD (paper)</title>
<style>body{font:14px system-ui;margin:2em;background:#0d1117;color:#c9d1d9}pre{background:#161b22;padding:1em;overflow:auto}
h2{color:#58a6ff}</style><h1>AAI HUD &mdash; PAPER ONLY</h1><p><a href=/zoora style=color:#58a6ff>Zoora HUD</a></p><div id=o></div><script>
const eps=['risk','positions','ideas?limit=10','longterm'];
Promise.all(eps.map(e=>fetch('/api/'+e).then(r=>r.json()))).then(rs=>{document.getElementById('o').innerHTML=
rs.map((r,i)=>'<h2>/api/'+eps[i]+'</h2><pre>'+JSON.stringify(r,null,2)+'</pre>').join('')})</script>"""

LOGIN = """<!doctype html><html lang=en><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1">
<title>Zoora · locked</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#03070d;color:#bfefff;
font:16px system-ui}form{border:1px solid #0ff4;padding:28px;border-radius:14px;background:#06121c;box-shadow:0 0 40px #0ff2;width:min(360px,86vw)}
h1{font-size:18px;letter-spacing:.3em;color:#3ef0ff;margin:0 0 6px}p{color:#7fa9b8;font-size:13px}input{width:100%;box-sizing:border-box;
padding:12px;margin:10px 0;background:#020a10;border:1px solid #0ff5;color:#e6fbff;border-radius:8px;font-size:15px}
button{width:100%;padding:12px;background:#0b3b46;border:1px solid #3ef0ff;color:#3ef0ff;border-radius:8px;letter-spacing:.2em;font-weight:700}
.e{color:#ff6b6b}</style><form method=post action=/zoora/login><h1>ZOORA</h1><p>AAI command HUD is locked. Enter the AAI_HUD_TOKEN
Zoorped configured on the host.</p>%ERR%<input type=text name=username value=zoorped autocomplete=username hidden aria-hidden=true tabindex=-1><input type=password name=token autocomplete=current-password autofocus aria-label=Token>
<button>UNLOCK</button></form></html>"""


def safe(payload, max_len: int = 400):
    """Classic /api/* JSON goes through the agent_guard sanitiser (aai.guard.clean_deep) like Zoora's own endpoints:
    strings from ideas, reports, audit notes and positions can originate from other agents, so they are hostile data."""
    return jsonify(guard.clean_deep(payload, max_len=max_len))


def hud_token() -> str:
    return os.environ.get("AAI_HUD_TOKEN") or ""


DEFAULT_TOKEN_FILE = "/home/box/.config/aai/hud_token"


def resolve_hud_token() -> str:
    """Client-side lookup (healthcheck, `aai hud-ticket`): $AAI_HUD_TOKEN, else the 0600 file that
    scripts/hud_restart.sh loads ($AAI_HUD_TOKEN_FILE, default ~/.config/aai/hud_token). Never generates one.
    The server itself only trusts its own environment (hud_token)."""
    tok = hud_token()
    if tok:
        return tok
    try:
        return Path(os.environ.get("AAI_HUD_TOKEN_FILE") or DEFAULT_TOKEN_FILE).read_text().strip()
    except OSError:
        return ""


class TicketBook:
    """Single-use, short-lived login tickets so headless Chrome (console checks, screenshots) can open the
    locked HUD without the token ever appearing on a command line. Minting needs the token; a ticket is
    stored only as a SHA-256 hash, expires in `ttl` seconds, and is burned on first use."""

    def __init__(self, ttl: float = 60.0, cap: int = 16):
        self.ttl, self.cap, self._lock, self._t = float(ttl), int(cap), threading.Lock(), {}

    @staticmethod
    def _h(t: str) -> str:
        return hashlib.sha256(t.encode()).hexdigest()

    def mint(self) -> str:
        t = secrets.token_urlsafe(24)
        now = time.time()
        with self._lock:
            self._t = {k: v for k, v in self._t.items() if v > now}
            while len(self._t) >= self.cap:  # drop the oldest; never grows unbounded
                self._t.pop(min(self._t, key=self._t.get))
            self._t[self._h(t)] = now + self.ttl
        return t

    def redeem(self, t: str) -> bool:
        if not t or len(t) > 64:
            return False
        with self._lock:
            exp = self._t.pop(self._h(t), None)
        return exp is not None and exp > time.time()

    def pending(self) -> int:
        now = time.time()
        with self._lock:
            return sum(1 for v in self._t.values() if v > now)


def _supplied_token() -> str:
    h = request.headers.get("X-AAI-Token")
    if h:
        return h
    a = request.headers.get("Authorization", "")
    if a.lower().startswith("bearer "):
        return a[7:].strip()
    return request.cookies.get(COOKIE, "")


def _ok(tok: str, supplied: str) -> bool:
    return bool(supplied) and hmac.compare_digest(supplied.encode(), tok.encode())


def host_allowed(host: str | None) -> bool:
    """True only for 127.0.0.1 / localhost, bare or with port 57025. Compared case-insensitively."""
    if not host:
        return False
    return host.strip().lower() in ALLOWED_HOSTS


def create_app(cfg: dict, store: Store | None = None, adapters: dict | None = None, heavy: bool = False) -> Flask:
    """heavy=True starts background live health checks of the other pipelines (the `aai hud` server does this)."""
    app = Flask(__name__)
    store = store or Store(cfg["store"]["path"])
    led = PaperLedger(store, cfg)
    lt.enforce_policies(store, cfg)
    ad = adapters or build(cfg, store)
    zo = Zoora(cfg, store, led, ad, start_heavy=heavy)
    zo.health_cache = HealthReportCache(lambda net: health_mod.run(cfg, store, network=net),
                                        ttl=float((cfg.get("hud") or {}).get("health_cache_ttl_sec", 120)))
    if heavy:
        zo.health_cache.kick(True)  # warm the cache so the first /api/health caller does not wait ~40 s
    app.config.update(AAI_CFG=cfg, AAI_STORE=store, AAI_LEDGER=led, ZOORA=zo)
    asset_v = str(int(max((f.stat().st_mtime for f in STATIC.glob("*.*")), default=0)))

    voice = VoiceService(cfg, zo.voice_context)
    app.config["ZOORA_VOICE"] = voice
    register_voice(app, voice)

    tickets = TicketBook(ttl=float((cfg.get("hud") or {}).get("ticket_ttl_sec", 60)))
    app.config["AAI_TICKETS"] = tickets

    def err(msg, code=400):
        return jsonify({"ok": False, "error": msg}), code

    @app.before_request
    def gate():
        # Host check first, before auth, so a rebound Host never reaches login or APIs.
        if not host_allowed(request.headers.get("Host")):
            return err("forbidden host", 403)
        if request.method == "POST":
            origin = request.headers.get("Origin")
            if origin and origin.rstrip("/") != request.host_url.rstrip("/"):
                return err("cross-origin POST refused", 403)
            voice_audio = request.path == "/api/voice/transcribe" and (request.mimetype or "").startswith("audio/")
            if request.path.startswith("/api/") and not request.is_json and not voice_audio:
                return err("POST body must be application/json", 415)
        tok = hud_token()
        if not tok or request.path in OPEN_PATHS:
            return None
        if _ok(tok, _supplied_token()):
            return None
        tk = request.args.get("ticket")
        if tk and request.method == "GET" and not request.path.startswith("/api/"):
            if tickets.redeem(tk):
                audit.record(store, "hud_ticket_login", actor="hud", outcome="ok")
                rest = [(k, v) for k, v in request.args.items(multi=True) if k not in ("ticket", "token")]
                resp = redirect(request.path + ("?" + urlencode(rest) if rest else ""))  # browser keeps any #fragment
                resp.set_cookie(COOKIE, tok, httponly=True, samesite="Strict", secure=request.is_secure, max_age=3600)
                return resp
            audit.record(store, "hud_ticket_login", actor="hud", outcome="denied")
        q = request.args.get("token")
        if q and request.method == "GET" and not request.path.startswith("/api/") and _ok(tok, q):
            resp = redirect(request.path)  # strip the token from the URL bar/history
            resp.set_cookie(COOKIE, q, httponly=True, samesite="Strict", secure=request.is_secure, max_age=30 * 86400)
            return resp
        if request.path.startswith("/api/"):
            return err("unauthorized: send X-AAI-Token (AAI_HUD_TOKEN)", 401)
        return redirect("/zoora/login")

    @app.after_request
    def headers(resp):
        resp.headers.setdefault("X-Content-Type-Options", "nosniff")
        resp.headers.setdefault("Referrer-Policy", "no-referrer")
        resp.headers.setdefault("X-Frame-Options", "DENY")
        resp.headers.setdefault("Permissions-Policy", "microphone=(self), camera=(), geolocation=()")
        if request.path.startswith("/api/"):
            resp.headers["Cache-Control"] = "no-store"
        return resp

    def zoora_page():
        body = (STATIC / "index.html").read_text().replace("{{V}}", asset_v)
        resp = make_response(body)
        # ?embed=1: allow same-origin iframe for the 390 px console harness. Default stays unframed.
        if request.args.get("embed") == "1":
            resp.headers["Content-Security-Policy"] = CSP_EMBED
            resp.headers["X-Frame-Options"] = "SAMEORIGIN"
        else:
            resp.headers["Content-Security-Policy"] = CSP
        resp.headers["Cache-Control"] = "no-store"
        return resp

    @app.get("/")
    def index():
        return zoora_page()

    @app.get("/zoora")
    def zoora_index():
        return zoora_page()

    @app.get("/zoora/narrow")
    def zoora_narrow():
        """390×844 iframe harness for the true phone breakpoint (Chrome clamps --window-size >= 500).
        Localhost only; iframe loads /zoora?nosse=1&noboot=1&embed=1 (SAMEORIGIN). Harness has no scripts."""
        body = (STATIC / "narrow.html").read_text().replace("{{V}}", asset_v)
        resp = make_response(body)
        resp.headers["Content-Security-Policy"] = CSP
        resp.headers["Cache-Control"] = "no-store"
        return resp

    @app.get("/sw.js")
    def zoora_sw():
        """Service worker for the Zoora offline shell. Scope `/` via Service-Worker-Allowed.
        Caches static HUD assets only (see sw.js); never /api/*. Localhost HUD only."""
        body = (STATIC / "sw.js").read_text()
        resp = make_response(body)
        resp.headers["Content-Type"] = "application/javascript; charset=utf-8"
        resp.headers["Service-Worker-Allowed"] = "/"
        resp.headers["Cache-Control"] = "no-cache"
        resp.headers["Content-Security-Policy"] = CSP
        return resp

    @app.get("/zoora/offline")
    def zoora_offline():
        """Cached offline fallback page (also at /static/zoora/offline.html)."""
        body = (STATIC / "offline.html").read_text()
        resp = make_response(body)
        resp.headers["Content-Security-Policy"] = CSP
        resp.headers["Cache-Control"] = "no-store"
        return resp


    @app.get("/classic")
    def classic():
        return PAGE

    @app.get("/zoora/login")
    def login_page():
        if not hud_token():
            return redirect("/zoora")
        return LOGIN.replace("%ERR%", "")

    @app.post("/zoora/login")
    def login_post():
        tok = hud_token()
        if not tok:
            return redirect("/zoora")
        given = request.form.get("token", "")
        if not _ok(tok, given):
            audit.record(store, "hud_login", actor="hud", outcome="denied")
            time.sleep(0.5)
            return LOGIN.replace("%ERR%", "<p class=e>Wrong token.</p>"), 401
        audit.record(store, "hud_login", actor="hud", outcome="ok")
        resp = redirect("/zoora")
        resp.set_cookie(COOKIE, given, httponly=True, samesite="Strict", secure=request.is_secure, max_age=30 * 86400)
        return resp

    @app.post("/api/zoora/auth/ticket")
    def api_auth_ticket():
        """Mint a single-use login ticket (needs the token, like every /api route). Open
        /zoora?ticket=... once to get the session cookie. 409 when the HUD is unlocked (nothing to mint)."""
        if not hud_token():
            return err("HUD auth is off; no ticket needed", 409)
        audit.record(store, "hud_ticket_mint", actor="hud", outcome="ok")
        return jsonify({"ok": True, "ticket": tickets.mint(), "ttl_sec": tickets.ttl, "single_use": True})

    @app.post("/zoora/logout")
    def logout():
        resp = redirect("/zoora/login")
        resp.delete_cookie(COOKIE)
        return resp

    # ---------------- Zoora API
    @app.get("/api/zoora/overview")
    def api_zoora_overview():
        return jsonify({"ok": True, **zo.overview()})

    @app.get("/api/zoora/stream")
    def api_zoora_stream():
        """Server-sent events for overview. Pushes when meta.change_id flips; heartbeats otherwise.
        Read-only, localhost-bound like the rest of the HUD. Query: since=<change_id>, max_sec (2..120)."""
        since = request.headers.get("Last-Event-ID") or request.args.get("since") or None
        if since is not None:
            since = str(since)[:64]
        try:
            max_sec = float(request.args.get("max_sec") or 90)
        except (TypeError, ValueError):
            max_sec = 90.0
        try:
            tick_sec = float(request.args.get("tick_sec") or 1.0)
        except (TypeError, ValueError):
            tick_sec = 1.0
        gen = change_stream.iter_overview_events(zo, since=since, max_sec=max_sec, tick_sec=tick_sec)
        resp = Response(stream_with_context(gen), mimetype="text/event-stream")
        resp.headers["Cache-Control"] = "no-cache, no-transform"
        resp.headers["X-Accel-Buffering"] = "no"
        resp.headers["Connection"] = "keep-alive"
        return resp

    @app.get("/api/zoora/equity-curve")
    def api_zoora_equity_curve():
        # Paper equity window for panel-02 range chips. Read-only; days clamped to 1/7/30.
        return jsonify({"ok": True, "curve": zo.equity_curve_for(request.args.get("days", 7))})

    @app.get("/api/stocks")
    def api_stocks():
        """Read-only Yahoo equity quotes (SPY/QQQ/IWM) via intel markets cache. Never invents ideas."""
        return safe({"ok": True, **zo.stocks_panel()}, max_len=200)

    @app.get("/api/zoora/pipelines")
    def api_zoora_pipelines():
        return jsonify({"ok": True, **zo.heavy.snapshot(kick=heavy)})

    @app.post("/api/zoora/refresh")
    def api_zoora_refresh():
        started = zo.heavy.refresh(force=True)
        zo._ov_ts = 0
        return jsonify({"ok": True, "started": started})

    def econ_sync():
        """GET /api/economy, the economy panel and the 'economy' intent read the same scorecard source."""
        zo.economy_arena = bool(app.config.get("AAI_ECONOMY_ARENA", True))
        zo.economy_arena_root = app.config.get("AAI_ECONOMY_ARENA_ROOT")

    @app.get("/api/zoora/guard-audit")
    def api_zoora_guard_audit():
        """Last recorded agent-guard audit (typed fields only) + the one-click runner state. Read-only."""
        return jsonify({"ok": True, "last": zo._guard_audit_last(), "run": zo.guard_audit_run_state()})

    @app.post("/api/zoora/guard-audit/run")
    def api_zoora_guard_audit_run():
        """Start one bounded background run of Security's audit.py (unchanged script, same runner as the CLI).
        Same-origin JSON POST + token gate like every POST; one in flight, cooldown between starts."""
        res = zo.guard_audit_start()
        return jsonify({"ok": True, **res}), (202 if res.get("started") else 429)

    @app.post("/api/zoora")
    def api_zoora():
        econ_sync()
        body = request.get_json(silent=True) or {}
        text = body.get("text") if isinstance(body.get("text"), str) else ""
        res, code = zo.handle(text, actor="zoora_" + ("voice" if body.get("source") == "voice" else "ui"))
        return jsonify(res), code

    @app.get("/api/zoora/jobs/<jid>")
    def api_zoora_job(jid):
        j = zo.job(jid)
        if not j:
            return err("no such job", 404)
        return jsonify({"ok": True, "job": j})

    @app.get("/api/health")
    def api_health():
        """Serves the last healthcheck report instantly (with cache age) and refreshes it in the background once
        older than the TTL; `?fresh=1` forces a synchronous run. 503 whenever that report's overall is not pass."""
        net = request.args.get("network", "1") != "0"
        fresh = request.args.get("fresh", "0") == "1"
        try:
            got = zo.health_cache.get(network=net, fresh=fresh)
        except RuntimeError as e:
            return err(f"healthcheck failed: {e}", 500)
        rep = {**got["report"], "cache": got["cache"]}
        return jsonify(rep), (200 if rep["overall"] == "pass" else 503)

    @app.get("/api/score")
    def api_score():
        mint = request.args.get("mint", "").strip()
        if not mint:
            rows = store.query("SELECT id,ts,symbol AS mint,score,recommendation FROM signals WHERE sector='solana_meme' ORDER BY ts DESC LIMIT 25")
            return safe({"ok": True, "latest": rows})
        if request.args.get("refresh") == "1":
            try:
                sig = ad["solana_meme"].score(mint)
                audit.record(store, "signal_scored", actor="hud", ref=mint, inputs={"mint": mint},
                             outcome=sig["recommendation"], reasons=sig["payload"].get("reasons", []))
            except AdapterError as e:
                return err(str(e), 502)
        s = store.latest_signal("solana_meme", mint)
        if not s:
            return err("no score on record; call with refresh=1 to run solana-meme-risk", 404)
        s["age_sec"] = round(time.time() - s["ts"], 1)
        return safe({"ok": True, "signal": s})

    @app.get("/api/ideas")
    def api_ideas():
        return safe({"ok": True, "ideas": led.ideas(int(request.args.get("limit", 50)))})

    @app.get("/api/positions")
    def api_positions():
        return safe({"ok": True, "equity": led.equity(), "open": led.open_positions(), "closed": led.closed_positions()[-50:]})

    @app.get("/api/risk")
    def api_risk():
        return safe({"ok": True, **led.risk_summary()})

    @app.get("/api/audit_log")
    def api_audit_log():
        return safe({"ok": True, "verify": audit.verify(store), "entries": audit.tail(store, int(request.args.get("n", 50)), request.args.get("ref"))})

    @app.get("/api/audit")
    def api_trader_audit():
        return jsonify({"ok": False, "status": "not_configured", "detail": ad["trader_audit"].why}), 501

    @app.get("/api/longterm")
    def api_longterm():
        return safe({"ok": True, **lt.summary(store), "tickets": lt.tickets(store),
                        "cross_bucket_exposure": lt.cross_bucket_exposure(store, led)})

    @app.get("/api/longterm/audit")
    def api_lt_audit():
        try:
            return safe({"ok": True, "report": lt.account_audit(store, cfg, request.args.get("account", "onepay_roth"), actor="hud")})
        except ValueError as e:
            return err(str(e), 404)

    @app.get("/api/economy")
    def api_economy():
        """Read-only paper scorecard + promotion-ladder eligibility + paper allocation weights (ECONOMY.md).
        Also carries `panel` (one compact row per strategy) and `summary` for the Zoora economy panel (ECONOMY.md E1)."""
        econ_sync()
        return safe(zo.economy(), max_len=400)

    @app.get("/api/intel")
    def api_intel():
        """Read-only institutional intel (aai/intel): every feed's latest cached payload + status/staleness, the
        cross-asset regime heuristic and calendar alarms. Never fetches on request; the HUD refresher does that."""
        return safe(zo.intel.all(), max_len=240)

    @app.get("/api/intel/fx-desk")
    def api_intel_fx_desk():
        """T8 read-only per-pair forex overlay: COT bias in pair terms, next calendar event per pair, cached quote."""
        return safe(zo.intel.fx_desk(), max_len=240)

    @app.get("/api/intel/<feed>")
    def api_intel_feed(feed):
        if feed not in zo.intel.feeds:
            return err(f"unknown intel feed; one of: {', '.join(zo.intel.feeds)}", 404)
        return safe(zo.intel.view(feed, history=True), max_len=240)

    @app.get("/api/economy/history")
    def api_economy_history():
        """Read-only stage-change feed + daily snapshot history (ECONOMY.md E6). Never takes a snapshot."""
        try:
            n = max(1, min(100, int(request.args.get("n", 30))))
        except ValueError:
            n = 30
        try:   # optional per-strategy stage history for the sparklines (clamped 1..60 days); absent = no series
            days = max(1, min(60, int(request.args["days"]))) if request.args.get("days") else None
        except ValueError:
            days = None
        return safe(zo.economy_history(n, series_days=days), max_len=400)

    @app.get("/api/reports")
    def api_reports():
        rows = store.query("SELECT id,received_at,agent,kind,capital_bucket,generated_at,status_line FROM agent_reports ORDER BY id DESC LIMIT 50")
        return safe({"ok": True, "reports": rows})

    @app.post("/api/command")
    def api_command():
        tok = hud_token()
        if tok and not _ok(tok, _supplied_token()):
            return err("unauthorized", 401)
        body = request.get_json(silent=True) or {}
        cmd, actor = body.get("cmd"), body.get("actor", "hud_user")
        audit.record(store, "command", actor=actor, inputs=body, outcome="received")
        try:
            if cmd == "kill":
                return jsonify({"ok": True, "kill_switch": led.set_kill_switch(True, body.get("reason", "manual"), actor)})
            if cmd == "resume":
                if body.get("confirm") != "RESUME":
                    return err("resume requires confirm='RESUME'")
                return jsonify({"ok": True, "kill_switch": led.set_kill_switch(False, body.get("reason", "manual resume"), actor)})
            if cmd == "submit_idea":
                d = led.submit(Idea.from_dict(body.get("idea") or {}), actor=actor)
                return jsonify({"ok": True, "decision": d.to_dict()})
            if cmd == "mark":
                return jsonify({"ok": True, "closed": led.mark(body["symbol"], float(body["px"]), actor)})
            if cmd == "close":
                return jsonify({"ok": True, "closed": led.close(body["position_id"], float(body["px"]), "manual", actor)})
            if cmd == "scan_perps":
                return jsonify({"ok": True, "scan": ad["blofin"].scan(body.get("symbols") or ["BTC-USDT", "ETH-USDT", "SOL-USDT"])})
            if cmd == "lt_draft":
                return jsonify({"ok": True, **lt.draft_ticket(store, cfg, **(body.get("ticket") or {}))})
            if cmd == "lt_confirm":
                return jsonify({"ok": True, "ticket": lt.confirm_ticket(store, body["ticket_id"], body.get("confirmation_quote", ""), actor)})
            if cmd == "lt_done":
                return jsonify({"ok": True, "ticket": lt.mark_done(store, body["ticket_id"], body.get("user_quote", ""), actor)})
            if cmd == "ingest_report":
                res = reports.ingest(store, body.get("report") or {})
                return jsonify(res), (200 if res["ok"] else 422)
            if cmd == "audit_verify":
                return jsonify({"ok": True, **audit.verify(store)})
            if cmd in ("live", "execute_live", "place_order"):
                return err("live execution is not implemented (paper only); Phase 4 requires explicit per-trade user confirmation", 403)
            return err(f"unknown cmd {cmd!r}; one of kill|resume|submit_idea|mark|close|scan_perps|lt_draft|lt_confirm|lt_done|ingest_report|audit_verify")
        except lt.TicketingDisabled as e:
            return err(str(e), 403)
        except (KeyError, TypeError, ValueError) as e:
            return err(f"bad request: {e}")
        except AdapterError as e:
            return err(str(e), 502)

    return app


# ------------------------------------------------------------------------------------------------ Zoora voice
# Push-to-talk voice via aai.voice (STT -> LLM with web_search as its only tool -> TTS). These routes hold NO
# reference to the store, ledger, adapters, audit log or any command path: voice can never trade, spend, write
# or edit Zoora's world. Context is the allowlisted shape from Zoora.voice_context() (status words, alarm
# titles, routine names). Voice never runs unauthenticated, even in the HUD's open mode.
VOICE_MAX_AUDIO_BYTES = 10 * 1024 * 1024
VOICE_MAX_SECONDS = 60.0
VOICE_MAX_TEXT = 2000
VOICE_MAX_SPEAK = 1000
VOICE_LOOPBACK = frozenset({"127.0.0.1", "::1"})
VOICE_SLOT = {"xai": "xai-key", "openai": "openai-key", "brave": "brave-key", "tavily": "tavily-key"}
VOICE_CONTEXT_KEYS = frozenset({"hud", "mode", "time_ct", "system_health", "alarms", "routines"})
VOICE_KEYS_MISSING = "voice keys not set up"
_VOICE_STATUS_CODE = {"UnauthorizedError": 401, "InputRejectedError": 400, "KeyMissingError": 503,
                      "KeyringBackendError": 503, "InsecureURLError": 502, "ProviderError": 502}


class VoiceUnavailable(Exception):
    """aai.voice or its deps (httpx, keyring) are not installed in this interpreter."""


def voice_providers(cfg: dict) -> dict:
    v = cfg.get("voice") or {}
    stt, tts = str(v.get("stt", "xai")), str(v.get("tts", "xai"))
    search = v.get("search", "brave")
    search = None if search in (None, "", "none", False) else str(search)
    return {"llm": "xai", "stt": stt if stt in ("xai", "openai") else "xai",
            "tts": tts if tts in ("xai", "openai") else "xai",
            "search": search if search in (None, "brave", "tavily") else "brave"}


def _probe_keyring_slot(slot: str) -> tuple[bool, str | None]:
    """True when the slot holds a usable key. The value is read by aai.voice.keys and dropped here, never returned."""
    try:
        from .voice.keys import KeyringKeySource
    except Exception:  # noqa: BLE001  deps missing
        raise VoiceUnavailable() from None
    try:
        KeyringKeySource().get(slot)
        return True, None
    except Exception as e:  # noqa: BLE001  KeyMissingError / KeyringBackendError: messages never carry the key
        return False, type(e).__name__


def voice_allowlisted_context(ctx) -> dict:
    """Second, independent allowlist pass over Zoora.voice_context(): exact keys and shapes only."""
    if not isinstance(ctx, dict):
        return {}
    out = {}
    for k in ("hud", "mode", "time_ct", "system_health"):
        if isinstance(ctx.get(k), str):
            out[k] = guard.clean(ctx[k], 60)
    out["alarms"] = [{"severity": str(a["severity"])[:10], "title": guard.clean(a["title"], 80)}
                     for a in (ctx.get("alarms") or [])[:8]
                     if isinstance(a, dict) and set(a) == {"severity", "title"} and isinstance(a["title"], str)]
    out["routines"] = [{"name": guard.clean(r["name"], 80), "state": str(r["state"])[:12]}
                       for r in (ctx.get("routines") or [])[:16]
                       if isinstance(r, dict) and set(r) == {"name", "state"} and isinstance(r["name"], str)]
    assert set(out) <= VOICE_CONTEXT_KEYS
    return out


class VoiceService:
    """Owns the lazily built VoiceGateway. ``gateway`` / ``key_probe`` are injectable for tests."""

    def __init__(self, cfg: dict, context_fn, gateway=None, key_probe=None):
        self.providers = voice_providers(cfg)
        self._context_fn = context_fn
        self._gw = gateway
        self._probe = key_probe or _probe_keyring_slot
        self._lock = threading.Lock()
        self.busy = threading.BoundedSemaphore(2)  # at most two voice calls in flight

    def required_slots(self) -> list[str]:
        p = self.providers
        return sorted({VOICE_SLOT[p["llm"]], VOICE_SLOT[p["stt"]], VOICE_SLOT[p["tts"]]})

    def optional_slots(self) -> list[str]:
        return [VOICE_SLOT[self.providers["search"]]] if self.providers["search"] else []

    def gateway(self):
        with self._lock:
            if self._gw is None:
                try:
                    from .voice import VoiceGateway, constant_time_verifier
                except Exception:  # noqa: BLE001  ImportError for httpx/keyring, or any import-time failure
                    raise VoiceUnavailable() from None
                p = self.providers
                self._gw = VoiceGateway.from_keyring(token_verifier=constant_time_verifier(resolve_hud_token),
                                                     stt=p["stt"], tts=p["tts"], search=p["search"])
            return self._gw

    def context(self) -> dict:
        try:
            return voice_allowlisted_context(self._context_fn())
        except Exception:  # noqa: BLE001  context is optional; never fail an ask over it
            return {}

    def status(self) -> dict:
        req, opt = self.required_slots(), self.optional_slots()
        base = {"ok": True, "providers": dict(self.providers), "required": req, "optional": opt,
                "token_set": bool(resolve_hud_token())}
        try:
            seen = {s: self._probe(s) for s in req + opt}
        except VoiceUnavailable:
            return {**base, "available": False, "ready": False, "state": "unavailable",
                    "slots": {s: False for s in req + opt},
                    "message": "Zoora voice is not installed in this Python (pip install -r aai/voice/requirements.txt)."}
        slots = {s: bool(v[0]) for s, v in seen.items()}
        backend_bad = any(v[1] == "KeyringBackendError" for v in seen.values())
        missing = [s for s in req if not slots[s]]
        if not base["token_set"]:
            state, msg = "locked", "Zoora voice needs AAI_HUD_TOKEN set on the HUD; it never runs unlocked."
        elif missing:
            state = "keys_missing"
            msg = (f"{VOICE_KEYS_MISSING}: " + ("no OS keyring on this machine" if backend_bad else
                   "missing " + ", ".join(missing)) + ". See 'Set up Zoora voice on your PC' in the README.")
        else:
            state = "ready"
            msg = "Zoora voice ready." + ("" if all(slots[s] for s in opt) else " Web search is off (no search key).")
        return {**base, "available": True, "ready": state == "ready", "state": state, "slots": slots, "message": msg}


def _voice_duration(raw) -> float | None:
    try:
        d = float(raw)
    except (TypeError, ValueError):
        return None
    return d if d == d and 0 < d <= VOICE_MAX_SECONDS else None  # d == d rejects NaN; bound rejects inf


def _audio_mime(b: bytes) -> str:
    if b[:4] == b"RIFF":
        return "audio/wav"
    if b[:4] == b"OggS":
        return "audio/ogg"
    if b[:4] == b"fLaC":
        return "audio/flac"
    return "audio/mpeg"


def register_voice(app: Flask, svc: VoiceService) -> None:
    """Mount /api/voice/*. Takes only the VoiceService; deliberately no store, ledger, adapters or Zoora object."""

    def verr(msg, code, state=None):
        body = {"ok": False, "error": msg}
        if state:
            body["state"] = state
        resp = jsonify(body)
        resp.status_code = code
        return resp

    def authed():
        """Loopback peer + the HUD token (X-AAI-Token header, or the HttpOnly session cookie the HUD set from it)."""
        if request.remote_addr not in VOICE_LOOPBACK:
            return None, verr("Zoora voice is localhost-only", 403)
        if request.headers.get("Sec-Fetch-Site", "same-origin") not in ("same-origin", "none"):
            return None, verr("cross-site voice request refused", 403)
        tok, supplied = resolve_hud_token(), _supplied_token()
        if not tok:
            return None, verr("unauthorized: Zoora voice needs AAI_HUD_TOKEN set on the HUD", 401, "locked")
        if not supplied or len(supplied) > 512 or not _ok(tok, supplied):
            return None, verr("unauthorized: send X-AAI-Token (AAI_HUD_TOKEN)", 401)
        return supplied, None

    def fail(e: Exception):
        names = [c.__name__ for c in type(e).__mro__]
        if isinstance(e, VoiceUnavailable):
            return verr("Zoora voice is not installed on this HUD (voice unavailable)", 503, "unavailable")
        for n in names:
            if n in _VOICE_STATUS_CODE:
                code = _VOICE_STATUS_CODE[n]
                if n in ("KeyMissingError", "KeyringBackendError"):
                    return verr(f"{VOICE_KEYS_MISSING}: " + guard.clean(str(e), 200), 503, "keys_missing")
                return verr(guard.clean(str(e), 200) or n, code)
        if "VoiceError" in names:
            return verr(guard.clean(str(e), 200) or "Zoora voice error", 503)
        app.logger.warning("zoora voice: internal %s", type(e).__name__)
        return verr("Zoora voice hit an internal error", 500)

    def run(fn):
        if not svc.busy.acquire(blocking=False):
            return verr("Zoora voice is busy; try again in a moment", 429)
        try:
            return fn()
        except Exception as e:  # noqa: BLE001  every failure becomes a clean JSON status, never a crash
            return fail(e)
        finally:
            svc.busy.release()

    @app.get("/api/voice/status")
    def api_voice_status():
        _, bad = authed()
        if bad:
            return bad
        return jsonify(svc.status())

    @app.post("/api/voice/transcribe")
    def api_voice_transcribe():
        tok, bad = authed()
        if bad:
            return bad
        mime = (request.mimetype or "").lower()
        if not mime.startswith("audio/"):
            return verr("send the push-to-talk clip as an audio/* body", 415)
        n = request.content_length
        if n is None:
            return verr("Content-Length is required", 411)
        if n > VOICE_MAX_AUDIO_BYTES:
            return verr(f"audio exceeds {VOICE_MAX_AUDIO_BYTES} bytes (10 MB)", 413)
        dur = _voice_duration(request.args.get("duration_s", request.headers.get("X-Audio-Duration")))
        if dur is None:
            return verr(f"duration_s is required: seconds in (0, {VOICE_MAX_SECONDS:g}]", 400)
        audio = request.stream.read(VOICE_MAX_AUDIO_BYTES + 1)
        if len(audio) > VOICE_MAX_AUDIO_BYTES:
            return verr(f"audio exceeds {VOICE_MAX_AUDIO_BYTES} bytes (10 MB)", 413)
        if not audio:
            return verr("audio is empty", 400)

        def go():
            text = svc.gateway().transcribe(audio, hud_token=tok, mime=mime, duration_s=dur)
            return jsonify({"ok": True, "text": guard.clean(text, VOICE_MAX_TEXT)})
        return run(go)

    @app.post("/api/voice/ask")
    def api_voice_ask():
        tok, bad = authed()
        if bad:
            return bad
        body = request.get_json(silent=True)
        text = body.get("text") if isinstance(body, dict) else None
        if not isinstance(text, str) or not text.strip():
            return verr("text is required", 400)
        if len(text) > VOICE_MAX_TEXT:
            return verr(f"text exceeds {VOICE_MAX_TEXT} characters", 400)

        def go():
            res = svc.gateway().ask(text.strip(), svc.context(), hud_token=tok)
            sources = []
            for s in (res.get("sources") or [])[:8]:
                url = guard.clean_url(s.get("url")) if isinstance(s, dict) else None
                if url and url.lower().startswith("https://"):
                    sources.append({"title": guard.clean(s.get("title") or url, 200), "url": url})
            return jsonify({"ok": True, "answer": guard.clean(res.get("answer") or "", 1500), "sources": sources,
                            "speak_text": guard.clean(res.get("speak_text") or "", 600)})
        return run(go)

    @app.post("/api/voice/speak")
    def api_voice_speak():
        tok, bad = authed()
        if bad:
            return bad
        body = request.get_json(silent=True)
        text = body.get("text") if isinstance(body, dict) else None
        if not isinstance(text, str) or not text.strip():
            return verr("text is required", 400)
        if len(text) > VOICE_MAX_SPEAK:
            return verr(f"text exceeds {VOICE_MAX_SPEAK} characters", 400)

        def go():
            audio = svc.gateway().synthesize(text.strip(), hud_token=tok)
            resp = make_response(bytes(audio))
            resp.headers["Content-Type"] = _audio_mime(audio)
            resp.headers["Content-Disposition"] = "inline"
            return resp
        return run(go)
