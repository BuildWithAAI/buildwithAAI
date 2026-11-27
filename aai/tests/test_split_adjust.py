"""T11e split-adjusted share counts: replay of NVIDIA's real 10:1 split (2024-06-10) from recorded Yahoo + SEC data, plus
the rules around it (reverse splits, bad ratios, weighted-average counts, the 1Y change, the dilution alarm). Pure; no DB."""
from __future__ import annotations
import json
from datetime import datetime, timezone
from pathlib import Path

import pytest

from aai.intel import alarms, valuation
from aai.intel.adapters import xbrl, yahoo

ROOT = Path(__file__).resolve().parents[1]
FX = json.loads((ROOT / "tests/fixtures/intel/nvda_split_2024.json").read_text())


def ts(d):
    return datetime.fromisoformat(d).replace(tzinfo=timezone.utc).timestamp()


def facts_as_of(day):
    """The dei cover-page facts NVDA had filed by `day` (what the fundamentals feed would have seen then)."""
    xs = [x for x in FX["facts"]["dei"]["EntityCommonStockSharesOutstanding"]["units"]["shares"] if x["filed"] <= day]
    return {"dei": {"EntityCommonStockSharesOutstanding": {"units": {"shares": xs}}}}


def close_on(day):
    r = FX["chart"]["chart"]["result"][0]
    return dict(zip((datetime.fromtimestamp(t, timezone.utc).date().isoformat() for t in r["timestamp"]),
                    r["indicators"]["quote"][0]["close"]))[day]


@pytest.fixture
def nvq():
    q = yahoo.parse_watch("NVDA", FX["chart"])
    assert q["splits"] == [{"ts": 1718026200.0, "ratio": 10.0, "label": "10:1"}]   # Yahoo's real event: 2024-06-10
    return q


def test_nvda_10_for_1_replay_matches_the_next_real_cover_count(nvq):
    sh = xbrl.shares(facts_as_of("2024-07-05"))
    assert sh["shares"] == 2_460_000_000 and sh["shares_end"] == "2024-05-24" and sh["shares_basis"] == "cover page"
    px = close_on("2024-07-01")                                     # post-split weekly close, $125.83
    fr = {"ticker": "NVDA", **sh, "revenue_ttm": 79.774e9, "fcf_ttm": 39.0e9, "debt": 8.46e9, "liquidity": 31.4e9, "flags": []}
    m = valuation.one(fr, {**nvq, "last": px, "ts": ts("2024-07-05T20:00:00")}, ts("2024-07-05T22:00:00"))
    assert m["withheld"] is None and "SPLIT_ADJUSTED" in m["flags"]
    assert m["shares"] == pytest.approx(24.6e9) and m["shares_reported"] == 2.46e9
    assert m["split_adj"]["factor"] == 10.0 and m["split_adj"]["splits"][0]["date"] == "2024-06-10"
    assert "x 10 for 10:1 on 2024-06-10" in m["split_adj"]["note"]
    # NVDA's next real cover count (2024-08-23, filed 2024-08-28) was 24.53B: the adjusted count is within 0.5%
    nxt = xbrl.shares(facts_as_of("2024-08-28"))
    assert nxt["shares"] == 24_530_000_000 and abs(m["shares"] / nxt["shares"] - 1) < 0.005
    assert m["mcap"] == pytest.approx(px * 24.6e9) and 3.0e12 < m["mcap"] < 3.2e12   # ~$3.1T, NVDA's real July 2024 cap
    assert m["ps"] == pytest.approx(m["mcap"] / 79.774e9)
    # before the T11e fix this priced at 2.46B shares (a $0.31T cap): never again mixes a pre-split count with a post-split price
    v = valuation.compute({"fundamentals": {"rows": [fr]}, "watch_quotes": {"rows": [{**nvq, "last": px, "ts": ts("2024-07-05T20:00:00")}]}},
                          ts("2024-07-05T22:00:00"))
    assert v["split_adjusted"] == ["NVDA"] and v["priced"] == 1 and "split-adjusted for NVDA" in valuation.text(v)


def test_nvda_one_year_change_is_split_adjusted_not_plus_900(nvq):
    sh = xbrl.shares(facts_as_of("2024-08-28"))
    assert sh["shares_prior_end"] == "2023-08-18" and sh["shares_prior"] == 2_470_000_000
    assert sh["shares_yoy"] == pytest.approx(24.53 / 2.47 - 1)        # reported: +893%
    fr = {"ticker": "NVDA", **sh}
    y = valuation.split_yoy(fr, nvq)
    assert y["status"] == "adjusted" and y["yoy"] == pytest.approx(24.53 / 24.7 - 1)   # -0.7%: a small buyback
    assert "10:1 on 2024-06-10" in y["note"] and "+893%" in y["note"]
    row = {"ticker": "NVDA", "period_end": "2024-07-28", "form": "10-Q", **sh}
    assert [a["kind"] for a in alarms.fundamentals_alarms({"rows": [row]})] == ["dilution"]          # no split data: old behaviour
    assert alarms.fundamentals_alarms({"rows": [row]}, quotes={"rows": [nvq]}) == []                  # split taken out: no alarm


def test_split_yoy_unknown_without_prior_or_for_weighted_average(nvq):
    sh = xbrl.shares(facts_as_of("2024-08-28"))
    old = {"ticker": "NVDA", **{k: v for k, v in sh.items() if k not in ("shares_prior", "shares_prior_end")}}  # pre-T11e payload
    y = valuation.split_yoy(old, nvq)
    assert y["status"] == "unknown" and y["yoy"] is None and "not comparable" in y["note"]
    row = {"period_end": "2024-07-28", **old}
    assert alarms.fundamentals_alarms({"rows": [row]}, quotes={"rows": [nvq]}) == []                  # never a false +893% alarm
    w = valuation.split_yoy({**fr_wavg(sh)}, nvq)
    assert w["status"] == "unknown" and "restated" in w["note"]
    assert valuation.split_yoy({"ticker": "NVDA", **sh}, None)["status"] == "raw"
    assert valuation.split_yoy({"ticker": "NVDA", **sh}, {"splits": []})["status"] == "raw"


def fr_wavg(sh):
    return {"ticker": "NVDA", **sh, "shares_basis": "weighted avg basic (quarter)"}


NOW = ts("2026-11-26T18:00:00")


def base(**k):
    return {"ticker": "ACME", "shares": 1e9, "shares_end": "2026-10-15", "shares_basis": "cover page", "filed": "2026-10-30",
            "revenue_ttm": 50e9, "fcf_ttm": 5e9, "debt": 0.0, "liquidity": 0.0, "flags": [], **k}


def quote(*splits):
    return {"ticker": "ACME", "last": 10.0, "ts": NOW - 60, "currency": "USD", "splits": list(splits)}


def test_reverse_split_and_two_splits_multiply():
    rev = {"ts": ts("2026-11-02T13:30:00"), "ratio": 0.1, "label": "1:10"}
    m = valuation.one(base(), quote(rev), NOW)
    assert m["shares"] == pytest.approx(1e8) and m["mcap"] == pytest.approx(1e9) and "SPLIT_ADJUSTED" in m["flags"]
    a = {"ts": ts("2026-10-20T13:30:00"), "ratio": 2.0, "label": "2:1"}
    b = {"ts": ts("2026-11-10T13:30:00"), "ratio": 3.0, "label": "3:1"}
    m2 = valuation.one(base(), quote(a, b), NOW)
    assert m2["split_adj"]["factor"] == 6.0 and m2["mcap"] == pytest.approx(60e9) and [s["label"] for s in m2["split_adj"]["splits"]] == ["2:1", "3:1"]
    old = {"ts": ts("2026-10-01T13:30:00"), "ratio": 5.0, "label": "5:1"}          # before the count: not applied
    assert valuation.one(base(), quote(old), NOW)["split_adj"] is None


def test_bad_ratio_withheld_and_weighted_average_rules():
    bad = {"ts": ts("2026-11-02T13:30:00"), "ratio": 1e6, "label": "1000000:1"}
    m = valuation.one(base(), quote(bad), NOW)
    assert m["mcap"] is None and "unusable ratio" in m["withheld"] and "SPLIT_SINCE_COVER" in m["flags"]
    s = {"ts": ts("2026-10-20T13:30:00"), "ratio": 4.0, "label": "4:1"}             # after the period end, before filing
    w = valuation.one(base(shares_basis="weighted avg basic (quarter)"), quote(s), NOW)
    assert w["mcap"] is None and "may already be restated" in w["withheld"]
    late = {"ts": ts("2026-11-05T13:30:00"), "ratio": 4.0, "label": "4:1"}          # after the filing: exact to adjust
    w2 = valuation.one(base(shares_basis="weighted avg basic (quarter)"), quote(late), NOW)
    assert w2["mcap"] == pytest.approx(40e9) and {"SPLIT_ADJUSTED", "SHARES_WAVG"} <= set(w2["flags"])


def test_hud_labels_split_adjusted_textcontent_only():
    js = (ROOT / "aai/static/zoora/zoora.js").read_text()
    body = js[js.index("function renderFundamentals"):js.index("// Earnings cadence (T9b)")]
    assert "SPLIT-ADJUSTED: " in body and "split-adj." in body and "shares_yoy_status" in body
    assert "not split-adjusted" not in body and "innerHTML" not in body
    assert "small.spl" in (ROOT / "aai/static/zoora/zoora.css").read_text()
