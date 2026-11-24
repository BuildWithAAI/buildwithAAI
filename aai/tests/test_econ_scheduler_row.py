"""Economy snapshot scheduler health as a pipelines row (backlog P3). Pure row + DailyScheduler facts + overview wiring.
tmp DBs only (conftest); the scheduler thread is never started here."""
import datetime as dt, time

from aai import snapshots as sn
from test_zoora import FAKE_EXT, ad, app, client  # noqa: F401  (pytest fixtures)

CT = sn.TZ


def _at(y, m, d, h, mi=0):
    return dt.datetime(y, m, d, h, mi, tzinfo=CT).timestamp()


def test_row_off_without_scheduler():
    r = sn.scheduler_row(None, "2026-11-16", _at(2026, 11, 17, 9))
    assert r["id"] == "econ_scheduler" and r["state"] == "OFF" and "last snapshot 2026-11-16" in r["detail"]


def test_row_pending_then_stale_without_ticks():
    now = _at(2026, 11, 17, 9)
    h = {"started_at": now - 10, "last_tick_at": None, "interval": 600, "ticks": 0, "errors": 0}
    assert sn.scheduler_row(h, None, now)["state"] == "PENDING"
    h["started_at"] = now - 600
    r = sn.scheduler_row(h, None, now)
    assert r["state"] == "STALE" and "no tick since start" in r["detail"]


def test_row_ok_next_due_wording():
    now = _at(2026, 11, 17, 9)
    h = {"started_at": now - 3600, "last_tick_at": now - 100, "last_ok_at": now - 100, "interval": 600, "ticks": 6, "errors": 0}
    r = sn.scheduler_row(h, "2026-11-17", now)
    assert r["state"] == "OK" and "next due tomorrow 07:00 CT" in r["detail"] and "every 10 min" in r["detail"]
    assert r["ticks"] == 6 and r["errors"] == 0 and r["age_sec"] == 100
    early = _at(2026, 11, 17, 6)
    assert "today's due 07:00 CT" in sn.scheduler_row({**h, "last_tick_at": early - 5}, "2026-11-16", early)["detail"]
    assert "due now" in sn.scheduler_row(h, "2026-11-16", now)["detail"]


def test_row_error_and_stall():
    now = _at(2026, 11, 17, 9)
    h = {"started_at": now - 7200, "last_tick_at": now - 50, "last_ok_at": now - 1300, "interval": 600, "ticks": 12,
         "errors": 2, "last_error": "OperationalError: database is locked"}
    r = sn.scheduler_row(h, "2026-11-16", now)
    assert r["state"] == "ERROR" and "database is locked" in r["detail"] and "last good tick 21m ago" in r["detail"]
    h2 = {**h, "last_error": None, "last_tick_at": now - 2000}
    assert sn.scheduler_row(h2, "2026-11-16", now)["state"] == "STALE"
    assert "thread stopped" in sn.scheduler_row({**h2, "last_tick_at": now - 10, "running": False}, None, now)["detail"]


def test_daily_scheduler_tick_records_health(cfg, store):
    s = sn.DailyScheduler(store, cfg)
    t = _at(2026, 11, 17, 6)                                       # before 07:00: not due, still a good tick
    assert s.tick(now=t) is None
    h = s.health()
    assert h["ticks"] == 1 and h["last_tick_at"] == t and h["last_ok_at"] == t and h["errors"] == 0 and h["running"]

    def boom(*a, **k):
        raise RuntimeError("boom")
    orig, sn.due = sn.due, boom
    try:
        s.tick(now=t + 600)
    finally:
        sn.due = orig
    h = s.health()
    assert h["errors"] == 1 and h["last_error"] == "RuntimeError: boom" and h["last_ok_at"] == t and h["last_error_at"] == t + 600
    assert sn.scheduler_row(h, None, t + 610)["state"] == "ERROR"
    s.tick(now=t + 1200)                                           # recovers: error clears, counters keep history
    h = s.health()
    assert h["last_error"] is None and h["errors"] == 1 and h["ticks"] == 3


def test_overview_scheduler_row(app, client):
    zo = app.config["ZOORA"]
    row = next(p for p in client.get("/api/zoora/overview").json["pipelines"] if p["id"] == "econ_scheduler")
    assert row["state"] == "OFF"                                   # heavy=False: no scheduler in tests

    class Broken:
        def health(self):
            now = time.time()
            return {"started_at": now - 3600, "last_tick_at": now - 5, "last_ok_at": now - 700, "interval": 600,
                    "ticks": 7, "errors": 1, "last_error": "RuntimeError: x <script>alert(1)</script>"}
        last_error = "RuntimeError: x"
    zo.snapshot_scheduler = Broken()
    zo._ov_ts = 0
    ov = client.get("/api/zoora/overview").json
    row = next(p for p in ov["pipelines"] if p["id"] == "econ_scheduler")
    assert row["state"] == "ERROR" and row["ticks"] == 7 and "<script>" not in row["detail"] and "<script>" not in row["error"]
    assert " · last good tick" in row["detail"]                    # separators survive the per-part clean
    al = [a for a in ov["alerts"] if a["id"] == "pipe_econ_scheduler"]
    assert len(al) == 1 and al[0]["sev"] == "warn" and not al[0].get("chime")   # visible, silent
    hist = client.get("/api/economy/history?days=3").json
    assert hist["scheduler"]["row"]["state"] == "ERROR"


def test_economy_intent_speaks_scheduler_only_when_not_ok(app, client):
    """Backlog P3: the 'economy' intent names the scheduler state + last good tick only when ERROR/STALE (cleaned row)."""
    from test_zoora import say
    app.config["AAI_ECONOMY_ARENA"] = False
    zo = app.config["ZOORA"]
    code, d = say(client, "economy")
    assert code == 200 and "scheduler" not in d["reply"].lower()          # OFF in tests: silent
    assert d["data"]["scheduler"]["state"] == "OFF"

    class Broken:
        def health(self):
            now = time.time()
            return {"started_at": now - 3600, "last_tick_at": now - 5, "last_ok_at": now - 1300, "interval": 600,
                    "ticks": 7, "errors": 1, "last_error": "OperationalError: locked <script>alert(1)</script>"}
    zo.snapshot_scheduler = Broken()
    code, d = say(client, "economy")
    r = d["reply"]
    assert code == 200 and "scheduler is ERROR" in r and "last good tick 21m ago" in r and "locked" in r
    assert "<script" not in r and "<script" not in str(d["data"]) and d["data"]["scheduler"]["errors"] == 1
    assert d["data"]["real_money_allowed"] is False and "; last good tick" in r and "·" not in r

    class Stalled:
        def health(self):
            now = time.time()
            return {"started_at": now - 7200, "last_tick_at": now - 2400, "last_ok_at": now - 2400, "interval": 600,
                    "ticks": 3, "errors": 0, "last_error": None}
    zo.snapshot_scheduler = Stalled()
    r = say(client, "economy")[1]["reply"]
    assert "scheduler is STALE" in r and "no tick for 40m" in r

    class Fine:
        def health(self):
            now = time.time()
            return {"started_at": now - 3600, "last_tick_at": now - 60, "last_ok_at": now - 60, "interval": 600,
                    "ticks": 6, "errors": 0, "last_error": None}
    zo.snapshot_scheduler = Fine()
    assert "scheduler" not in say(client, "economy")[1]["reply"].lower()
