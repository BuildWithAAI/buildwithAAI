"""Sector breadth 20-session A/D history (from the feed's own daily closes), rotation/flip INFO alarms,
the soft once-per-id info chime, and the console check ignoring browser-extension noise. Pure / tmp only."""
from __future__ import annotations

from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from aai.health import parse_console
from aai.intel import alarms, breadth

ROOT = Path(__file__).resolve().parents[1]
NY = ZoneInfo("America/New_York")
SYMS = ["XLK", "XLC", "XLY", "XLP", "XLE", "XLF", "XLV", "XLI", "XLB", "XLRE", "XLU"]


def _ts(day: int) -> float:
    return datetime(2026, 11, day, 9, 30, tzinfo=NY).timestamp()


def _rows(paths: dict[str, list[float]], days: list[int]):
    out = []
    for s, closes in paths.items():
        spark = [[_ts(d), c] for d, c in zip(days, closes)]
        chg = closes[-1] / closes[-2] - 1
        out.append({"symbol": s, "name": s, "last": closes[-1], "chg": chg, "chg_20d": 0.01, "ts": _ts(days[-1]), "spark": spark})
    return out


DAYS = [16, 17, 18, 19, 20, 23, 24]


def test_history_counts_net_ad_and_streak():
    # sessions 17..24: all up, all up, all down, all down, all down(ish), all up
    up, dn = 1.02, 0.98
    pattern = [up, up, dn, dn, dn, dn]
    paths = {}
    for i, s in enumerate(SYMS):
        c, cl = 100.0, [100.0]
        for k, m in enumerate(pattern):
            # on the last session one sector rises, so it is 1 up / 10 down
            c = c * (1.01 if (k == len(pattern) - 1 and i == 0) else m)
            cl.append(c)
        paths[s] = cl
    h = breadth.history(_rows(paths, DAYS))
    assert h["sessions"] == 6
    assert [p["day"] for p in h["points"]] == ["2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20", "2026-11-23", "2026-11-24"]
    assert [p["net"] for p in h["points"]] == [11, 11, -11, -11, -11, -9]
    assert h["points"][-1]["ad"] == h["ad_change"] == -20
    assert h["streak"] == {"side": "decliners", "n": 4}
    assert h["prev_label"] == "BROAD DECLINE" and h["points"][-1]["label"] == "BROAD DECLINE"


def test_history_skips_thin_sessions_and_never_interpolates():
    paths = {s: [100.0, 101.0, 102.0] for s in SYMS[:5]}  # only 5 sectors: below the 6 needed
    assert breadth.history(_rows(paths, [18, 19, 20]))["sessions"] == 0
    rows = _rows({s: [100.0, 101.0, 102.0] for s in SYMS}, [18, 19, 20])
    for r in rows[:6]:  # 6 sectors miss the 19th: session 19 and 20 drop below 6 sectors with both closes
        r["spark"] = [p for p in r["spark"] if p[0] != _ts(19)]
    h = breadth.history(rows)
    assert h["sessions"] == 0 and h["streak"] == {"side": None, "n": 0}
    assert breadth.history([{"symbol": "XLK", "spark": [["x", None], [1, "a"]]}, "junk", None])["sessions"] == 0
    assert breadth.history(_rows({s: [100.0] * 30 for s in SYMS}, list(range(1, 31))), sessions=20)["sessions"] == 20


def _b(chgs: dict, prev_label="MIXED", day="2026-11-24"):
    rows = [{"symbol": s, "name": s, "chg": c, "chg_20d": 0.0} for s, c in chgs.items()]
    b = breadth.compute(rows)
    b["history"] = {"points": [{"day": "2026-11-23"}, {"day": day}], "prev_label": prev_label}
    return b


def test_rotation_alarm_on_wide_spread_once_per_session():
    chg = {s: 0.001 for s in SYMS}
    chg["XLK"], chg["XLE"] = -0.035, 0.012
    a = alarms.sector_rotation_alarms(_b(chg), "OK")
    assert len(a) == 1 and a[0]["id"] == "intel_sector_spread_2026-11-24" and a[0]["sev"] == "info" and a[0]["chime"] is True
    assert "XLE +1.2% vs XLK -3.5%" in a[0]["title"] and "not a signal" in a[0]["detail"]
    chg["XLK"] = -0.02  # spread 3.2% < 4%
    assert alarms.sector_rotation_alarms(_b(chg), "OK") == []


def test_breadth_flip_alarm_and_guards():
    down = {s: -0.01 for s in SYMS}
    a = alarms.sector_rotation_alarms(_b(down, prev_label="BROAD ADVANCE"), "OK")
    assert [x["id"] for x in a] == ["intel_breadth_flip_2026-11-24_decline"]
    assert "broad advance → broad decline" in a[0]["title"]
    assert alarms.sector_rotation_alarms(_b(down, prev_label="MIXED, LEANING UP"), "OK") == []
    up = {s: 0.01 for s in SYMS}
    assert alarms.sector_rotation_alarms(_b(up, prev_label="BROAD DECLINE"), "OK")[0]["id"].endswith("_advance")
    # stale quotes, thin data, missing history or junk never alarm
    assert alarms.sector_rotation_alarms(_b(down, prev_label="BROAD ADVANCE"), "STALE") == []
    assert alarms.sector_rotation_alarms(_b({s: -0.01 for s in SYMS[:5]}, prev_label="BROAD ADVANCE"), "OK") == []
    b = _b(down, prev_label="BROAD ADVANCE"); b["history"] = None
    assert alarms.sector_rotation_alarms(b, "OK") == []
    assert alarms.sector_rotation_alarms(None) == [] and alarms.sector_rotation_alarms({"n_with_chg": "x"}) == []


def test_voice_text_speaks_streak_or_ad_line():
    b = _b({s: -0.01 for s in SYMS})
    b["history"] = {"sessions": 20, "streak": {"side": "decliners", "n": 4}, "ad_change": -30}
    assert "Decliners have outnumbered advancers for 4 sessions in a row." in breadth.text(b)
    b["history"] = {"sessions": 20, "streak": {"side": "advancers", "n": 1}, "ad_change": -16}
    t = breadth.text(b)
    assert "advance-decline line is down 16 net" in t and "in a row" not in t
    b["history"] = None
    assert "advance-decline" not in breadth.text(b)


def test_service_alerts_include_rotation_from_live_sectors(tmp_path):
    from aai.intel.service import Intel
    import inspect
    src = inspect.getsource(Intel.alerts)
    assert "sector_rotation_alarms" in src and 'status") == "live"' in src


def test_console_parse_ignores_extension_lines_only():
    err = "\n".join([
        '[1:2:INFO:CONSOLE(88)] "[Runtime] 1Password installed", source: chrome-extension://pihcfihbpdmmdelcgfekchnnabgldfif/background/background.js (88)',
        '[1:2:INFO:CONSOLE:12] "hello", source: chrome-extension://abc/x.js (12)',
        "unrelated stderr line",
    ])
    r = parse_console(err, 10)
    assert r == {"ok": True, "errors": [], "n_errors": 0, "dom_bytes": 10, "ignored_extension": 2}
    r = parse_console(err + '\n[1:2:INFO:CONSOLE(3)] "Uncaught TypeError: x", source: http://127.0.0.1:57025/static/zoora.js (3)')
    assert r["ok"] is False and r["n_errors"] == 1 and "Uncaught TypeError" in r["errors"][0] and r["ignored_extension"] == 2
    # an extension URL merely mentioned in the page's own message still counts
    r = parse_console('[1:2:INFO:CONSOLE(3)] "blocked chrome-extension://x", source: http://127.0.0.1/z.js (3)')
    assert r["ok"] is False


def test_headless_chrome_disables_extensions_without_explicit_profile():
    src = (ROOT / "aai" / "health.py").read_text()
    # an explicit --user-data-dir makes headless Chrome hang after --dump-dom; the implicit temp profile is kept
    assert '"--disable-extensions"' in src and '"--user-data-dir' not in src
    assert "--disable-extensions" in (ROOT / "scripts" / "zoora_shot.sh").read_text()


def test_hud_js_ad_row_and_soft_info_chime():
    js = (ROOT / "aai" / "static" / "zoora" / "zoora.js").read_text()
    assert "function renderBreadthAD(h, out)" in js and "renderBreadthAD(b.history, read)" in js  # + keyboard readout
    assert "zoora.infoChimed" in js and "else if (soft) chime('info')" in js
    seg = js[js.index("function renderBreadthAD"):js.index("const TABS")]
    assert "innerHTML" not in seg
    css = (ROOT / "aai" / "static" / "zoora" / "zoora.css").read_text()
    assert ".sector-breadth .sb-ad{" in css
