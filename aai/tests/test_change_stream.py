"""SSE overview stream + change_id fingerprint (paper/read-only, tmp DB)."""
import json

import pytest

from aai import change_stream, guard, sources
from aai.adapters.registry import build
from aai.hud import create_app


class Dummy:
    def health(self, quick=True):
        return {"ok": True}


FAKE_EXT = {
    "perps": {"paper": {"arms": [], "killed": False}},
    "security": {"alerts": [], "wallet_alerts": 0, "failed_sources": []},
    "agent_guard": {"highs": []},
    "forex": {"kill_switch": False},
    "solana_meme": {},
}


@pytest.fixture
def ad(cfg, store):
    a = build(cfg, store)
    a["blofin"] = Dummy()
    a["solana_meme"].health = lambda quick=True: {"ok": True}
    return a


@pytest.fixture
def app(cfg, store, ad, monkeypatch):
    monkeypatch.delenv("AAI_HUD_TOKEN", raising=False)
    monkeypatch.delenv("XAI_API_KEY", raising=False)
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.setattr(sources, "cheap_all", lambda: json.loads(json.dumps(FAKE_EXT)))
    monkeypatch.setattr(guard, "global_kill", lambda: {"engaged": False, "reason": None})
    return create_app(cfg, store, ad, heavy=False)


@pytest.fixture
def client(app):
    return app.test_client()


def test_overview_change_id_stable_ignores_clock():
    base = {
        "alerts": [{"id": "a1", "sev": "high", "title": "X"}],
        "risk": {"kill_switch": {"on": False}, "gauges": [{"id": "open_risk", "value": 0.01}]},
        "guard": {"global_kill": {"engaged": False}},
        "audit": {"verify": {"ok": True}},
        "pipelines": [{"id": "aai", "state": "OK"}],
        "positions": {"equity": 10000.0, "open": []},
        "ideas": [],
        "econ_events": [],
        "freshness": [{"source": "quotes", "stale": False}],
        "security": {"alerts": []},
        "memes": {"scores": []},
        "heavy": {"running": False},
        "meta": {"auth": False, "llm": {"present": False}, "uptime_sec": 1,
                 "health_cache": {"source": "cache", "stale": False}},
        "now": 1000.0,
    }
    a = change_stream.overview_change_id(base)
    base2 = dict(base)
    base2["now"] = 2000.0
    base2["meta"] = dict(base["meta"])
    base2["meta"]["uptime_sec"] = 999
    assert change_stream.overview_change_id(base2) == a
    base3 = dict(base)
    base3["alerts"] = [{"id": "a1", "sev": "critical", "title": "X"}]
    assert change_stream.overview_change_id(base3) != a


def test_format_sse_shape():
    msg = change_stream.format_sse("ping", {"ts": 1.5, "change_id": "abc"}, event_id="abc")
    assert msg.startswith("id: abc\n")
    assert "event: ping\n" in msg
    assert "data: {" in msg and msg.endswith("\n\n")


def test_attach_change_id_on_overview(client):
    ov = client.get("/api/zoora/overview").json
    assert ov["ok"] is True
    cid = ov["meta"]["change_id"]
    assert isinstance(cid, str) and len(cid) == 16
    assert change_stream.overview_change_id(ov) == cid


def test_stream_endpoint_pushes_overview_then_reconnect(client):
    r = client.get("/api/zoora/stream?max_sec=2&tick_sec=0.05")
    assert r.status_code == 200
    assert "text/event-stream" in r.content_type
    body = r.data.decode()
    assert "event: overview" in body or "event: ping" in body
    assert "event: reconnect" in body
    if "event: overview" in body:
        chunk = body.split("event: overview", 1)[1]
        data_line = [ln for ln in chunk.splitlines() if ln.startswith("data: ")][0]
        payload = json.loads(data_line[6:])
        assert payload.get("ok") is True
        assert payload.get("meta", {}).get("change_id")


def test_stream_since_matching_sends_ping_not_duplicate(client):
    ov = client.get("/api/zoora/overview").json
    cid = ov["meta"]["change_id"]
    r = client.get(f"/api/zoora/stream?since={cid}&max_sec=2&tick_sec=0.05")
    assert r.status_code == 200
    body = r.data.decode()
    assert "event: ping" in body
    assert "event: reconnect" in body


def test_stream_static_hooks():
    js = open("aai/static/zoora/zoora.js").read()
    assert "EventSource" in js and "/api/zoora/stream" in js
    assert "applyOverview" in js and "startSSE" in js and "LIVE · SSE" in js
    assert "noboot|nosse" in js  # screenshot path must not open EventSource
    assert "maybeSessionChime" in js and "zoora.sessionChime" in js
    html = open("aai/static/zoora/index.html").read()
    assert "session-open chime" in html
