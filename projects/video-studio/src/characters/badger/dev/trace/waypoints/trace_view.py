import sys, json, importlib
import tools
mod = importlib.import_module(sys.argv[1]); crop = sys.argv[2]
out = {}; rep = []
for k, wps in mod.R.items():
    r = []
    out[k] = [list(p) for p in tools.trace(crop, wps, step=float(sys.argv[4]) if len(sys.argv) > 4 else 11, report=r)]
    if r: print(k, r)
json.dump(out, open(sys.argv[3], 'w'))
