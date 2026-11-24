"""Zoora voice on the HUD: /api/voice/* auth, caps, context allowlist, escaping, keys-missing state, mocked
end to end, and proof that voice can't reach the ledger, the audit log or any write/command route.

These run in the repo .venv too (no httpx/keyring): the HUD's voice layer is duck-typed against a fake gateway.
Tests that need the real aai.voice package skip when its deps are missing."""
import importlib.util, io, json, re, wave
import pytest
from aai import audit, hud as hud_mod
from aai.adapters.registry import build
from aai.hud import create_app, voice_allowlisted_context, VOICE_CONTEXT_KEYS
from aai.ledger import PaperLedger
from aai.zoora import Zoora, voice_context_from

TOK = "voice-hud-test-token-0123456789"
HOSTILE = '"><img src=x onerror=alert(1)>'
VOICE_DEPS = all(importlib.util.find_spec(m) for m in ("httpx", "keyring"))


class DummyAdapter:
    def health(self, **kw): return {"ok": True, "status": "pass"}
    def scan(self, syms): return [{"symbol": s, "ok": True} for s in syms]


class FakeGateway:
    """Duck-typed VoiceGateway: checks the token it is handed and records every call."""

    def __init__(self, answer="It is 41 degrees in Chicago.", sources=None, audio=b"ID3fake-mp3", text="weather in chicago"):
        self.answer, self.audio, self.text = answer, audio, text
        self.sources = sources if sources is not None else [{"title": "NWS Chicago", "url": "https://www.weather.gov/lot/"}]
        self.calls = []

    def _tok(self, t):
        assert t == TOK, "the HUD must hand the gateway the caller's HUD token"

    def transcribe(self, audio, *, hud_token, mime="audio/wav", duration_s=None):
        self._tok(hud_token); self.calls.append(("transcribe", len(audio), mime, duration_s)); return self.text

    def ask(self, text, context=None, *, hud_token):
        self._tok(hud_token); self.calls.append(("ask", text, context))
        return {"answer": self.answer, "sources": self.sources, "speak_text": self.answer}

    def synthesize(self, text, *, hud_token):
        self._tok(hud_token); self.calls.append(("speak", text)); return self.audio


def wav(seconds=1.0, rate=16000):
    b = io.BytesIO()
    with wave.open(b, "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(rate); w.writeframes(b"\0\0" * int(rate * seconds))
    return b.getvalue()


@pytest.fixture
def app(cfg, store):
    ad = build(cfg, store)
    ad["blofin"] = DummyAdapter(); ad["solana_meme"].health = lambda quick=True: {"ok": True}
    return create_app(cfg, store, ad)


@pytest.fixture
def fake(app, monkeypatch):
    monkeypatch.setenv("AAI_HUD_TOKEN", TOK)
    g = FakeGateway()
    svc = app.config["ZOORA_VOICE"]
    svc._gw = g
    svc._probe = lambda slot: (True, None)
    return g


@pytest.fixture
def c(app):
    return app.test_client()


H = {"X-AAI-Token": TOK}


def post_wav(c, data, dur="1.0", headers=H, ctype="audio/wav"):
    q = "" if dur is None else f"?duration_s={dur}"
    return c.post("/api/voice/transcribe" + q, data=data, headers={**headers, "Content-Type": ctype})


# ------------------------------------------------------------------ auth
@pytest.mark.parametrize("method,path,kw", [
    ("get", "/api/voice/status", {}),
    ("post", "/api/voice/ask", {"json": {"text": "hi"}}),
    ("post", "/api/voice/speak", {"json": {"text": "hi"}}),
])
def test_voice_auth_missing_or_bad_token_is_401(c, fake, method, path, kw):
    assert getattr(c, method)(path, **kw).status_code == 401
    assert getattr(c, method)(path, headers={"X-AAI-Token": "wrong"}, **kw).status_code == 401
    assert getattr(c, method)(path, headers={"X-AAI-Token": TOK + "x"}, **kw).status_code == 401
    assert getattr(c, method)(path, headers=H, **kw).status_code == 200
    assert fake.calls == [] or all(k[0] != "transcribe" for k in fake.calls)


def test_voice_transcribe_auth_401(c, fake):
    assert post_wav(c, wav(), headers={}).status_code == 401
    assert post_wav(c, wav(), headers={"X-AAI-Token": "nope"}).status_code == 401
    assert fake.calls == []
    assert post_wav(c, wav()).status_code == 200


def test_voice_never_runs_unlocked(c, app, monkeypatch):
    """HUD open mode (no AAI_HUD_TOKEN, no token file): every voice route is 401, unlike the rest of the HUD."""
    monkeypatch.delenv("AAI_HUD_TOKEN", raising=False)
    g = FakeGateway(); app.config["ZOORA_VOICE"]._gw = g
    assert c.get("/api/zoora/overview").status_code == 200          # HUD itself is open
    for r in (c.get("/api/voice/status"), c.post("/api/voice/ask", json={"text": "hi"}),
              c.post("/api/voice/speak", json={"text": "hi"}), post_wav(c, wav(), headers={})):
        assert r.status_code == 401 and r.json["state"] == "locked"
    assert g.calls == []


def test_voice_session_cookie_works_and_bad_cookie_401(c, fake):
    c.set_cookie(hud_mod.COOKIE, "wrong-cookie", domain="localhost")
    assert c.get("/api/voice/status").status_code == 401
    c.set_cookie(hud_mod.COOKIE, TOK, domain="localhost")
    assert c.get("/api/voice/status").status_code == 200


def test_voice_localhost_only(c, fake):
    r = c.get("/api/voice/status", headers=H, environ_base={"REMOTE_ADDR": "10.0.0.7"})
    assert r.status_code == 403
    assert c.get("/api/voice/status", headers={**H, "Host": "evil.example:57025"}).status_code == 403
    r = c.post("/api/voice/ask", json={"text": "hi"}, headers={**H, "Origin": "https://evil.example"})
    assert r.status_code == 403
    r = c.post("/api/voice/ask", json={"text": "hi"}, headers={**H, "Sec-Fetch-Site": "cross-site"})
    assert r.status_code == 403
    assert fake.calls == []


# ------------------------------------------------------------------ caps
def test_voice_audio_size_cap(c, fake):
    big = b"\0" * (10 * 1024 * 1024 + 1)
    r = post_wav(c, big, ctype="audio/webm")
    assert r.status_code == 413 and "10 MB" in r.json["error"]
    assert fake.calls == []
    ok = post_wav(c, b"\x1aE\xdf\xa3" + b"\0" * 1000, ctype="audio/webm", dur="12.5")
    assert ok.status_code == 200 and fake.calls[-1][2:] == ("audio/webm", 12.5)


@pytest.mark.parametrize("dur", [None, "", "0", "-1", "60.01", "61", "nan", "inf", "-inf", "abc", "1e9"])
def test_voice_duration_required_and_capped(c, fake, dur):
    r = post_wav(c, wav(), dur=dur)
    assert r.status_code == 400 and "duration_s" in r.json["error"]
    assert fake.calls == []


def test_voice_duration_60s_ok_and_non_audio_refused(c, fake):
    assert post_wav(c, wav(0.5), dur="60").status_code == 200
    assert post_wav(c, b"hello", ctype="text/plain").status_code == 415
    assert c.post("/api/voice/transcribe?duration_s=1", data=b"", headers={**H, "Content-Type": "audio/wav"}).status_code in (400, 411)


def test_voice_text_caps(c, fake):
    assert c.post("/api/voice/ask", json={"text": "x" * 2001}, headers=H).status_code == 400
    assert c.post("/api/voice/ask", json={"text": "   "}, headers=H).status_code == 400
    assert c.post("/api/voice/ask", json={"nope": 1}, headers=H).status_code == 400
    assert c.post("/api/voice/speak", json={"text": "x" * 1001}, headers=H).status_code == 400


@pytest.mark.skipif(not VOICE_DEPS, reason="aai.voice deps (httpx, keyring) not installed")
def test_voice_real_gateway_caps_long_wav(c, app, monkeypatch):
    """Through the real VoiceGateway (fake providers): a WAV longer than 60 s is refused even if duration_s lies."""
    from aai.voice import VoiceGateway, constant_time_verifier
    from tests.voice.fakes import FakeLLM, FakeSTT, FakeTTS
    from aai.voice.providers import ChatTurn
    monkeypatch.setenv("AAI_HUD_TOKEN", TOK)
    stt = FakeSTT()
    app.config["ZOORA_VOICE"]._gw = VoiceGateway(token_verifier=constant_time_verifier(hud_mod.resolve_hud_token),
                                                 llm=FakeLLM([ChatTurn(content="x")]), stt=stt, tts=FakeTTS())
    r = post_wav(c, wav(61.0, rate=8000), dur="5")
    assert r.status_code == 400 and stt.calls == 0
    assert post_wav(c, wav(2.0), dur="2").json["text"] == "what is the weather in chicago"


# ------------------------------------------------------------------ context allowlist
HOSTILE_OV = {
    "alerts": [
        {"sev": "critical", "title": "AAI KILL SWITCH ON", "detail": "equity 9,812.44"},
        {"sev": "high", "title": "3 wallet approval alerts"},
        {"sev": "warn", "title": "Gross exposure near cap", "detail": "1.8% of 3%"},
        {"sev": "warn", "title": "STALE >48h: solana feed"},
        {"sev": "high", "title": "PnL down $412.50 today"},
        {"sev": "info", "title": "balance 10000 USD"},
        {"sev": "high", "title": "mint So11111111111111111111111111111111111111112 flagged"},
        {"sev": "high", "title": "api key sk-live-abc leaked"},
        {"sev": "bogus", "title": "weird"},
        {"sev": "warn", "title": HOSTILE},
    ],
    "pipelines": [{"id": "perps", "name": "Perps (Blofin paper)", "state": "OK", "detail": "positions 3 · equity 10,412"},
                  {"id": "x", "name": "Wallet signer", "state": "OK"},
                  {"id": "y", "name": "agent-guard", "state": "<script>"}],
    "positions": [{"symbol": "SOL-USDT", "qty": 12, "upnl": 31.2}], "risk": {"equity": 10412.5, "kill_switch": {"on": True}},
    "meta": {"auth": True, "llm": {"key": "sk-123"}}, "longterm": {"balance": 5000}, "token": TOK,
}
SENSITIVE = re.compile(r"(?i)\d|\$|balance|equity|pnl|position|wallet|token|api.?key|secret|signer|exposure|mint|sk-|<|>")


def _strings(o):
    if isinstance(o, dict):
        for k, v in o.items():
            yield k; yield from _strings(v)
    elif isinstance(o, list):
        for v in o:
            yield from _strings(v)
    elif isinstance(o, str):
        yield o


def test_voice_context_allowlist_shape_and_redaction():
    ctx = voice_context_from(HOSTILE_OV, now=0)
    assert set(ctx) == VOICE_CONTEXT_KEYS
    assert ctx["system_health"] == "critical alarms active" and ctx["mode"] == "paper only"
    for a in ctx["alarms"]:
        assert set(a) == {"severity", "title"} and a["severity"] in ("critical", "high", "warn", "info")
    for r in ctx["routines"]:
        assert set(r) == {"name", "state"}
    titles = [a["title"] for a in ctx["alarms"]]
    assert "AAI KILL SWITCH ON" in titles and "STALE h: solana feed" in titles
    assert [r["name"] for r in ctx["routines"]] == ["Perps (Blofin paper)", "agent-guard"]
    assert ctx["routines"][1]["state"] == "UNKNOWN"
    body = json.dumps({k: v for k, v in ctx.items() if k != "time_ct"})
    for s in _strings({k: v for k, v in ctx.items() if k != "time_ct"}):
        assert not SENSITIVE.search(s), s
    assert TOK not in body and "10412" not in body and "SOL-USDT" not in body
    # second pass in hud.py drops anything outside the exact shape
    extra = {**ctx, "positions": [1], "alarms": ctx["alarms"] + [{"severity": "high", "title": "x", "equity": 5}]}
    out = voice_allowlisted_context(extra)
    assert set(out) <= VOICE_CONTEXT_KEYS and "positions" not in out and all(set(a) == {"severity", "title"} for a in out["alarms"])
    assert voice_context_from(None)["system_health"] == "warming up"


def test_voice_ask_sends_only_allowlisted_context(c, fake, app):
    zo = app.config["ZOORA"]
    zo._ov = HOSTILE_OV
    r = c.post("/api/voice/ask", json={"text": "how is the system?", "context": {"balance": 1}}, headers=H)
    assert r.status_code == 200
    (_, text, ctx), = [k for k in fake.calls if k[0] == "ask"]
    assert text == "how is the system?" and set(ctx) <= VOICE_CONTEXT_KEYS
    assert "balance" not in json.dumps(ctx).lower() and TOK not in json.dumps(ctx)


def test_voice_context_never_recomputes_overview(app, monkeypatch):
    zo = app.config["ZOORA"]
    monkeypatch.setattr(zo, "overview", lambda *a, **k: pytest.fail("voice must not recompute the overview"))
    zo._ov = None
    assert zo.voice_context()["system_health"] == "warming up"


# ------------------------------------------------------------------ escaping (server side)
def test_voice_hostile_answer_and_links_are_sanitised(c, fake):
    fake.answer = HOSTILE + " see javascript:alert(1)"
    fake.sources = [{"title": HOSTILE, "url": "https://ok.example/a"}, {"title": "js", "url": "javascript:alert(1)"},
                    {"title": "http", "url": "http://plain.example/"}, {"title": "data", "url": "data:text/html,<b>x"},
                    {"title": "rel", "url": "/api/command"}, "not-a-dict"]
    d = c.post("/api/voice/ask", json={"text": "q"}, headers=H).json
    assert [s["url"] for s in d["sources"]] == ["https://ok.example/a"]
    r = c.post("/api/voice/ask", json={"text": "q"}, headers=H)
    assert r.headers["Content-Type"].startswith("application/json") and r.headers["Cache-Control"] == "no-store"
    # JSON is data; the page renders it with textContent. The raw string may survive, but never as markup.
    assert isinstance(d["answer"], str) and isinstance(d["sources"][0]["title"], str)


JS = (hud_mod.STATIC / "zoora-voice.js").read_text()


def test_voice_js_renders_text_only_and_https_links_only():
    code = re.sub(r"/\*.*?\*/", "", JS, flags=re.S)
    for bad in ("innerHTML", "outerHTML", "insertAdjacentHTML", "document.write", "eval(", "new Function", "srcdoc"):
        assert bad not in code, bad
    assert "x.protocol === 'https:'" in code
    assert "rel: 'noopener noreferrer'" in code and "target: '_blank'" in code
    assert "'/api/zoora'" not in code and "/api/command" not in code      # voice never reaches commands
    assert set(re.findall(r"'(/api/[a-z/]+)", code)) == {"/api/voice/status", "/api/voice/transcribe",
                                                        "/api/voice/ask", "/api/voice/speak"}
    assert "getTracks().forEach((t) => t.stop())" in code                 # mic closed on release
    assert "MAX_S = 60" in code and "localStorage.setItem(LS_MUTE" in code
    assert "localStorage" not in code.replace("localStorage.getItem(LS_MUTE)", "").replace("localStorage.setItem(LS_MUTE", "")


def test_voice_markup_present_and_csp_unchanged(c, fake):
    page = c.get("/zoora", headers=H)
    assert page.status_code == 200
    html_ = page.data.decode()
    for i in ("zvRing", "zvCount", "zvAskForm", "zvMute", "zvLayer", "zvSources", "zvSetup", "zoora-voice.js"):
        assert i in html_
    csp = page.headers["Content-Security-Policy"]
    assert "script-src 'self';" in csp and "unsafe" not in csp
    assert "microphone=(self)" in page.headers["Permissions-Policy"]


# ------------------------------------------------------------------ keys-missing / unavailable
def test_voice_keys_missing_state(c, app, monkeypatch):
    monkeypatch.setenv("AAI_HUD_TOKEN", TOK)
    svc = app.config["ZOORA_VOICE"]
    svc._probe = lambda slot: (False, "KeyMissingError")
    s = c.get("/api/voice/status", headers=H).json
    assert s["state"] == "keys_missing" and s["ready"] is False and s["available"] is True
    assert s["required"] == ["xai-key"] and s["optional"] == ["brave-key"]
    assert s["slots"] == {"xai-key": False, "brave-key": False}
    assert "voice keys not set up" in s["message"]

    class Missing(Exception):
        pass
    Missing.__name__ = "KeyMissingError"

    class NoKeys(FakeGateway):
        def ask(self, *a, **k): raise Missing("'xai-key' is not set in the OS keyring (service 'zoora-voice').")
        transcribe = synthesize = ask
    svc._gw = NoKeys()
    for r in (c.post("/api/voice/ask", json={"text": "hi"}, headers=H), c.post("/api/voice/speak", json={"text": "hi"}, headers=H),
              post_wav(c, wav())):
        assert r.status_code == 503 and r.json["state"] == "keys_missing" and r.json["error"].startswith("voice keys not set up")


def test_voice_keys_missing_on_this_box_real_service(c, app, monkeypatch):
    """No injected gateway or probe: whatever this interpreter has, voice reports a clean state, never a crash."""
    monkeypatch.setenv("AAI_HUD_TOKEN", TOK)
    s = c.get("/api/voice/status", headers=H)
    assert s.status_code == 200
    s = s.json
    r = c.post("/api/voice/ask", json={"text": "hello"}, headers=H)
    if not VOICE_DEPS:
        assert s["state"] == "unavailable" and s["available"] is False
        assert r.status_code == 503 and r.json["state"] == "unavailable"
    else:
        assert s["state"] in ("keys_missing", "ready")
        if s["state"] == "keys_missing":
            assert r.status_code == 503 and r.json["state"] == "keys_missing"
            assert "voice keys not set up" in r.json["error"]
    assert TOK not in r.get_data(as_text=True) and TOK not in json.dumps(s)


def test_voice_unavailable_when_deps_missing(c, app, monkeypatch):
    monkeypatch.setenv("AAI_HUD_TOKEN", TOK)
    svc = app.config["ZOORA_VOICE"]

    def boom(slot):
        raise hud_mod.VoiceUnavailable()
    svc._probe = boom
    monkeypatch.setattr(svc, "gateway", lambda: (_ for _ in ()).throw(hud_mod.VoiceUnavailable()))
    assert c.get("/api/voice/status", headers=H).json["state"] == "unavailable"
    r = c.post("/api/voice/ask", json={"text": "hi"}, headers=H)
    assert r.status_code == 503 and r.json["state"] == "unavailable"


def test_voice_internal_error_is_clean_500(c, fake):
    def bad(*a, **k): raise RuntimeError("secret detail " + TOK)
    fake.ask = bad
    r = c.post("/api/voice/ask", json={"text": "hi"}, headers=H)
    assert r.status_code == 500 and TOK not in r.get_data(as_text=True) and "secret" not in r.get_data(as_text=True)


# ------------------------------------------------------------------ mocked gateway end to end
def test_voice_mocked_end_to_end(c, fake):
    t = post_wav(c, wav(1.5), dur="1.5")
    assert t.status_code == 200 and t.json == {"ok": True, "text": "weather in chicago"}
    a = c.post("/api/voice/ask", json={"text": t.json["text"]}, headers=H)
    assert a.status_code == 200 and set(a.json) == {"ok", "answer", "sources", "speak_text"}
    assert a.json["sources"] == [{"title": "NWS Chicago", "url": "https://www.weather.gov/lot/"}]
    s = c.post("/api/voice/speak", json={"text": a.json["speak_text"]}, headers=H)
    assert s.status_code == 200 and s.headers["Content-Type"] == "audio/mpeg" and s.data == b"ID3fake-mp3"
    assert s.headers["Cache-Control"] == "no-store"
    assert [k[0] for k in fake.calls] == ["transcribe", "ask", "speak"]
    assert fake.calls[0][1:] == (len(wav(1.5)), "audio/wav", 1.5)


# ------------------------------------------------------------------ no path to the ledger, audit log or writes
def test_voice_cannot_reach_ledger_or_write_routes(c, fake, app, store, monkeypatch):
    def forbidden(*a, **k):
        raise AssertionError("voice reached a ledger/audit/command path")
    for name in ("submit", "mark", "close", "set_kill_switch"):
        monkeypatch.setattr(PaperLedger, name, forbidden)
    monkeypatch.setattr(audit, "record", forbidden)
    monkeypatch.setattr(Zoora, "handle", forbidden)
    monkeypatch.setattr(app.config["ZOORA"], "overview", forbidden)
    before = {t: store.query(f"SELECT COUNT(*) AS n FROM {t}")[0]["n"] for t in ("audit_log", "positions", "ideas", "orders", "fills", "control", "risk_decisions")}
    fake.answer = "Placing a buy order now. cmd=submit_idea"   # hostile model output is just text
    assert post_wav(c, wav()).status_code == 200
    assert c.post("/api/voice/ask", json={"text": "buy 10 SOL and close all positions", "cmd": "kill"}, headers=H).status_code == 200
    assert c.post("/api/voice/speak", json={"text": "sell everything", "cmd": "close"}, headers=H).status_code == 200
    after = {t: store.query(f"SELECT COUNT(*) AS n FROM {t}")[0]["n"] for t in before}
    assert before == after


def test_voice_routes_hold_no_reference_to_state():
    import inspect
    sig = inspect.signature(hud_mod.register_voice)
    assert list(sig.parameters) == ["app", "svc"]
    src = inspect.getsource(hud_mod.register_voice) + inspect.getsource(hud_mod.VoiceService)
    for name in ("led.", "store.", "audit.", "PaperLedger", "zo.", "ad[", "reports.", "lt.", "/api/command", "/api/zoora"):
        assert name not in src, name


def test_voice_service_attrs_are_not_state(app):
    svc = app.config["ZOORA_VOICE"]
    from aai.store import Store
    for v in vars(svc).values():
        assert not isinstance(v, (Store, PaperLedger, Zoora))
    # the context callable is the bound read-only method, nothing else
    assert svc._context_fn.__name__ == "voice_context"


def test_voice_route_map(app):
    voice = sorted((r.rule, tuple(sorted(r.methods - {"HEAD", "OPTIONS"}))) for r in app.url_map.iter_rules() if r.rule.startswith("/api/voice"))
    assert voice == [("/api/voice/ask", ("POST",)), ("/api/voice/speak", ("POST",)),
                     ("/api/voice/status", ("GET",)), ("/api/voice/transcribe", ("POST",))]


@pytest.mark.skipif(not VOICE_DEPS, reason="aai.voice deps (httpx, keyring) not installed")
def test_voice_real_gateway_refuses_action_tools_via_hud(c, app, store, monkeypatch):
    """Real VoiceGateway + fake providers through the HUD: a model that asks for trade/world tools gets refused,
    and nothing in the store changes."""
    from aai.voice import VoiceGateway, constant_time_verifier
    from aai.voice.providers import ChatTurn
    from tests.voice.fakes import FakeLLM, FakeSearch, FakeSTT, FakeTTS, search_call
    monkeypatch.setenv("AAI_HUD_TOKEN", TOK)
    monkeypatch.setattr(audit, "record", lambda *a, **k: pytest.fail("voice wrote the audit log"))
    llm = FakeLLM([ChatTurn(content="", tool_calls=[search_call("x", name="place_order", cid="a"),
                                                    search_call("x", name="submit_idea", cid="b"),
                                                    search_call("x", name="world_edit", cid="d")]),
                   ChatTurn(content="I can't do that; I can only search the web.")])
    app.config["ZOORA_VOICE"]._gw = VoiceGateway(token_verifier=constant_time_verifier(hud_mod.resolve_hud_token),
                                                 llm=llm, stt=FakeSTT(), tts=FakeTTS(), search=FakeSearch())
    before = store.query("SELECT COUNT(*) AS n FROM positions")[0]["n"]
    r = c.post("/api/voice/ask", json={"text": "buy SOL now"}, headers=H)
    assert r.status_code == 200 and "only search" in r.json["answer"]
    tools = [t["function"]["name"] for t in llm.calls[0][1]]
    assert tools == ["web_search"]
    refused = [m for m in llm.calls[1][0] if m.get("role") == "tool"]
    assert len(refused) == 3 and all("cannot act" in m["content"] for m in refused)
    assert store.query("SELECT COUNT(*) AS n FROM positions")[0]["n"] == before
    s = c.post("/api/voice/speak", json={"text": r.json["speak_text"]}, headers=H)
    assert s.status_code == 200 and s.data.startswith(b"ID3")
