"""T10: solana-meme-risk scanner desk (read-only from that pipeline's data/paper.db). Tmp files only."""
import json, os, re, sqlite3, time

from aai import sources, zoora
from aai.adapters import registry

ROOT = os.path.dirname(os.path.dirname(__file__))


def _db(tmp_path, cycle_age=60.0, with_cycles=True):
    d = tmp_path / "solana-meme-risk" / "data"
    d.mkdir(parents=True)
    p = d / "paper.db"
    c = sqlite3.connect(p)
    c.executescript("""
    CREATE TABLE scanner_scores (mint TEXT PRIMARY KEY, scored_at REAL, status TEXT, decision TEXT, score INTEGER,
      model_version TEXT, top_reasons TEXT, hard_flags TEXT, holder_count INTEGER, bundle_pct REAL, bundle_wallets INTEGER,
      cluster_pct REAL, create_sig TEXT, mayhem INTEGER, mayhem_source TEXT, elapsed_s REAL, error TEXT, source TEXT);
    CREATE TABLE scanner_candidates (id INTEGER PRIMARY KEY AUTOINCREMENT, cycle_id INTEGER, at REAL, mint TEXT, symbol TEXT,
      sources TEXT, stage TEXT, reason TEXT, mcap REAL, liq REAL, age_h REAL, runner_score REAL, runner_detail TEXT,
      risk_decision TEXT, risk_score INTEGER, final_decision TEXT, mayhem INTEGER, position_id INTEGER, price REAL);
    CREATE TABLE scanner_obs (mint TEXT, at REAL, price REAL, mcap REAL, liq REAL, vol_m5 REAL, vol_h1 REAL, buys_m5 REAL,
      sells_m5 REAL, buys_h1 REAL, sells_h1 REAL, buyers_m5 REAL, buyers_h1 REAL, holders INTEGER, PRIMARY KEY(mint, at));
    """)
    now = time.time()
    if with_cycles:
        c.execute("CREATE TABLE scanner_cycles (id INTEGER PRIMARY KEY AUTOINCREMENT, started_at REAL, finished_at REAL, elapsed_s REAL, stats TEXT)")
        st = {"candidates": 120, "prefilter_pass": 30, "runner_scored": 30, "entries": [],
              "risk": {"scored_new": 2, "decisions": {"SKIP": 2, "REDUCED": 1}}, "errors": []}
        c.execute("INSERT INTO scanner_cycles(started_at, finished_at, elapsed_s, stats) VALUES (?,?,?,?)",
                  (now - cycle_age - 50, now - cycle_age, 50.0, json.dumps(st)))
    c.execute("INSERT INTO scanner_scores(mint, scored_at, status, decision, score, top_reasons, hard_flags, bundle_pct, bundle_wallets, cluster_pct)"
              " VALUES ('AAAAmintpump', ?, 'scored', 'SKIP', 75, ?, '[]', 66.0, 4, 5.1)",
              (now - 100, json.dumps(["same_slot_bundle +25: 4 wallets in the creation slot"])))
    c.execute("INSERT INTO scanner_scores(mint, scored_at, status, decision, score, top_reasons, hard_flags, bundle_pct, cluster_pct)"
              " VALUES ('BBBBmintpump', ?, 'scored', 'REDUCED', 20, '[]', '[\"x\"]', 0.0, 0.0)", (now - 200,))
    c.execute("INSERT INTO scanner_scores(mint, scored_at, status, error) VALUES ('CCCCmint', ?, 'timeout', 'timeout: budget')", (now - 300,))
    # two candidate rows for AAAA: the newest wins
    c.execute("INSERT INTO scanner_candidates(at, mint, symbol, mcap, liq, age_h, runner_score) VALUES (?, 'AAAAmintpump', 'OLD', 1, 1, 1, 1)", (now - 900,))
    c.execute("INSERT INTO scanner_candidates(at, mint, symbol, mcap, liq, age_h, runner_score) VALUES (?, 'AAAAmintpump', 'SCRIPT', 30000, 12000, 0.2, 72)", (now - 100,))
    # BBBB has no candidate row: liquidity / mcap / holders come from scanner_obs
    c.execute("INSERT INTO scanner_obs(mint, at, mcap, liq, holders) VALUES ('BBBBmintpump', ?, 2000000, 50000, 812)", (now - 250,))
    c.commit(); c.close()
    return p


def test_desk_rows_join_and_concentration(tmp_path, monkeypatch):
    monkeypatch.setattr(sources, "WS", str(tmp_path))
    p = _db(tmp_path)
    before = (os.path.getmtime(p), os.path.getsize(p))
    d = sources.smr_scanner()
    assert d["status"] == "ok" and d["stale"] is False
    assert d["cycle"]["candidates"] == 120 and d["cycle"]["risk_decisions"] == {"SKIP": 2, "REDUCED": 1}
    a, b, c = d["rows"]
    assert a["symbol"] == "SCRIPT" and a["decision"] == "SKIP" and a["score"] == 75
    assert a["liq_usd"] == 12000 and a["mcap_usd"] == 30000 and a["liq_mcap_pct"] == 40.0
    assert a["bundle_pct"] == 66.0 and a["cluster_pct"] == 5.1 and a["bundle_wallets"] == 4
    assert a["reason"].startswith("same_slot_bundle")
    assert b["symbol"] is None and b["liq_usd"] == 50000 and b["holders"] == 812 and b["liq_mcap_pct"] == 2.5 and b["n_flags"] == 1
    assert c["decision"] is None and c["status"] == "timeout" and c["liq_usd"] is None and c["liq_mcap_pct"] is None
    assert d["decisions"] == {"SKIP": 1, "REDUCED": 1, "TIMEOUT": 1}
    assert (os.path.getmtime(p), os.path.getsize(p)) == before       # read-only


def test_desk_stale_after_an_hour_and_voice_says_so(tmp_path, monkeypatch):
    monkeypatch.setattr(sources, "WS", str(tmp_path))
    _db(tmp_path, cycle_age=22 * 86400)
    d = sources.smr_scanner()
    assert d["status"] == "stale" and d["age_sec"] > 21 * 86400
    line = zoora.Zoora._smr_scanner_line({"ext": {"smr_scanner": d}})
    assert "not running" in line and "SCRIPT, SKIP at risk 75" in line and "66% of supply" in line and "$12,000" in line
    live = zoora.Zoora._smr_scanner_line({"ext": {"smr_scanner": {**d, "status": "ok", "age_sec": 120}}})
    assert "not running" not in live and "2 min ago" in live


def test_desk_missing_and_no_cycles(tmp_path, monkeypatch):
    monkeypatch.setattr(sources, "WS", str(tmp_path))
    d = sources.smr_scanner()
    assert d["status"] == "missing" and d["rows"] == []
    assert zoora.Zoora._smr_scanner_line({"ext": {"smr_scanner": d}}) == ""
    _db(tmp_path, with_cycles=False)
    d = sources.smr_scanner()          # falls back to the newest score time
    assert d["cycle"] is None and d["status"] == "ok" and len(d["rows"]) == 3


def test_desk_in_cheap_sources():
    assert sources.CHEAP["smr_scanner"] is sources.smr_scanner


def test_forex_placeholder_is_honest(tmp_path, monkeypatch):
    monkeypatch.setenv("AAI_WORKSPACE", str(tmp_path))
    assert "no forex agent folder" in registry.forex_why()
    (tmp_path / "aai-forex").mkdir()
    why = registry.forex_why()
    assert "aai-forex agent is on this computer" in why and "never run from this box" in why
    assert "registry.forex_why()" not in why


def test_hud_wiring_textcontent_only():
    html = open(os.path.join(ROOT, "aai", "static", "zoora", "index.html")).read()
    js = open(os.path.join(ROOT, "aai", "static", "zoora", "zoora.js")).read()
    assert 'id="smrDesk"' in html
    assert "function renderSmrDesk(ov)" in js and "renderSmrDesk(ov);" in js
    body = js[js.index("function renderSmrDesk(ov)"):js.index("function renderSecurity(ov)")]
    assert "innerHTML" not in body and "STALE" in body and "ov.ext.smr_scanner" in body
