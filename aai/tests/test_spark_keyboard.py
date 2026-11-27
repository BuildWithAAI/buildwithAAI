"""Keyboard reading for sparklines: the equity curve and the STOCKS A/D / >20D breadth rows were hover-only. spkKeys()
makes them focusable sliders whose arrow keys step the points they already draw; the reading goes to aria-valuetext and a
visible readout, a cursor marks the point, and a live re-render keeps the stepped-to point. Runs the real JS under node
with a small fake DOM; no network, no DB."""
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
HTML = (ROOT / "aai/static/zoora/index.html").read_text()

FAKE_DOM = r"""
class N { constructor(tag, ns){ this.tag=tag; this.ns=ns||null; this.children=[]; this.attrs={}; this.hidden=false;
  this.textContent=''; this.className=''; const st={}; st.setProperty=(k,v)=>{st[k]=v;}; this.style=st;
  const self=this; this.classList={add(c){ if(!self.className.split(' ').includes(c)) self.className=(self.className+' '+c).trim(); },
    remove(c){ self.className=self.className.split(' ').filter((x)=>x!==c).join(' '); }};
  this.listeners={}; this.isConnected=false; this.focused=0; }
  append(...c){ this.children.push(...c); } setAttribute(k,v){ this.attrs[k]=String(v); if(k==='class') this.className=String(v); }
  getAttribute(k){ return k in this.attrs ? this.attrs[k] : (k==='class' ? this.className : null); }
  addEventListener(t,f){ this.listeners[t]=f; } getBoundingClientRect(){ return {left:0,width:300}; }
  focus(){ this.focused++; document.activeElement=this; if(this.listeners.focus) this.listeners.focus(); } }
const document={ createElement:(t)=>new N(t), createElementNS:(ns,t)=>new N(t,ns), body:{tag:'body'}, activeElement:null };
document.activeElement=document.body;
const requestAnimationFrame=(f)=>{ queued.push(f); }; const queued=[];
const key=(n,k,extra)=>{ let stopped=false, prevented=false; n.listeners.keydown(Object.assign({key:k,preventDefault(){prevented=true;},stopPropagation(){stopped=true;}},extra||{})); return [prevented,stopped]; };
"""


def _fn(name: str) -> str:
    one = re.search(r"\nfunction %s\([^\n]*\}\n" % re.escape(name), JS)
    if one:
        return one.group(0)
    m = re.search(r"\nfunction %s\([\s\S]*?\n}\n" % re.escape(name), JS)
    assert m, name
    return m.group(0)


def _const(name: str) -> str:
    m = re.search(r"\nconst %s = [^\n]*\n" % re.escape(name), JS)
    assert m, name
    return m.group(0)


def _node(tmp_path, body: str):
    node = shutil.which("node")
    if not node:
        pytest.skip("node not installed")
    pre = FAKE_DOM + _const("SVGNS") + _const("isNum") + _const("spkSel") + _const("SPK_STEP")
    pre += "".join(_fn(n) for n in ("el", "sv", "spkWrap", "spkDotPos", "spkDot", "spkKeys"))
    f = tmp_path / "k.js"
    f.write_text(pre + body)
    r = subprocess.run([node, str(f)], capture_output=True, text=True, timeout=20)
    assert r.returncode == 0, r.stderr
    return json.loads(r.stdout)


def _pts(n=20):
    return [{"day": f"2026-11-{d:02d}", "pct": p, "n": 11, "above": round(p * 11), "up": 6, "down": 4, "flat": 1,
             "net": 2 if d % 2 else -3, "ad": d} for d, p in zip(range(1, n + 1), [0.7] * (n - 3) + [0.4] * 3)]


def test_spkkeys_steps_clamps_and_clears(tmp_path):
    out = _node(tmp_path, """
const node=el('div'); const out=el('div'); out.hidden=true; const marks=[];
spkKeys(node,{key:'t',n:4,out,idle:'summary',label:'Test line',read:(i)=>({id:'d'+i,text:'reading '+i}),mark:(i)=>marks.push(i)});
const a0={...node.attrs};
node.focus(); const f=[node.attrs['aria-valuenow'],node.attrs['aria-valuetext'],out.textContent,out.hidden];
const k1=key(node,'ArrowLeft'); const s1=node.attrs['aria-valuetext'];
key(node,'Home'); const s2=node.attrs['aria-valuetext']; key(node,'ArrowLeft'); const s3=node.attrs['aria-valuenow'];
key(node,'PageUp'); const s4=node.attrs['aria-valuenow']; key(node,'End'); const s5=node.attrs['aria-valuenow'];
const other=key(node,'x'); const mod=key(node,'ArrowLeft',{ctrlKey:true}); const s6=node.attrs['aria-valuenow'];
const esc=key(node,'Escape');
console.log(JSON.stringify({a0,f,k1,s1,s2,s3,s4,s5,other,mod,s6,esc,after:[node.attrs['aria-valuenow'],node.attrs['aria-valuetext'],out.hidden],
  marks,cls:node.className,sel:[...spkSel.entries()]}));
""")
    assert out["a0"] == {"tabindex": "0", "role": "slider", "aria-orientation": "horizontal", "aria-valuemin": "1",
                         "aria-valuemax": "4", "aria-valuenow": "4", "aria-valuetext": "summary", "aria-label": "Test line"}
    assert out["f"] == ["4", "reading 3", "reading 3", False]  # focus reads the newest point
    assert out["k1"] == [True, True] and out["s1"] == "reading 2"  # arrows are consumed (no panel jump / PTT)
    assert out["s2"] == "reading 0" and out["s3"] == "1"  # clamped at the first point
    assert out["s4"] == "4" and out["s5"] == "4"  # PageUp +5 clamps to the newest
    assert out["other"] == [False, False] and out["mod"] == [False, False] and out["s6"] == "4"
    assert out["esc"] == [False, False]  # Esc clears but still bubbles (barge-in keeps working)
    assert out["after"] == ["4", "summary", True]
    assert out["marks"][-1] == -1 and "spk-kbd" in out["cls"]
    assert out["sel"] == [["t", "d3"]]


def test_spkkeys_skips_points_without_reading_and_ignores_empty(tmp_path):
    out = _node(tmp_path, """
const node=el('div');
spkKeys(node,{key:'s',n:5,read:(i)=>i===2||i===3?null:({id:i,text:'r'+i})});
node.focus(); key(node,'ArrowLeft'); const a=node.attrs['aria-valuetext'];
key(node,'ArrowRight'); const b=node.attrs['aria-valuetext'];
const empty=el('div'); spkKeys(empty,{key:'e',n:0,read:()=>null}); spkKeys(empty,{key:'e',n:3});
console.log(JSON.stringify({a,b,empty:empty.attrs}));
""")
    assert out["a"] == "r1" and out["b"] == "r4"  # gaps are stepped over, never invented
    assert out["empty"] == {}


def test_rerender_takes_focus_back_on_the_same_point(tmp_path):
    out = _node(tmp_path, """
const mk=(days)=>{ const n=el('div'); spkKeys(n,{key:'sb-ab',n:days.length,read:(i)=>({id:days[i],text:days[i]})}); return n; };
const a=mk(['d1','d2','d3','d4']); a.isConnected=true; a.focus(); key(a,'ArrowLeft'); key(a,'ArrowLeft');
// live update: old row is removed (no blur in Chrome), focus falls to body, the new row has one more session
a.isConnected=false; document.activeElement=document.body;
const b=mk(['d2','d3','d4','d5']); b.isConnected=true; queued.splice(0).forEach((f)=>f());
const r1=[b.focused,b.attrs['aria-valuetext']];
// Chrome fires blur on the removed row while it is still connected; the point must survive that
b.listeners.blur(); b.isConnected=false; document.activeElement=document.body;
setTimeout(()=>{
  const kept=spkSel.size;
  const b2=mk(['d2','d3','d4','d5']); b2.isConnected=true; queued.splice(0).forEach((f)=>f());
  const r2=[b2.focused,b2.attrs['aria-valuetext']];
  // user tabs away: blur on a row that stays connected forgets the point; the next render does not steal focus
  b2.listeners.blur(); document.activeElement={tag:'button'};
  setTimeout(()=>{
    const c=mk(['d2','d3','d4','d5']); c.isConnected=true; queued.splice(0).forEach((f)=>f());
    console.log(JSON.stringify({r1,kept,r2,c:c.focused,sel:spkSel.size}));
  },0);
},0);
""")
    assert out["r1"] == [1, "d2"]
    assert out["kept"] == 1 and out["r2"] == [1, "d2"]  # blur-during-removal does not lose the point
    assert out["c"] == 0 and out["sel"] == 0


def test_breadth_rows_are_keyboard_sliders_with_cursor_and_shared_readout(tmp_path):
    pts = _pts()
    h = {"points": pts, "streak": {"side": "advancers", "n": 2}, "last_live": False}
    body = _const("pctS") if re.search(r"\nconst pctS = ", JS) else ""
    out = _node(tmp_path, body + _fn("renderBreadthAD") + _fn("renderBreadthAbove") + """
const h=%s; const read=el('div'); read.hidden=true;
const ad=renderBreadthAD(h, read), ab=renderBreadthAbove(h, read);
ad.focus(); const adNow=[ad.attrs.role, ad.attrs['aria-valuetext'], read.textContent, read.hidden];
key(ad,'Home'); const bars=ad.children[1].children.filter((c)=>c.tag==='rect');
const kbd=bars.map((b)=>b.className).filter((c)=>c.includes('kbd')); const first0=bars[0].className;
const adFirst=read.textContent;
ad.listeners.blur(); const afterBlur=[read.hidden, bars.filter((b)=>b.className.includes('kbd')).length];
ab.focus(); key(ab,'ArrowLeft');
const cur=ab.children[1].children.find((c)=>c.className.includes('sb-ab-kbd'));
console.log(JSON.stringify({adNow,kbd,first:first0,adFirst,afterBlur,abText:ab.attrs['aria-valuetext'],
  cur:[cur.hidden,cur.style.left,cur.style.top,cur.attrs['aria-hidden']],abLabel:ab.attrs['aria-label']}));
""" % json.dumps(h))
    assert out["adNow"][0] == "slider"
    assert out["adNow"][1].startswith("A/D 2026-11-20: 6 up") and out["adNow"][1].endswith("(closed)")
    assert out["adNow"][2] == out["adNow"][1] and out["adNow"][3] is False
    assert out["kbd"] == [out["first"]] and out["first"].endswith(" kbd")
    assert out["adFirst"].startswith("A/D 2026-11-01:")
    assert out["afterBlur"] == [True, 0]
    assert out["abText"].startswith(">20D 2026-11-19: 4 of 11 above")
    W, H = 220, 34
    x = (18 * (W / 20) + (W / 20) / 2) / W * 100
    y = float(f"{H - 2 - 0.4 * (H - 4):.1f}") / H * 100
    assert out["cur"] == [False, f"{x:.2f}%", f"{y:.2f}%", "true"]
    assert "Arrow keys" in out["abLabel"]


def test_equity_curve_keyboard_uses_the_hover_tip_and_dot(tmp_path):
    out = _node(tmp_path, _fn("spark") + """
const tip=el('div','eqc-tip dim','hover idle');
const w=spark([[1,100],[2,110],['x',null],[3,105]],300,34,'var(--green)',{tip,kbd:{key:'eq-7',fmt:(p)=>'T'+p[0]+' $'+p[1],label:'Eq',idle:'up'}});
const mark=w.children[1];
w.focus(); const a=[tip.textContent, w.attrs['aria-valuemax'], mark.style.opacity, mark.style.left];
key(w,'ArrowLeft'); const b=[tip.textContent, mark.style.left, mark.style.top];
w.listeners.blur(); const c=[tip.textContent, tip.className, mark.style.opacity, w.attrs['aria-valuetext']];
const plain=spark([[1,1],[2,2]],300,34,'red',{tip:el('div')});
console.log(JSON.stringify({a,b,c,plainRole:plain.attrs.role||null}));
""")
    assert out["a"] == ["T3 $105 · point 3 of 3", "3", "1", "100.00%"]  # the bad point is not a step
    assert out["b"][0] == "T2 $110 · point 2 of 3"
    assert out["b"][1] == f"{1 / 3 * 100:.2f}%" and out["b"][2] == f"{1 / 34 * 100:.2f}%"
    assert out["c"] == ["hover idle", "eqc-tip dim", "0", "up"]
    assert out["plainRole"] is None  # no kbd option: no slider, unchanged


def test_wiring_css_and_help():
    eq = _fn("renderEquityCurve")
    assert "kbd: {" in eq and "key: 'eq-' + S.eqDays" in eq
    strip = _fn("renderSectorBreadth")
    assert "renderBreadthAD(b.history, read)" in strip and "renderBreadthAbove(b.above_hist, read)" in strip
    assert "'aria-hidden': 'true'" in strip and "read.hidden = true" in strip
    for f in ("spkKeys", "renderBreadthAD", "renderBreadthAbove", "spark"):
        assert "innerHTML" not in _fn(f)
    assert ".spk-kbd:focus-visible{" in CSS and ".sector-breadth .sb-read[hidden]{display:none}" in CSS
    assert "rect.kbd{" in CSS and ".sb-ab-kbd{" in CSS
    assert "Step a focused sparkline" in HTML
