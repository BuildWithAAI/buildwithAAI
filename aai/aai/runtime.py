"""Tiny runtime record of the running HUD (data/hud.json) so `aai healthcheck` can probe the live Zoora endpoints."""
from __future__ import annotations
import json, os, time
from .config import ROOT

PATH = ROOT / "data" / "hud.json"


def write_hud(host: str, port: int):
    PATH.parent.mkdir(parents=True, exist_ok=True)
    tmp = PATH.with_suffix(".tmp")
    tmp.write_text(json.dumps({"pid": os.getpid(), "host": host, "port": port, "started": time.time(),
                               "url": f"http://{host}:{port}/zoora"}))
    os.replace(tmp, PATH)


def read_hud() -> dict | None:
    try:
        d = json.loads(PATH.read_text())
    except (OSError, ValueError):
        return None
    try:
        os.kill(int(d["pid"]), 0)
        d["alive"] = True
    except (OSError, KeyError, ValueError):
        d["alive"] = False
    return d
