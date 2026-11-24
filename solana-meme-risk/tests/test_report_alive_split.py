"""Report: dump rate split into coins alive at entry vs already drained / bad quote (s51)."""
from smr.paper.report import alive_split


def L(pvl, dumped, liq=1000.0, mc=10000.0, done=1):
    return {"price_vs_launch": pvl, "dumped50": dumped, "track_done": done, "entry_liq": liq, "entry_mcap": mc}


def test_alive_split_excludes_dead_and_bad_quotes():
    rows = [L(5.0, 1), L(5.0, 0), L(0.01, 1), L(None, 1), L(20.0, 1, liq=10.0, mc=10000.0), L(3.0, 0, done=0)]
    r = alive_split(rows)
    assert r["resolved_alive_at_entry"] == 2 and r["dumped_50pct_alive"] == 1 and r["dump_rate_alive_pct"] == 50.0
    assert r["resolved_dead_or_bad_quote_at_entry"] == 3


def test_alive_split_empty():
    assert alive_split([])["dump_rate_alive_pct"] is None
