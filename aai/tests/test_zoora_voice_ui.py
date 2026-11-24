"""Zoora voice in a real headless browser (Playwright + system Chrome, fake mic, mocked gateway).

Checks the things only a browser can: hostile answers and titles never become markup, javascript:/http: links are
never rendered as links, push-to-talk opens the fake mic only while the orb is held and shows the countdown, pop-ups
dismiss with Esc or a click, and the keys-missing state. Skips when Playwright or Chrome is not installed."""
import json, shutil, threading
import pytest
from aai import hud as hud_mod

pw = pytest.importorskip("playwright.sync_api")
CHROME = shutil.which("google-chrome") or shutil.which("chromium")
if not CHROME:
    pytest.skip("no Chrome for Playwright", allow_module_level=True)

from test_hud_voice import TOK, HOSTILE, FakeGateway, DummyAdapter  # noqa: E402
from aai.adapters.registry import build  # noqa: E402
from aai.hud import create_app  # noqa: E402


def wait_text(pg, sel, text, timeout=10000):
    """Locator-based wait (the HUD's CSP forbids eval, so no wait_for_function strings)."""
    pg.locator(sel).filter(has_text=text).wait_for(timeout=timeout)


@pytest.fixture
def served(cfg, store, monkeypatch):
    from werkzeug.serving import make_server
    monkeypatch.setenv("AAI_HUD_TOKEN", TOK)
    ad = build(cfg, store)
    ad["blofin"] = DummyAdapter(); ad["solana_meme"].health = lambda quick=True: {"ok": True}
    app = create_app(cfg, store, ad)
    g = FakeGateway(answer=HOSTILE + " The answer is 42.",
                    sources=[{"title": HOSTILE, "url": "https://example.org/a?b=1"},
                             {"title": "JS link", "url": "javascript:alert(1)"},
                             {"title": "Plain http", "url": "http://insecure.example/"}])
    svc = app.config["ZOORA_VOICE"]; svc._gw = g; svc._probe = lambda slot: (True, None)
    srv = make_server("127.0.0.1", 0, app, threaded=True)
    port = srv.server_port
    monkeypatch.setattr(hud_mod, "ALLOWED_HOSTS", hud_mod.ALLOWED_HOSTS | {f"127.0.0.1:{port}"})
    t = threading.Thread(target=srv.serve_forever, daemon=True); t.start()
    yield f"http://127.0.0.1:{port}", g, svc
    srv.shutdown()


@pytest.fixture
def page(served):
    base, g, svc = served
    with pw.sync_playwright() as p:
        b = p.chromium.launch(executable_path=CHROME, headless=True,
                              args=["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--no-sandbox"])
        ctx = b.new_context(viewport={"width": 1440, "height": 900}, permissions=["microphone"], service_workers="block")
        pg = ctx.new_page()
        errors = []
        pg.on("pageerror", lambda e: errors.append(str(e)))
        pg.on("dialog", lambda d: (errors.append("dialog:" + d.message), d.dismiss()))
        pg.goto(f"{base}/zoora?token={TOK}")
        pg.goto(f"{base}/zoora?noboot=1&nosse=1&rm=1")
        yield pg, g, svc, errors
        b.close()


def test_ui_hostile_answer_is_text_and_only_https_links(page):
    pg, g, _, errors = page
    wait_text(pg, "#zvStatusText", "READY")
    # The server already strips markup (guard.clean); bypass it so the browser itself faces the raw hostile JSON.
    raw = {"ok": True, "answer": HOSTILE + " The answer is 42.", "speak_text": "",
           "sources": [{"title": HOSTILE, "url": "https://example.org/a?b=1"},
                       {"title": "JS link", "url": "javascript:alert(1)"},
                       {"title": "Plain http", "url": "http://insecure.example/"},
                       {"title": "Data", "url": "data:text/html,<script>alert(1)</script>"}]}
    pg.route("**/api/voice/ask", lambda route: route.fulfill(status=200, content_type="application/json", body=json.dumps(raw)))
    pg.fill("#zvAskInput", "who are you?")
    pg.press("#zvAskInput", "Enter")
    pg.wait_for_selector("#zvAnswer:not([hidden])")
    wait_text(pg, "#zvA", "42")
    assert HOSTILE in pg.text_content("#zvA")
    assert pg.locator("#zvLayer img").count() == 0 and pg.locator("img[src='x']").count() == 0
    links = pg.locator("#zvSrcList a")
    assert links.count() == 1
    assert links.first.get_attribute("href") == "https://example.org/a?b=1"
    assert links.first.get_attribute("rel") == "noopener noreferrer" and links.first.get_attribute("target") == "_blank"
    assert HOSTILE in links.first.text_content()
    assert pg.locator("#zvSrcList .blocked").count() == 3
    assert not any(a.get_attribute("href").startswith(("javascript", "http:")) for a in pg.locator("a[href]").all() if a.get_attribute("href"))
    pg.keyboard.press("Escape")
    pg.wait_for_selector("#zvLayer", state="hidden")
    assert not errors, errors


def test_ui_click_dismiss_and_mute_toggle(page):
    pg, _, _, errors = page
    wait_text(pg, "#zvStatusText", "READY")
    pg.fill("#zvAskInput", "hi"); pg.press("#zvAskInput", "Enter")
    pg.wait_for_selector("#zvAnswer:not([hidden])")
    pg.mouse.click(5, 5)                      # backdrop click
    pg.wait_for_selector("#zvLayer", state="hidden")
    pg.click("#zvMute")
    assert pg.get_attribute("#zvMute", "aria-pressed") == "true"
    assert pg.evaluate("localStorage.getItem('zoora.voiceSfxMuted')") == "1"
    assert not errors, errors


def test_ui_push_to_talk_fake_mic(page):
    pg, g, _, errors = page
    wait_text(pg, "#zvStatusText", "READY")
    box = pg.locator("#p-core .core-stage").bounding_box()
    pg.mouse.move(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
    pg.mouse.down()
    pg.wait_for_selector("#zvRing:not([hidden])")
    pg.wait_for_selector("#p-core[data-mic='open']", timeout=15000)
    assert pg.text_content("#zvRecLabel") == "REC · MIC OPEN"
    pg.wait_for_selector("#p-core[data-heard='1']", timeout=15000)   # first audio frames arrived
    pg.wait_for_timeout(1200)
    assert pg.text_content("#coreState") == "LISTENING"
    count = pg.text_content("#zvCount")
    assert count.startswith("0:5") or count == "0:60"
    pg.mouse.up()
    pg.wait_for_selector("#zvRing", state="hidden")
    assert pg.get_attribute("#p-core", "data-mic") == "closed"      # mic track stopped on release
    try:
        pg.wait_for_selector("#zvAnswer:not([hidden])", timeout=10000)
    except Exception:
        raise AssertionError("no answer; note=%r calls=%r" % (pg.text_content("#zvNote"), g.calls))
    tr = [c for c in g.calls if c[0] == "transcribe"]
    assert len(tr) == 1 and tr[0][2] == "audio/wav" and 0.4 <= tr[0][3] <= 3.0 and tr[0][1] > 44 + 16000
    assert not errors, errors


def test_ui_space_push_to_talk(page):
    pg, g, _, errors = page
    wait_text(pg, "#zvStatusText", "READY")
    pg.locator("body").click(position={"x": 3, "y": 3})
    pg.keyboard.down("Space")
    pg.wait_for_selector("#p-core[data-heard='1']", timeout=15000)
    pg.wait_for_timeout(900)
    pg.keyboard.up("Space")
    pg.wait_for_selector("#zvAnswer:not([hidden])")
    assert any(c[0] == "transcribe" for c in g.calls)
    assert not errors, errors


def test_ui_keys_missing_state(page):
    pg, g, svc, errors = page
    svc._probe = lambda slot: (False, "KeyringBackendError")
    pg.reload()
    wait_text(pg, "#zvStatusText", "NOT SET UP")
    box = pg.locator("#p-core .core-stage").bounding_box()
    pg.mouse.click(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
    pg.wait_for_selector("#zvSetup:not([hidden])")
    assert "xai-key" in pg.text_content("#zvSlots") and "MISSING" in pg.text_content("#zvSlots")
    assert pg.locator("#zvRing").is_hidden()
    assert not [c for c in g.calls if c[0] == "transcribe"]
    assert not errors, errors


def test_ui_server_path_strips_markup(page):
    pg, g, _, errors = page
    wait_text(pg, "#zvStatusText", "READY")
    pg.fill("#zvAskInput", "who are you?"); pg.press("#zvAskInput", "Enter")
    wait_text(pg, "#zvA", "42")
    assert "<" not in pg.text_content("#zvA") and pg.locator("#zvLayer img").count() == 0
    assert pg.locator("#zvSrcList a").count() == 1          # javascript: and http: were dropped server-side
    assert any(c[:2] == ("ask", "who are you?") for c in g.calls)
    assert not errors, errors


def test_ui_mobile_popups_fit_the_screen(served):
    base, g, _ = served
    with pw.sync_playwright() as p:
        b = p.chromium.launch(executable_path=CHROME, headless=True, args=["--no-sandbox"])
        ctx = b.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True, service_workers="block")
        pg = ctx.new_page()
        pg.goto(f"{base}/zoora?token={TOK}"); pg.goto(f"{base}/zoora?noboot=1&nosse=1&rm=1")
        wait_text(pg, "#zvStatusText", "READY")
        pg.fill("#zvAskInput", "weather?"); pg.press("#zvAskInput", "Enter")
        pg.wait_for_selector("#zvAnswer:not([hidden])")
        vw = pg.evaluate("visualViewport.width")
        for sel in ("#zvAnswer", "#zvSources"):
            r = pg.locator(sel).bounding_box()
            assert r["x"] >= 0 and r["x"] + r["width"] <= vw + 1, (sel, r, vw)
        pg.locator("#zvAnswer .zv-close").tap()
        pg.wait_for_selector("#zvLayer", state="hidden")
        b.close()
