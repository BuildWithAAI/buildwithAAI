"""Round marks over stretched sparklines: the >20D breadth sparkline and the equity curve use
preserveAspectRatio=none, so an SVG <circle> in them drew as an ellipse. Cross rings and the equity hover dot now
live in an HTML overlay (spkWrap/spkDot) positioned by percentage. Runs the real JS under node with a tiny fake DOM;
no network, no DB."""
from __future__ import annotations

import json
import re
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
JS = (ROOT / "aai/static/zoora/zoora.js").read_text()
CSS = (ROOT / "aai/static/zoora/zoora.css").read_text()

FAKE_DOM = r"""
class N { constructor(tag, ns){ this.tag=tag; this.ns=ns||null; this.children=[]; this.attrs={}; this.hidden=false;
  this.textContent=''; this.className=''; const st={}; st.setProperty=(k,v)=>{st[k]=v;}; this.style=st;
  this.classList={add(){},remove(){}}; this.listeners={}; }
  append(...c){ this.children.push(...c); } setAttribute(k,v){ this.attrs[k]=String(v); }
  addEventListener(t,f){ this.listeners[t]=f; } getBoundingClientRect(){ return {left:0,width:300}; } }
const document={ createElement:(t)=>new N(t), createElementNS:(ns,t)=>new N(t,ns) };
const walk=(n,f)=>{ f(n); (n.children||[]).forEach((c)=>walk(c,f)); };
"""


def _fn(name: str) -> str:
    one = re.search(r"\nfunction %s\([^\n]*\}\n" % re.escape(name), JS)  # one-line helpers (sv, spkWrap)
    if one:
        return one.group(0)
    m = re.search(r"\nfunction %s\([\s\S]*?\n}\n" % re.escape(name), JS)
    assert m, name
    return m.group(0)


def _prelude() -> str:
    head = re.search(r"const SVGNS = [^\n]*\n", JS).group(0)
    isnum = re.search(r"const isNum = [^\n]*\n", JS).group(0)
    kbd = "".join(re.search(r"const %s = [^\n]*\n" % k, JS).group(0) for k in ("spkSel", "SPK_STEP"))  # keyboard reading
    return FAKE_DOM + head + isnum + kbd + "".join(_fn(n) for n in ("el", "sv", "spkWrap", "spkDotPos", "spkDot", "spkKeys"))


def _node(tmp_path, body: str):
    node = shutil.which("node")
    if not node:
        pytest.skip("node not installed")
    f = tmp_path / "h.js"
    f.write_text(_prelude() + body)
    r = subprocess.run([node, str(f)], capture_output=True, text=True, timeout=20)
    assert r.returncode == 0, r.stderr
    return json.loads(r.stdout)


def test_spk_dot_position_is_percent_clamped_and_hidden_when_invalid(tmp_path):
    out = _node(tmp_path, """
const a=spkDot(110,17,220,34,'x',8), b=spkDot(-5,99,220,34,'y'), c=spkDot('1.5',NaN,220,34,'z'), d=spkDot(1,1,0,34);
console.log(JSON.stringify([[a.style.left,a.style.top,a.style['--d'],a.className,a.attrs['aria-hidden'],a.hidden,a.tag],
  [b.style.left,b.style.top,b.hidden],[c.hidden],[d.hidden], spkDotPos(55,8.5,220,34)]));
""")
    a, b, c, d, pos = out
    assert a == ["50.00%", "50.00%", "8px", "spk-dot x", "true", False, "i"]
    assert b == ["0.00%", "100.00%", False]  # clamped to the box, never outside the panel
    assert c == [True] and d == [True]  # bad coords or a zero-size viewBox hide the mark instead of guessing
    assert pos == {"left": "25.00%", "top": "25.00%"}


def test_breadth_cross_rings_are_html_overlay_not_svg_circles(tmp_path):
    body = _fn("renderBreadthAbove")
    assert "sv('circle'" not in body and "spkDot(" in body and "spkWrap(svg, 'sb-ab-wrap')" in body
    assert "innerHTML" not in body
    pts = [{"day": f"2026-11-{d:02d}", "pct": p, "n": 11, "above": round(p * 11)} for d, p in
           zip(range(3, 23), [0.7] * 17 + [0.4, 0.4, 0.4])]
    today = dict(pts[-1])
    h_cross = {"points": pts, "cross": {"to": "below_half", "day": today["day"], "prev_sessions": 17, "live": False}}
    h_follow = {"points": pts, "recent_cross": {"to": "below_half", "day": pts[17]["day"], "status": "unwound",
                                                 "held_sessions": 1, "unwound_day": "2026-11-21"}}
    out = _node(tmp_path, body + """
const res=[];
for (const h of [%s, %s]) {
  const row=renderBreadthAbove(h); const wrap=row.children[1]; const svg=wrap.children[0];
  let circles=0; walk(svg,(n)=>{ if(n.tag==='circle') circles++; });
  const dots=wrap.children.filter((c)=>c.className.startsWith('spk-dot') && !c.className.includes('sb-ab-kbd'));  // keyboard cursor: test_spark_keyboard
  res.push({wrap:wrap.className, svg:svg.attrs.class, circles, dots:dots.map((d)=>[d.className,d.style.left,d.style.top,d.style['--d']])});
}
console.log(JSON.stringify(res));
""" % (json.dumps(h_cross), json.dumps(h_follow)))
    cross, follow = out
    for r in out:
        assert r["wrap"] == "spk-wrap sb-ab-wrap" and "sb-ab-spk" in r["svg"] and r["circles"] == 0
    # today's cross: last column centre (19.5/20 of the width), y for 40% on the 34-unit viewBox
    W, H = 220, 34
    x_last = (19 * (W / 20) + (W / 20) / 2) / W * 100
    y40 = float(f"{H - 2 - 0.4 * (H - 4):.1f}") / H * 100
    assert cross["dots"] == [["spk-dot sb-ab-cross neg", f"{x_last:.2f}%", f"{y40:.2f}%", "9px"]]
    x17 = (17 * (W / 20) + (W / 20) / 2) / W * 100
    assert follow["dots"] == [["spk-dot sb-ab-cross amb", f"{x17:.2f}%", f"{y40:.2f}%", "8px"]]


def test_equity_hover_dot_is_round_overlay_and_plain_sparks_unchanged(tmp_path):
    body = _fn("spark")
    assert "sv('circle'" not in body and "spkWrap(svg, 'spk-tipwrap')" in body
    out = _node(tmp_path, body + """
const tip={textContent:'',classList:{add(){},remove(){}}};
const fmtEqHover={format:()=>'11-25 18:00'}; const money=(v)=>'$'+v;
const w=spark([[1,100],[2,110],[3,105]],300,34,'var(--green)',{tip});
const svg=w.children[0], mark=w.children[1];
const before=[mark.style.opacity];
svg.listeners.mousemove({clientX:150});
const after=[mark.style.left,mark.style.top,mark.style.opacity,mark.style.background,tip.textContent];
svg.listeners.mouseleave();
const plain=spark([1,2,3]);
console.log(JSON.stringify({wrap:w.className,svgTag:svg.tag,before,after,leave:mark.style.opacity,plain:plain.tag}));
""")
    assert out["wrap"] == "spk-wrap spk-tipwrap" and out["svgTag"] == "svg"
    assert out["before"] == ["0"]
    # x = middle point (i=1 of 3) -> 50%; y for 110 (the high) -> 1/34
    assert out["after"][:3] == ["50.00%", f"{1 / 34 * 100:.2f}%", "1"]
    assert out["after"][3] == "var(--green)" and out["after"][4].startswith("11-25 18:00 CT")
    assert out["leave"] == "0" and out["plain"] == "svg"  # other call sites still get the bare svg


def test_css_keeps_dots_round_and_out_of_the_hover():
    assert ".spk-wrap{position:relative" in CSS
    dot = CSS[CSS.index(".spk-dot{"):]
    dot = dot[:dot.index("}")]
    assert "border-radius:50%" in dot and "pointer-events:none" in dot and "var(--d,6px)" in dot
    assert ".sector-breadth .sb-ab-wrap{" in CSS and ".sector-breadth .sb-ab-wrap>.sb-ab-spk{" in CSS
    assert "stroke-dasharray:2 1.5" not in CSS  # old SVG-stroke ring style is gone; amber ring is a dashed border now
