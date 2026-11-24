"""Intel service: refresh feeds into the SQLite cache (with per-feed circuit breaker) and serve read-only views.
Views never invent data: a feed with no successful fetch is 'unavailable' with the reason; one older than its
staleness budget is 'stale' and still shows its last real values with their real timestamps."""
from __future__ import annotations
import logging, threading, time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from zoneinfo import ZoneInfo

from .. import guard
from . import alarms, fxdesk, regime
from .cache import IntelCache
from .core import Fetcher, FetchError
from .feeds import registry

log = logging.getLogger("aai.intel")
CT = ZoneInfo("America/Chicago")
FAIL_RETRY_SEC = 120


def ct(ts, fmt="%a %H:%M CT") -> str:
    return datetime.fromtimestamp(ts, CT).strftime(fmt) if ts else "—"


class Intel:
    def __init__(self, cfg, store, fetcher: Fetcher | None = None, feeds=None, clock=time.time):
        self.cfg, self.cache, self.clock = cfg, IntelCache(store), clock
        self.fetcher = fetcher or Fetcher()
        self.feeds = feeds or registry()
        ic = cfg.get("intel", {}) if hasattr(cfg, "get") else {}
        self.countries = tuple(ic.get("calendar_countries") or alarms.DEFAULT_COUNTRIES)
        self._inflight: set[str] = set()
        self._lock = threading.Lock()
        self._all_cache: tuple[float, dict] | None = None

    # ---------------------------------------------------------------- refresh
    def due(self, name: str, now: float | None = None) -> bool:
        now = now or self.clock()
        st, feed = self.cache.state(name), self.feeds[name]
        if st["breaker_open_until"] and st["breaker_open_until"] > now:
            return False
        if not st["last_attempt_at"]:
            return True
        wait = feed.interval if not st["consecutive_fails"] else min(feed.interval, FAIL_RETRY_SEC)
        return now - st["last_attempt_at"] >= wait

    def refresh_one(self, name: str, force: bool = False) -> dict:
        feed = self.feeds[name]
        with self._lock:
            if name in self._inflight:
                return {"feed": name, "ok": None, "skipped": "in flight"}
            if not force and not self.due(name):
                return {"feed": name, "ok": None, "skipped": "not due / breaker open"}
            self._inflight.add(name)
        try:
            prev = self.cache.latest_ok(name)
            t0 = time.monotonic()
            try:
                payload = feed.fn(self.fetcher, self.cfg, prev["payload"] if prev else None)
                payload = guard.clean_deep(payload, max_len=240)
                ms = int((time.monotonic() - t0) * 1000)
                self.cache.record(name, feed.source, True, payload=payload, latency_ms=ms, ts=self.clock())
                return {"feed": name, "ok": True, "latency_ms": ms}
            except FetchError as e:
                reason = e.reason
            except Exception as e:   # adapter bug or schema change: contain it, never crash the HUD
                log.exception("intel feed %s crashed", name)
                reason = f"adapter error: {type(e).__name__}: {str(e)[:120]}"
            ms = int((time.monotonic() - t0) * 1000)
            fails = self.cache.state(name)["consecutive_fails"] + 1
            cool = feed.breaker.cooloff(fails)
            until = self.clock() + cool if cool else None
            self.cache.record(name, feed.source, False, error=reason, latency_ms=ms, breaker_until=until, ts=self.clock())
            return {"feed": name, "ok": False, "error": reason, "breaker_open_sec": int(cool) or None}
        finally:
            with self._lock:
                self._inflight.discard(name)
            self._all_cache = None

    def refresh(self, names=None, force: bool = False, workers: int = 4) -> list[dict]:
        names = [n for n in (names or self.feeds) if n in self.feeds]
        with ThreadPoolExecutor(max_workers=max(1, min(workers, len(names) or 1))) as ex:
            return list(ex.map(lambda n: self.refresh_one(n, force), names))

    # ---------------------------------------------------------------- views
    def view(self, name: str, history: bool = False) -> dict:
        feed = self.feeds[name]
        now = self.clock()
        st = self.cache.state(name)
        snap = self.cache.latest_ok(name)
        v = feed.meta()
        breaker = st["breaker_open_until"] if st["breaker_open_until"] and st["breaker_open_until"] > now else None
        if snap:
            age = now - snap["fetched_at"]
            status = "live" if age <= feed.budget else "stale"
            v.update(fetched_at=snap["fetched_at"], fetched_ct=ct(snap["fetched_at"], "%b %d %H:%M:%S CT"), age_sec=int(age),
                     latency_ms=snap["latency_ms"], payload=snap["payload"])
            if status == "stale":
                v["stale_reason"] = (f"last good fetch {int(age // 60)} min ago exceeds {int(feed.budget // 60)} min budget"
                                     + (f"; latest error: {st['last_error']}" if st["last_error"] else ""))
        else:
            status = "unavailable"
            v.update(fetched_at=None, payload=None,
                     stale_reason=st["last_error"] or ("not fetched yet" if not st["last_attempt_at"] else "no successful fetch"))
        v.update(status=status, last_error=st["last_error"] if st["consecutive_fails"] else None,
                 consecutive_fails=st["consecutive_fails"], last_attempt_at=st["last_attempt_at"],
                 breaker_open_until=breaker, n_ok=st["n_ok"], n_fail=st["n_fail"])
        if history:
            v["history"] = self.cache.history(name)
        return v

    def payloads(self) -> dict:
        out = {}
        for n in self.feeds:
            s = self.cache.latest_ok(n)
            out[n] = s["payload"] if s else None
        return out

    def all(self, max_age: float = 2.0) -> dict:
        c = self._all_cache
        if c and self.clock() - c[0] < max_age:
            return c[1]
        now = self.clock()
        views = {n: self.view(n) for n in self.feeds}
        p = {n: v["payload"] for n, v in views.items()}
        ev = (p.get("calendar") or {}).get("events") or []
        out = {"generated_at": now, "generated_ct": ct(now, "%b %d %H:%M:%S CT"), "feeds": views,
               "summary": {s: sum(1 for v in views.values() if v["status"] == s) for s in ("live", "stale", "unavailable")},
               "regime": regime.compute(p), "alerts": self.alerts(views, now),
               "next_high": alarms.next_high(ev, now, self.countries), "calendar_countries": list(self.countries),
               "fx_desk": fxdesk.compute(p, now)}
        self._all_cache = (now, out)
        return out

    def fx_desk(self) -> dict:
        """T8 per-pair forex overlay (COT bias + next event + quote), read-only from the cached payloads."""
        return self.all()["fx_desk"]

    def fx_desk_text(self) -> str:
        return fxdesk.text(self.fx_desk())

    def alerts(self, views: dict | None = None, now: float | None = None) -> list[dict]:
        now = now or self.clock()
        views = views or {n: self.view(n) for n in self.feeds}
        cal = views.get("calendar", {})
        out = alarms.calendar_alarms(((cal.get("payload") or {}).get("events") or []), now, self.countries) if cal.get("payload") else []
        cot_p = (views.get("cot") or {}).get("payload") or {}
        out.extend(alarms.cot_extreme_alarms(cot_p.get("rows")))
        try:
            payloads = {n: (v or {}).get("payload") for n, v in views.items()}
            out.extend(alarms.fx_bias_flip_alarms(fxdesk.compute(payloads, now).get("rows")))
        except Exception:  # never let a malformed cached payload break the alert list
            pass
        der = (views.get("options_deribit") or {}).get("payload") or {}
        out.extend(alarms.dvol_spike_alarms(der.get("assets")))
        mk = (views.get("markets") or {}).get("payload") or {}
        out.extend(alarms.vix_term_alarms(mk.get("rows")))
        for k in ("deriv_blofin", "deriv_okx"):
            cur_rows = ((views.get(k) or {}).get("payload") or {}).get("rows") or []
            prev = self.cache.previous_ok(k)
            prev_rows = ((prev or {}).get("payload") or {}).get("rows") or []
            out.extend(alarms.funding_flip_alarms(cur_rows, prev_rows))
            for r in cur_rows:
                f8 = r.get("funding_8h")
                if f8 is not None and abs(f8) >= 0.0005:
                    out.append({"id": f"intel_funding_{k}_{r['symbol']}_{'pos' if f8 > 0 else 'neg'}", "sev": "warn",
                                "title": f"{r['symbol']} perp funding {f8 * 100:+.3f}%/8h on {r.get('venue', k)}",
                                "detail": "Extreme funding: crowded " + ("longs" if f8 > 0 else "shorts") + " (|f| >= 0.05%/8h)",
                                "source": "intel", "chime": True})
        for n, v in views.items():
            if v["status"] != "live" and v.get("last_attempt_at"):
                out.append({"id": f"intel_{n}_{v['status']}", "sev": "info", "title": f"Intel feed {v['label']} {v['status'].upper()}",
                            "detail": (v.get("stale_reason") or "")[:160], "source": "intel"})
        return out

    # ---------------------------------------------------------------- spoken / chat replies
    def _p(self, n):
        s = self.cache.latest_ok(n)
        return s["payload"] if s else None

    def _status_note(self, n):
        v = self.view(n)
        return "" if v["status"] == "live" else f" ({v['label']} is {v['status']}: {v.get('stale_reason', '')[:80]})"

    def rates_text(self) -> str:
        r, fr = self._p("rates"), (self._p("fred") or {}).get("series") or {}
        if not r:
            return "Treasury curve unavailable" + self._status_note("rates") + "."
        s = (f"Treasury curve {r['as_of']}: 2-year {r['y2']:.2f}%, 10-year {r['y10']:.2f}%"
             + (f" ({r['d10_bp']:+.0f} bp on the day)" if r.get("d10_bp") is not None else "")
             + f". 2s10s {r['s2s10_bp']:+.0f} bp, 3m10y {r['s3m10y_bp']:+.0f} bp"
             + (", curve inverted" if r.get("inverted_3m10y") else "") + ".")
        if fr.get("DFF"):
            s += f" Effective fed funds {fr['DFF']['value']:.2f}%."
        if fr.get("BAMLH0A0HYM2"):
            s += f" High-yield spread {fr['BAMLH0A0HYM2']['value']:.2f}%."
        return s + self._status_note("rates")

    def calendar_text(self, now=None) -> str:
        now = now or self.clock()
        c = self._p("calendar")
        if not c:
            return "Economic calendar unavailable" + self._status_note("calendar") + "."
        nx = alarms.next_high(c["events"], now, self.countries, n=4)
        if not nx:
            return f"No more high-impact {'/'.join(self.countries)} events this week."
        parts = []
        for e in nx:
            dt = e["ts"] - now
            eta = "now" if dt <= 0 else (f"in {int(dt // 3600)}h {int(dt % 3600 // 60)}m" if dt < 86400 else ct(e["ts"]))
            parts.append(f"{e['country']} {e['title']} {eta}" + (f", forecast {e['forecast']}" if e.get("forecast") else ""))
        return "Next high-impact: " + "; ".join(parts) + "." + self._status_note("calendar")

    def funding_text(self) -> str:
        parts = []
        for k in ("deriv_blofin", "deriv_okx"):
            p = self._p(k)
            for r in (p or {}).get("rows") or []:
                if r.get("funding_8h") is not None:
                    parts.append(f"{r['symbol']} {r['venue']} {r['funding_8h'] * 100:+.4f}%/8h"
                                 + (f", OI ${r['oi_usd'] / 1e9:.2f}B" if r.get("oi_usd") else ""))
        o = (self._p("options_deribit") or {}).get("assets") or {}
        opt = "; ".join(f"{a} DVOL {v['dvol']:.1f}, put/call OI {v['pc_oi']:.2f}" for a, v in o.items()
                        if v.get("dvol") is not None and v.get("pc_oi") is not None)
        if not parts and not opt:
            return "Crypto derivatives feeds unavailable" + self._status_note("deriv_okx") + "."
        return "Funding: " + "; ".join(parts) + ("." if parts else "") + (f" Options: {opt}." if opt else "")

    def positioning_text(self) -> str:
        c = self._p("cot")
        if not c:
            return "COT positioning unavailable" + self._status_note("cot") + "."
        bits = []
        for r in c["rows"]:
            if r["symbol"] in ("EUR", "JPY", "AUD", "XAU", "ES", "BTC"):
                net = r.get("lev_net") if r.get("lev_net") is not None and r["class"] != "commodity" else r["nc_net"]
                chg = r.get("lev_net_chg") if r.get("lev_net") is not None and r["class"] != "commodity" else r["nc_net_chg"]
                who = "lev funds" if r.get("lev_net") is not None and r["class"] != "commodity" else "specs"
                bits.append(f"{r['symbol']} {who} net {net:+,.0f}" + (f" ({chg:+,.0f} w/w)" if chg is not None else ""))
        return f"CFTC COT as of {c['report_date']}: " + "; ".join(bits) + "."

    def filings_text(self) -> str:
        p = self._p("filings")
        if not p:
            return "SEC filings unavailable" + self._status_note("filings") + "."
        b = p.get("insider_buys") or []
        s = f"Last {p['lookback_days']} days on the watchlist: {p['n_8k']} 8-Ks and {p['n_form4']} Form 4s."
        if b:
            s += " Open-market insider buys: " + "; ".join(f"{x['ticker']} {x['insider']['owner']} ${(x['insider'].get('buy_usd') or 0):,.0f}" for x in b[:3]) + "."
        else:
            s += " No open-market insider buys (code P) among parsed Form 4s."
        k8 = [x for x in p["filings"] if x["form"] == "8-K"][:3]
        if k8:
            s += " Latest 8-Ks: " + "; ".join(f"{x['ticker']} {x['filed']} {', '.join(x['items_text']) or 'n/a'}" for x in k8) + "."
        return s

    def brief_text(self) -> str:
        a = self.all(max_age=0)
        rg = a["regime"]
        mk = {r["symbol"]: r for r in ((a["feeds"]["markets"].get("payload") or {}).get("rows") or [])}
        q = "; ".join(f"{s} {mk[s]['last']:,.2f} ({mk[s]['chg'] * 100:+.1f}%)" for s in ("SPY", "VIX", "DXY", "GOLD", "WTI", "BTCUSD")
                      if s in mk and mk[s].get("chg") is not None)
        head = f"Market brief, {a['generated_ct']}. Regime heuristic: {rg['label']}" + (
            f" ({rg['score']:+d} across {rg['n_inputs']} inputs)" if rg.get("score") is not None else "") + ", not a signal."
        parts = [head]
        if q:
            parts.append("Markets: " + q + ".")
        parts += [self.rates_text(), self.calendar_text(), self.funding_text()]
        fg = self._p("fear_greed")
        if fg:
            parts.append(f"Crypto Fear and Greed {fg['value']:.0f}, {fg['label']}.")
        s = a["summary"]
        parts.append(f"Feeds: {s['live']} live, {s['stale']} stale, {s['unavailable']} unavailable.")
        return " ".join(parts)


class Refresher:
    """Background refresher for the HUD process. Ticks every few seconds; each due feed runs on a small pool so a
    slow source (e.g. Treasury) never blocks the fast derivatives feeds."""

    def __init__(self, intel: Intel, tick: float = 5.0, workers: int = 3):
        self.intel, self.tick = intel, tick
        self.pool = ThreadPoolExecutor(max_workers=workers, thread_name_prefix="intel")
        self._stop = threading.Event()
        self._t = threading.Thread(target=self._run, name="intel-refresher", daemon=True)
        self._last_prune = 0.0

    def start(self):
        self._t.start()
        return self

    def stop(self):
        self._stop.set()
        self.pool.shutdown(wait=False, cancel_futures=True)

    def _run(self):
        while not self._stop.is_set():
            try:
                for n in self.intel.feeds:
                    if n not in self.intel._inflight and self.intel.due(n):
                        self.pool.submit(self.intel.refresh_one, n)
                if time.time() - self._last_prune > 3600:
                    self._last_prune = time.time()
                    self.intel.cache.prune()
            except Exception:
                log.exception("intel refresher tick failed")
            self._stop.wait(self.tick)
