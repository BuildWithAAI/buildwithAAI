"""Keyboard reading for more sparklines: the economy 14D Exp R line, the FX desk 12W bias line and the perps-arena per-arm
equity curves were hover-only. Each is now a spkKeys() slider stepping the points it already draws, with a round SVG
cursor (spkCur) and a shared visible readout per panel. Runs the real JS under node with the fake DOM; no network, no DB."""
from __future__ import annotations

import json

from test_spark_keyboard import CSS, HTML, _const, _fn, _node


def _pre() -> str:
    return (_const("TZ") + _const("fmtEqHover") + _const("sgn") + _fn("money") + _fn("spkCur"))


def test_spkcur_moves_and_hides(tmp_path):
    out = _node(tmp_path, _fn("spkCur") + """
const svg=sv('svg'); const mv=spkCur(svg, 3); const c=svg.children[0];
const a={...c.attrs}; mv(10, 4.5); const b={...c.attrs}; mv(null, null); const d=c.attrs.visibility; mv('x', 2); const e=c.attrs.visibility;
console.log(JSON.stringify({a,b,d,e}));
""")
    assert out["a"]["class"] == "spk-cur" and out["a"]["visibility"] == "hidden" and out["a"]["r"] == "3"
    assert out["b"]["cx"] == "10" and out["b"]["cy"] == "4.5" and out["b"]["visibility"] == "visible"
    assert out["d"] == "hidden" and out["e"] == "hidden"


def test_econ_history_steps_days_and_skips_missing(tmp_path):
    days = ["2026-11-20", "2026-11-21", "2026-11-22", "2026-11-23"]
    pts = [{"day": days[0], "stage": 0, "granted_stage": 0, "expectancy_r": 0.1, "trades": 3, "killed": False},
           None,
           {"day": days[2], "stage": 1, "granted_stage": 0, "expectancy_r": -0.25, "trades": 5, "killed": False},
           {"day": days[3], "stage": 1, "granted_stage": 0, "expectancy_r": None, "trades": 6, "killed": True}]
    sr = {"days": days, "gap_before": [0, 0, 0, 0], "n_missing": 1, "span_days": 4, "overdue_days": 0,
          "strategies": {"perps:maker_scalp": {"n": 3, "points": pts, "first_stage": 0, "last_stage": 1, "stage_changes": 1,
                                                "max_stage": 1, "expectancy_delta": -0.35, "expectancy_last": -0.25, "trades_delta": 3}}}
    out = _node(tmp_path, _pre() + _fn("econHist") + """
const sr=%s; const read=el('div'); read.hidden=true;
const td=econHist(sr,'perps:maker_scalp',read); const svg=td.children[0]; const cur=svg.children.find((c)=>c.attrs.class==='spk-cur');
td.focus(); const a=[td.attrs.role, td.attrs['aria-valuetext'], read.textContent, read.hidden, cur.attrs.visibility];
key(td,'ArrowLeft'); const b=td.attrs['aria-valuetext']; key(td,'ArrowLeft'); const c=td.attrs['aria-valuetext'];
const cx=cur.attrs.cx;
td.listeners.blur(); const d=[read.hidden, cur.attrs.visibility];
const none=econHist({days:[],strategies:{}},'x:y',read);
console.log(JSON.stringify({a,b,c,cx,d,noneRole:none.attrs.role||null,label:td.attrs['aria-label']}));
""" % json.dumps(sr))
    assert out["a"][0] == "slider"
    assert out["a"][1] == "maker scalp 2026-11-23: S1/G0 KILLED · exp — · 6 trades · day 4 of 4"
    assert out["a"][2] == out["a"][1] and out["a"][3] is False and out["a"][4] == "visible"
    assert out["b"].startswith("maker scalp 2026-11-22: S1/G0 · exp -0.25R · 5 trades")
    assert out["c"].startswith("maker scalp 2026-11-20:")  # the unreported day is stepped over, never invented
    assert out["cx"] == f"{46 / 4 / 2:.1f}".rstrip("0").rstrip(".")
    assert out["d"] == [True, "hidden"]
    assert out["noneRole"] is None and "Arrow keys" in out["label"]


def test_fx_bias_steps_weeks_with_change_and_flip(tmp_path):
    c = {"pair_pct_hist": [["2026-10-28", -4.0], ["2026-11-04", 2.5], ["2026-11-11", 6.0]],
         "flips_12w": [{"idx": 1, "to": "long", "date": "2026-11-04", "from_pct": -4.0, "to_pct": 2.5}], "pct_chg_hist": 10}
    out = _node(tmp_path, _pre() + _fn("fxdHist") + """
const read=el('div'); read.hidden=true;
const td=fxdHist(%s,'EURUSD',read); const box=td.children[0]; const svg=box.children[0];
const cur=svg.children.find((x)=>x.attrs.class==='spk-cur');
box.focus(); const a=[box.attrs.role, box.attrs['aria-valuetext'], td.attrs.role||null];
const k=key(box,'ArrowLeft'); const b=[box.attrs['aria-valuetext'], cur.attrs.visibility, cur.attrs.cx];
const empty=fxdHist({pair_pct_hist:[]},'USDJPY',read);
console.log(JSON.stringify({a,k,b,read:read.textContent,emptyKids:empty.children.length}));
""" % json.dumps(c))
    assert out["a"][0] == "slider" and out["a"][2] is None  # the td keeps its cell role
    assert out["a"][1] == "EURUSD 2026-11-11: specs +6.0% of OI (long EURUSD) · +3.5 pts w/w · week 3 of 3"
    assert out["k"] == [True, True]
    assert out["b"][0] == "EURUSD 2026-11-04: specs +2.5% of OI (long EURUSD) · +6.5 pts w/w · flipped to net long · week 2 of 3"
    assert out["b"][1] == "visible" and out["b"][2] == f"{1 / 2 * 69:.1f}"
    assert out["read"] == out["b"][0] and out["emptyKids"] == 1


def test_arena_arm_curve_steps_marks(tmp_path):
    out = _node(tmp_path, _pre() + _fn("armSpark") + """
const read=el('div'); read.hidden=true;
const curve=[[1795600000,100],[1795603600,101.5],[1795607200,99]];
const box=armSpark(curve,100,{key:'arm-x',out:read,name:'maker scalp'}); const svg=box.children[0];
box.focus(); const a=[box.attrs.role, box.attrs['aria-valuetext']];
key(box,'Home'); const b=box.attrs['aria-valuetext'];
key(box,'ArrowRight'); const c=box.attrs['aria-valuetext'];
const plain=armSpark(curve,100); const flat=armSpark([[1,1]],100,{key:'arm-y',out:read,name:'y'});
console.log(JSON.stringify({a,b,c,read:read.textContent,plain:[plain.tag,plain.attrs.role||null],flat:[flat.tag,flat.attrs.role||null]}));
""")
    assert out["a"][0] == "slider" and out["a"][1].startswith("maker scalp ") and " CT · $99.00 (−1.00% vs $100) · mark 3 of 3" in out["a"][1]
    assert out["b"].endswith("$100.00 (+0.00% vs $100) · mark 1 of 3")
    assert out["c"].endswith("$101.50 (+1.50% vs $100) · mark 2 of 3") and out["read"] == out["c"]
    assert out["plain"] == ["svg", None]  # no kbd option: plain svg, unchanged
    assert out["flat"] == ["svg", None]  # <2 marks: nothing to step


def test_wiring_css_and_help():
    eco, fxd, arena = _fn("renderEconomy"), _fn("renderFxDesk"), _fn("arenaBoard")
    assert "econHist(series, id, $('#econRead'))" in eco
    assert "fxdHist(c, r.pair, $('#fxdRead'))" in fxd
    assert "armSpark(a.curve, a.initial, { key: 'arm-' + id, out: read" in arena and "wrap.append(t, read)" in arena
    for f in ("spkCur", "econHist", "fxdHist", "armSpark", "arenaBoard"):
        assert "innerHTML" not in _fn(f)
    assert 'id="econRead" aria-hidden="true" hidden' in HTML and 'id="fxdRead" aria-hidden="true" hidden' in HTML
    assert "economy 14D, FX 12W, arena arm curves" in HTML
    assert ".spk-cur{" in CSS and ".spk-read[hidden]{display:none}" in CSS
