import json, yaml, sys
from pathlib import Path
from aai_fx.research.zoora import run_all, render, render_h2h
base = yaml.safe_load(open("configs/zoora.yaml"))
scen = {
 "xau_spread60": lambda c: c["costs"]["per_pair"]["XAUUSD"].update(spread_pips=60),
 "no_swap": lambda c: [c["costs"]["per_pair"][p].update(swap_long_pct_pa=0.0, swap_short_pct_pa=0.0) for p in ("AUDUSD","XAUUSD")],
}
out = Path("research/zoora/sensitivity")
for name, f in scen.items():
    c = json.loads(json.dumps(base)); f(c)
    p = out / f"{name}.yaml"; p.write_text(yaml.safe_dump(c, sort_keys=False))
    res = run_all(str(p), Path("."), {"dukascopy": ["D1", "H4", "H1"]}, ["AUDUSD", "XAUUSD"], 7)
    slim = [{k: v for k, v in r.items() if k != "daily_equity"} for r in res]
    (out / f"{name}.json").write_text(json.dumps(slim, indent=1, default=str))
    (out / f"{name}.md").write_text(f"Scenario {name}\n\n" + render(res, {}))
    print(name, "done", flush=True)
