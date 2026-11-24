"""Single-use login tickets: headless Chrome opens the locked HUD without the token on a command line."""
import json, time
import pytest
from aai import hud as hud_mod
from aai.hud import TicketBook, create_app, resolve_hud_token

TOK = "s3cret-ticket-test"
H = {"Host": "127.0.0.1:57025"}


@pytest.fixture
def locked(cfg, store, monkeypatch):
    monkeypatch.setenv("AAI_HUD_TOKEN", TOK)
    app = create_app(cfg, store)
    return app, app.test_client()


def mint(c, tok=TOK):
    return c.post("/api/zoora/auth/ticket", headers={**H, "X-AAI-Token": tok}, json={})


def test_mint_requires_token(locked):
    _, c = locked
    assert c.post("/api/zoora/auth/ticket", headers=H, json={}).status_code == 401
    assert mint(c, "wrong").status_code == 401
    r = mint(c)
    assert r.status_code == 200
    j = r.get_json()
    assert j["single_use"] is True and len(j["ticket"]) >= 24 and j["ttl_sec"] == 60


def test_ticket_logs_in_once_and_keeps_query(locked):
    _, c = locked
    t = mint(c).get_json()["ticket"]
    r = c.get(f"/zoora?nosse=1&ticket={t}&hc=1", headers=H)
    assert r.status_code == 302
    loc = r.headers["Location"]
    assert "ticket" not in loc and "nosse=1" in loc and "hc=1" in loc
    sc = r.headers.get("Set-Cookie", "")
    assert "aai_token=" in sc and "HttpOnly" in sc and "SameSite=Strict" in sc
    assert c.get("/zoora", headers=H).status_code == 200  # cookie now authorises the page
    # second use of the same ticket from a fresh client: burned
    c2 = locked[0].test_client()
    r2 = c2.get(f"/zoora?ticket={t}", headers=H)
    assert r2.status_code == 302 and r2.headers["Location"].endswith("/zoora/login")


def test_ticket_cannot_open_api(locked):
    _, c = locked
    t = mint(c).get_json()["ticket"]
    c2 = locked[0].test_client()
    assert c2.get(f"/api/zoora/overview?ticket={t}", headers=H).status_code == 401


def test_bogus_and_expired_tickets_refused(locked, monkeypatch):
    app, c = locked
    assert c.get("/zoora?ticket=nope", headers=H).headers["Location"].endswith("/zoora/login")
    t = mint(c).get_json()["ticket"]
    book = app.config["AAI_TICKETS"]
    book._t = {k: time.time() - 1 for k in book._t}  # age every pending ticket past its expiry
    c2 = app.test_client()
    assert c2.get(f"/zoora?ticket={t}", headers=H).headers["Location"].endswith("/zoora/login")


def test_ticket_mint_and_use_are_audited(locked, store):
    _, c = locked
    t = mint(c).get_json()["ticket"]
    c.get(f"/zoora?ticket={t}", headers=H)
    ev = [r["event"] for r in store.query("SELECT event FROM audit_log WHERE event LIKE 'hud_ticket%'")]
    assert "hud_ticket_mint" in ev and "hud_ticket_login" in ev
    # the ticket itself is never written to the audit log
    rows = json.dumps([dict(r) for r in store.query("SELECT * FROM audit_log WHERE event LIKE 'hud_ticket%'")])
    assert t not in rows and TOK not in rows


def test_unlocked_hud_mints_nothing(cfg, store, monkeypatch):
    monkeypatch.delenv("AAI_HUD_TOKEN", raising=False)
    c = create_app(cfg, store).test_client()
    assert c.post("/api/zoora/auth/ticket", headers=H, json={}).status_code == 409


def test_ticketbook_is_bounded_and_hashed():
    b = TicketBook(ttl=60, cap=4)
    ts = [b.mint() for _ in range(10)]
    assert b.pending() == 4
    assert not any(t in b._t for t in ts)  # only hashes are stored
    assert b.redeem(ts[-1]) and not b.redeem(ts[-1])
    assert not b.redeem(ts[0])  # evicted
    assert not b.redeem("x" * 100)


def test_login_form_has_username_field(locked):
    _, c = locked
    body = c.get("/zoora/login", headers=H).get_data(as_text=True)
    assert 'autocomplete=username' in body and 'autocomplete=current-password' in body


def test_resolve_token_env_then_file(tmp_path, monkeypatch):
    monkeypatch.delenv("AAI_HUD_TOKEN", raising=False)
    assert resolve_hud_token() == ""  # conftest points the file at a missing path
    f = tmp_path / "tok"
    f.write_text("from-file\n")
    monkeypatch.setenv("AAI_HUD_TOKEN_FILE", str(f))
    assert resolve_hud_token() == "from-file"
    monkeypatch.setenv("AAI_HUD_TOKEN", "from-env")
    assert resolve_hud_token() == "from-env"


def test_cli_hud_ticket_and_hud_branch(cfg, monkeypatch, capsys):
    """Regression: a local import inside cli.main once shadowed `runtime` and crashed `aai hud` on start."""
    from aai import cli, runtime
    monkeypatch.setattr(runtime, "read_hud", lambda: None)
    with pytest.raises(SystemExit) as e:
        cli.main(["hud-ticket", "/zoora"])
    assert "not running" in str(e.value)
    with pytest.raises(SystemExit):
        cli.main(["hud-ticket", "//evil.example/zoora"])
    wrote = {}

    class FakeApp:
        def run(self, **kw): wrote["run"] = kw
    monkeypatch.setattr(cli.config, "load", lambda *a, **k: cfg)  # temp DB only, never data/aai.db
    monkeypatch.setattr(hud_mod, "create_app", lambda *a, **k: FakeApp())
    monkeypatch.setattr(runtime, "write_hud", lambda h, p: wrote.setdefault("hud", (h, p)))
    cli.main(["hud", "--port", "57999"])
    assert wrote["hud"] == ("127.0.0.1", 57999) and wrote["run"]["host"] == "127.0.0.1"


def test_manifest_link_sends_session_cookie():
    """Browsers fetch the PWA manifest without cookies unless crossorigin=use-credentials; with the HUD
    locked that fetch got the login page (console 'Manifest: Syntax error', PWA install broken)."""
    from aai.hud import STATIC
    html = (STATIC / "index.html").read_text()
    assert 'rel="manifest"' in html and 'crossorigin="use-credentials"' in html
