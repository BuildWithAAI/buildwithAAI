"""P3 PWA manifest + offline shell: installable localhost HUD, SW never caches /api/*."""
from pathlib import Path

import pytest

from aai.adapters.registry import build
from aai.hud import create_app
from aai import sources, guard
import json, time

ROOT = Path(__file__).resolve().parents[1]
STATIC = ROOT / "aai" / "static" / "zoora"

FAKE_EXT = {
    "perps": {"name": "perps-pipeline", "status": "ok", "stale": False, "age_sec": 60, "ts": time.time() - 60,
              "signals": [], "quotes": {}, "paper": {"kind": "arena", "arms": [], "equity": 100.0, "start_equity": 100.0, "open": [], "killed": False}},
    "forex": {"name": "aai-forex", "status": "ok", "stale": False, "age_sec": 60, "ts": time.time() - 60, "signals": [], "bias": [], "paper": [], "kill_switch": False},
    "billy": {"name": "billy-pipeline", "status": "ok", "stale": False, "age_sec": 60, "ts": time.time() - 60, "candidates": []},
    "security": {"name": "security-pipeline", "status": "ok", "stale": False, "age_sec": 60, "generated_at": None, "window": "4h", "failed_sources": [], "counts": {}, "alerts": []},
    "agent_guard": {"name": "agent-guard", "status": "ok", "stale": False, "age_sec": 60, "summary": {"CRITICAL": 0, "HIGH": 0}, "highs": [], "global_kill_switch": False},
    "smr_local": {"name": "solana-meme-risk", "present": True, "stale": False, "age_sec": 60},
}


@pytest.fixture
def client(cfg, store, monkeypatch):
    monkeypatch.delenv("AAI_HUD_TOKEN", raising=False)
    monkeypatch.delenv("XAI_API_KEY", raising=False)
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.setattr(sources, "cheap_all", lambda: json.loads(json.dumps(FAKE_EXT)))
    monkeypatch.setattr(guard, "global_kill", lambda: {"engaged": False, "reason": None})
    ad = build(cfg, store)
    ad["blofin"] = type("D", (), {"health": lambda self, **k: {"ok": True}, "scan": lambda self, s: []})()
    ad["solana_meme"].health = lambda quick=True: {"ok": True}
    app = create_app(cfg, store, ad, heavy=False)
    return app.test_client()


def test_manifest_and_icons_present(client):
    m = client.get("/static/zoora/manifest.webmanifest")
    assert m.status_code == 200
    body = m.data.decode()
    assert "Zoora" in body and "start_url" in body and "icon-192.png" in body
    assert '"display": "standalone"' in body or '"display":"standalone"' in body
    assert client.get("/static/zoora/icon-192.png").status_code == 200
    assert client.get("/static/zoora/icon-512.png").status_code == 200
    assert (STATIC / "manifest.webmanifest").is_file()
    assert (STATIC / "icon-192.png").is_file()


def test_sw_route_headers_and_no_api_cache(client):
    r = client.get("/sw.js")
    assert r.status_code == 200
    assert "javascript" in r.headers["Content-Type"]
    assert r.headers.get("Service-Worker-Allowed") == "/"
    text = r.data.decode()
    assert "zoora-shell-v3" in text
    assert "versioned ? await c.match(req)" in text  # a new ?v= build is never shadowed by the stale bare-path entry
    assert "Never caches" in text or "never cache" in text.lower() or "never /api" in text.lower()
    # must refuse to intercept /api/
    assert "isApi" in text and "/api/" in text
    assert "PRECACHE" in text
    assert "/static/zoora/zoora.js" in text
    # offline page
    o = client.get("/zoora/offline")
    assert o.status_code == 200 and b"OFFLINE SHELL" in o.data
    assert client.get("/static/zoora/offline.html").status_code == 200
    assert client.get("/static/zoora/offline.css").status_code == 200
    assert b"<style>" not in client.get("/zoora/offline").data  # CSP style-src self


def test_page_links_manifest_and_offline_banner(client):
    r = client.get("/zoora")
    assert r.status_code == 200
    html = r.data.decode()
    assert 'rel="manifest"' in html and "manifest.webmanifest" in html
    assert 'id="offlineBanner"' in html
    assert 'id="chipOffline"' in html
    assert "worker-src 'self'" in r.headers["Content-Security-Policy"]
    assert "manifest-src 'self'" in r.headers["Content-Security-Policy"]


def test_pwa_static_hooks():
    js = (STATIC / "zoora.js").read_text()
    assert "registerZooraSW" in js and "navigator.serviceWorker.register('/sw.js'" in js
    assert "setOfflineUI" in js and "syncOnlineState" in js
    assert "127.0.0.1" in js  # localhost-only registration guard
    sw = (STATIC / "sw.js").read_text()
    assert "isApi" in sw
    # ensure API paths are not in PRECACHE list
    precache_block = sw.split("const PRECACHE")[1].split("];")[0]
    assert "/api/" not in precache_block
