"""Build a hashed pip lock from exact pins, using PyPI's JSON API (no downloads).
Keeps wheels a CPython 3.13 linux x86_64 runner can install (cp313, abi3, py3-none-any; manylinux x86_64)."""
import json, re, sys, urllib.request

def files(name, ver):
    with urllib.request.urlopen(f"https://pypi.org/pypi/{name}/{ver}/json", timeout=30) as r:
        return json.load(r)["urls"]

def ok_wheel(fn):
    if not fn.endswith(".whl"):
        return False
    m = re.match(r"^(.+?)-(\d[^-]*)(?:-\d[^-]*)?-([^-]+)-([^-]+)-([^-]+)\.whl$", fn)
    if not m:
        return False
    py, abi, plat = m.group(3), m.group(4), m.group(5)
    pys = py.split(".")
    if not any(p in ("cp313", "py3", "py2.py3") or p.startswith("py3") for p in pys) and not (abi == "abi3" and any(p.startswith("cp3") for p in pys)):
        return False
    if abi not in ("cp313", "abi3", "none"):
        return False
    plats = plat.split(".")
    return any(p == "any" or (("manylinux" in p or p.startswith("linux")) and p.endswith("x86_64")) for p in plats)

def lock(path, allow_sdist=False):
    out, report = [], []
    for line in open(path):
        line = line.split("#")[0].strip()
        if not line:
            continue
        name, ver = line.split("==")
        fs = files(name, ver)
        wheels = [f for f in fs if ok_wheel(f["filename"])]
        sdists = [f for f in fs if f["packagetype"] == "sdist"]
        chosen = wheels or (sdists if allow_sdist else [])
        report.append(f"{name}=={ver}: {len(wheels)} wheel(s){'' if wheels else ', sdist only' if sdists else ', NOTHING'}")
        if not chosen:
            out.append(f"# {name}=={ver}: no installable file")
            continue
        hashes = " ".join(f"--hash=sha256:{f['digests']['sha256']}" for f in chosen)
        out.append(f"{name}=={ver} {hashes}")
    return out, report

if __name__ == "__main__":
    out, report = lock(sys.argv[1], allow_sdist=len(sys.argv) > 2)
    print("\n".join(report), file=sys.stderr)
    print("\n".join(out))
