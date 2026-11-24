"""Economy snapshot overdue alarm (backlog P3): WARN + chime once per CT day when the daily scheduler missed 2+ due
days while the HUD was up. Days the HUD was down are a gap, not an alarm. tmp DBs only (conftest)."""
import datetime as dt, json, time

from aai import snapshots as sn
from test_zoora import FAKE_EXT, ad, app, client  # noqa: F401  (pytest fixtures)

CT = sn.TZ


def _at(y, m, d, h, mi=0):
    return dt.datetime(y, m, d, h, mi, tzinfo=CT).timestamp()


def _snap(store, day, ts):
    sn.ensure(store)
    store.execute("INSERT INTO economy_snapshots(ts,day,actor,n,payload) VALUES(?,?,?,?,?)",
                  (ts, day, "scheduler", 0, json.dumps({})))


def test_missed_while_up_counts_only_up_days():
    started = _at(2026, 11, 10, 9)                    # HUD started 11-10 09:00 CT
    # last snapshot 11-10, now 11-13 08:00: 11-11, 11-12 fully up, 11-13 07:00+15min passed -> 3 days
    assert sn.missed_while_up("2026-11-10", started, _at(2026, 11, 13, 8)) == ["2026-11-11", "2026-11-12", "2026-11-13"]
    # 11-13 at 07:10: today's grace has not elapsed yet
    assert sn.missed_while_up("2026-11-10", started, _at(2026, 11, 13, 7, 10)) == ["2026-11-11", "2026-11-12"]
    # HUD was down for the gap and started today at 12:00 -> only today counts once grace passes
    late = _at(2026, 11, 17, 12)
    assert sn.missed_while_up("2026-11-10", late, late + 60) == []
    assert sn.missed_while_up("2026-11-10", late, late + 1000) == ["2026-11-17"]
    # started 23:50 on a day: less than the grace before midnight, so that day does not count
    assert sn.missed_while_up("2026-11-10", _at(2026, 11, 11, 23, 50), _at(2026, 11, 12, 6)) == []
    # before 07:00 CT nothing is due yet today; snapshot already taken today -> nothing
    assert sn.missed_while_up("2026-11-12", started, _at(2026, 11, 13, 6, 59)) == []
    assert sn.missed_while_up("2026-11-13", started, _at(2026, 11, 13, 23)) == []
    # no snapshot ever: counting starts at HUD start; a malformed day reads like none (never raises)
    assert sn.missed_while_up(None, started, _at(2026, 11, 11, 8)) == ["2026-11-10", "2026-11-11"]
    assert sn.missed_while_up("garbage", started, _at(2026, 11, 11, 8)) == ["2026-11-10", "2026-11-11"]


def test_overdue_alarm_threshold_and_once_per_day(store):
    started = _at(2026, 11, 10, 9)
    _snap(store, "2026-11-10", _at(2026, 11, 10, 9, 1))
    assert sn.overdue_alarm(store, started, now=_at(2026, 11, 11, 12)) is None        # 1 missed day: not yet
    a = sn.overdue_alarm(store, started, "OperationalError: database is locked", now=_at(2026, 11, 12, 12))
    assert a["sev"] == "warn" and a["chime"] is True and a["id"] == "econ_snap_overdue_2026-11-12"
    assert a["missed_days"] == ["2026-11-11", "2026-11-12"]
    assert "last snapshot 11-10" in a["detail"] and "missed 2 due days" in a["detail"] and "database is locked" in a["detail"]
    b = sn.overdue_alarm(store, started, now=_at(2026, 11, 12, 18))
    assert b["id"] == a["id"]                                                        # same day: same id, chimes once
    assert sn.overdue_alarm(store, started, now=_at(2026, 11, 13, 8))["id"] == "econ_snap_overdue_2026-11-13"
    _snap(store, "2026-11-13", _at(2026, 11, 13, 9))
    assert sn.overdue_alarm(store, started, now=_at(2026, 11, 13, 10)) is None        # scheduler recovered


def test_overview_alarm_only_with_scheduler(app, client, store):
    zo = app.config["ZOORA"]
    assert zo.snapshot_scheduler is None                                             # heavy=False: no scheduler, no alarm
    assert not [a for a in client.get("/api/zoora/overview").json["alerts"] if a["id"].startswith("econ_snap_overdue")]

    class Stuck:
        last_error = "RuntimeError: boom <script>"
    zo.snapshot_scheduler = Stuck()
    zo.started = time.time() - 5 * 86400                                              # up 5 days, never snapshotted
    zo._ov_ts = 0
    al = [a for a in client.get("/api/zoora/overview").json["alerts"] if a["id"].startswith("econ_snap_overdue")]
    assert len(al) == 1 and al[0]["sev"] == "warn" and al[0]["chime"] is True and "<script>" not in al[0]["detail"]
    assert "scheduler error" in al[0]["detail"] and al[0]["source"] == "economy scheduler"
