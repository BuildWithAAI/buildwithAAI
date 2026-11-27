"""T11g/T11j: the panel-18 P/S history sparklines were mouse-only (hover title). psHist() makes each one a spkKeys()
slider stepping the logged sessions it already draws, with a round SVG cursor and the shared #funRead readout; on a
period_marks session the reading says "new filing", so the T11h tick is not visual-only. Real JS under node with the
fake DOM from test_spark_keyboard; no network, no DB."""
from __future__ import annotations

import json
import re

from test_spark_keyboard import CSS, HTML, JS, _fn, _node


def _big() -> str:
    m = re.search(r"\nconst big = [\s\S]*?;\n", JS)
    assert m
    return m.group(0)


def _pre() -> str:
    return _big() + _fn("spkCur") + _fn("psMarks") + _fn("spark") + _fn("psHist")


HD = {"points": [["2026-11-20", 10.0, 2.0e9, -0.05], ["2026-11-21", 11.0, 2.2e9, -0.045], ["2026-11-24", None, None, None],
                 ["2026-11-25", 8.8, 2.1e9, None]],
      "period_marks": [{"session": "2026-11-25", "period_end": "2026-09-30", "prev_period_end": "2026-06-30"}]}


def test_ps_history_steps_sessions_with_filing_reading(tmp_path):
    out = _node(tmp_path, _pre() + """
const hd=%s; const hpts=hd.points.filter((pt)=>Array.isArray(pt)&&isNum(pt[1]));
const read=el('div'); read.hidden=true;
const box=psHist(hd,hpts,'SPCE',read); const svg=box.children[0];
const cur=svg.children.find((c)=>c.attrs.class==='spk-cur'); const ticks=svg.children.filter((c)=>c.attrs.class==='spk-period');
const a0=[box.className, box.attrs.role, box.attrs['aria-valuemax'], box.attrs['aria-valuetext'], box.attrs['aria-label']];
box.focus(); const a=[box.attrs['aria-valuetext'], read.textContent, read.hidden, cur.attrs.visibility, cur.attrs.cx];
key(box,'ArrowLeft'); const b=[box.attrs['aria-valuetext'], cur.attrs.cx];
key(box,'Home'); const c=box.attrs['aria-valuetext'];
box.listeners.blur(); const d=[read.hidden, cur.attrs.visibility];
console.log(JSON.stringify({a0,a,b,c,d,ticks:ticks.map((t)=>t.attrs.x1),stroke:svg.children[0].attrs.stroke}));
""" % json.dumps(HD))
    assert out["a0"][0].split() == ["ps-kbd", "spk-kbd"] and out["a0"][1] == "slider" and out["a0"][2] == "3"
    assert out["a0"][3] == "SPCE P/S history, 3 sessions 2026-11-20 to 2026-11-25, 1 new filing inside"
    assert "Arrow keys" in out["a0"][4]
    # newest first; the session with no P/S (11-24) is not a point, so the change is vs 11-21, never invented
    assert out["a"][0] == ("SPCE 2026-11-25: P/S 8.8× · −20.0% vs 2026-11-21 · mkt cap $2.10B · new filing (period ending "
                           "2026-09-30, was 2026-06-30): sales TTM changed, part of the move is the denominator · session 3 of 3")
    assert out["a"][1] == out["a"][0] and out["a"][2] is False and out["a"][3] == "visible" and out["a"][4] == "40"
    assert out["b"][0] == "SPCE 2026-11-21: P/S 11.0× · +10.0% vs 2026-11-20 · mkt cap $2.20B · FCF yld −4.5% · session 2 of 3"
    assert "new filing" not in out["b"][0] and out["b"][1] == "20"
    assert out["c"] == "SPCE 2026-11-20: P/S 10.0× · mkt cap $2.00B · FCF yld −5.0% · session 1 of 3"
    assert out["d"] == [True, "hidden"]
    assert out["ticks"] == ["40.0"] and out["stroke"] == "var(--cyan)"  # cheaper than the first session = cyan


def test_ps_history_needs_two_points_and_drops_bad_rows(tmp_path):
    out = _node(tmp_path, _pre() + """
const read=el('div');
const one=psHist({points:[['2026-11-25',5]]},[['2026-11-25',5]],'X',read);
const bad=psHist({},[['2026-11-25',5],[null,6],['2026-11-26','7']],'X',read);
const none=psHist(null,null,'X',read);
const two=psHist({},[['2026-11-24',5],['2026-11-25',150]],'Y',read); two.focus();
console.log(JSON.stringify({one,bad,none,t:two.attrs['aria-valuetext'],stroke:two.children[0].children[0].attrs.stroke}));
""")
    assert out["one"] is None and out["bad"] is None and out["none"] is None
    assert out["t"] == "Y 2026-11-25: P/S 150× · +2900.0% vs 2026-11-24 · session 2 of 2"
    assert out["stroke"] == "var(--amber)"


def test_panel18_wires_readout_help_and_css():
    js = JS
    body = js[js.index("function renderFundamentals"):js.index("function renderEarningsCadence")]
    assert "psHist(hd, hpts, String(r.ticker).toUpperCase(), $('#funRead'))" in body and "innerHTML" not in body
    helper = js[js.index("function psHist"):js.index("function spark(")]
    assert "innerHTML" not in helper and "spkKeys(box" in helper
    assert 'id="funRead"' in HTML and "panel 18 P/S history" in HTML
    assert ".tbl.fun td .ps-kbd{" in CSS
