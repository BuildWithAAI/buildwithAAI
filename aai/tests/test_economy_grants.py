"""ECONOMY.md E2: granted-stage registry + sign-off log (aai/grants.py). Tmp DBs only; never data/aai.db."""
import sqlite3, time
import pytest
from aai import audit, economy as ec, grants
from aai.cli import main as cli_main
from test_economy import _close
from test_zoora import FAKE_EXT, ad, app, client, say  # noqa: F401  (pytest fixtures)


def _momo(store, n=40, win=20.0, loss=-10.0):
    t0 = time.time() - (n + 10) * 86400
    for i in range(n):
        _close(store, "perps", "momo", win if i % 2 else loss, 20.0, t0 + i * 86400)


def _sc(store, cfg):
    return ec.scorecard(store, cfg, include_arena=False)


def _by(sc):
    return {r["id"]: r for r in sc["strategies"]}


def test_default_is_ungranted(store, cfg):
    _momo(store)
    r = _by(_sc(store, cfg))["aai:perps/momo"]
    assert r["ladder"]["stage"] == 2
    assert r["grant"] == {**r["grant"], "granted_stage": 0, "effective_stage": 0, "status": "eligible_above_grant"}
    p = ec.panel(_sc(store, cfg))
    assert p["panel"][0]["granted_stage"] == 0 and p["panel"][0]["grant_status"] == "eligible_above_grant"
    assert p["summary"]["granted"] == 0 and p["real_money_allowed"] is False


def test_grant_requires_human_confirm_quote(store, cfg):
    _momo(store)
    kw = dict(by="Zoorped", quote="ok take momo to stage 1 on paper", confirm="GRANT")
    for bad, msg in [({"confirm": "yes"}, "confirm"), ({"quote": "  "}, "quote"), ({"by": ""}, "--by")]:
        with pytest.raises(grants.GrantError, match=msg):
            grants.grant(store, cfg, "aai:perps/momo", 1, **{**kw, **bad})
    for actor in ("zoora", "hud", "llm", "agent:perps"):
        with pytest.raises(grants.GrantError, match="only a human CLI"):
            grants.grant(store, cfg, "aai:perps/momo", 1, actor=actor, **kw)
    with pytest.raises(grants.GrantError, match="only eligible for stage 2"):
        grants.grant(store, cfg, "aai:perps/momo", 3, **kw)
    with pytest.raises(grants.GrantError, match="unknown strategy"):
        grants.grant(store, cfg, "aai:perps/nope", 1, **kw)
    assert grants.history(store) == []
    res = grants.grant(store, cfg, "aai:perps/momo", 1, **kw)
    assert res["ok"] and res["action"] == "grant" and res["real_money_allowed"] is False and res["prev_stage"] == 0
    r = _by(_sc(store, cfg))["aai:perps/momo"]
    assert r["grant"]["granted_stage"] == 1 and r["grant"]["effective_stage"] == 1 and r["grant"]["granted_by"] == "Zoorped"
    ev = [e["event"] for e in audit.tail(store, 5)]
    assert "economy_stage_grant" in ev and audit.verify(store)["ok"]


def test_registry_is_append_only(store, cfg):
    _momo(store)
    grants.grant(store, cfg, "aai:perps/momo", 2, by="Zoorped", quote="stage 2 paper", confirm="GRANT")
    with pytest.raises(sqlite3.DatabaseError, match="append-only"):
        store.execute("UPDATE economy_stage_grants SET stage=3")
    with pytest.raises(sqlite3.DatabaseError, match="append-only"):
        store.execute("DELETE FROM economy_stage_grants")
    with pytest.raises(sqlite3.IntegrityError):   # a grant row without a quote is rejected by the DB itself
        store.execute("INSERT INTO economy_stage_grants(ts,strategy,stage,action,granted_by,quote) VALUES(1,'x',1,'grant','a','')")
    grants.grant(store, cfg, "aai:perps/momo", 0, by="Zoorped", quote="pull it back", confirm="GRANT")
    h = grants.history(store, "aai:perps/momo")
    assert [x["action"] for x in h] == ["revoke", "grant"] and h[0]["prev_stage"] == 2
    assert _by(_sc(store, cfg))["aai:perps/momo"]["grant"]["granted_stage"] == 0


def test_effective_capped_then_reconcile_logs_demotion(store, cfg):
    _momo(store)
    grants.grant(store, cfg, "aai:perps/momo", 2, by="Zoorped", quote="stage 2 paper", confirm="GRANT")
    t = time.time()
    for i in range(25):   # heavy recent losses: drawdown + last-20 expectancy collapse the ladder stage
        _close(store, "perps", "momo", -60.0, 20.0, t + i)
    r = _by(_sc(store, cfg))["aai:perps/momo"]
    el = r["ladder"]["stage"]
    assert el < 2 and r["grant"]["status"] == "pending_demotion" and r["grant"]["effective_stage"] == el
    assert grants.current(store)["aai:perps/momo"]["stage"] == 2     # a read never writes
    res = grants.reconcile(store, cfg, sc=_sc(store, cfg))
    assert res["demotions"] and res["demotions"][0]["from"] == 2 and res["demotions"][0]["to"] == el
    last = grants.current(store)["aai:perps/momo"]
    assert last["action"] == "auto_demotion" and last["stage"] == el and last["granted_by"] == "economy-reconcile"
    assert grants.reconcile(store, cfg)["demotions"] == []            # idempotent
    assert "economy_stage_auto_demotion" in [e["event"] for e in audit.tail(store, 5)]


def test_killed_only_stage0(store, cfg):
    _momo(store)
    store.set_control("kill_switch", {"on": True, "reason": "test"})
    with pytest.raises(grants.GrantError, match="killed"):
        grants.grant(store, cfg, "aai:perps/momo", 1, by="Zoorped", quote="x", confirm="GRANT")


def test_hud_and_voice_cannot_grant(app, client, store):
    _momo(store)
    code, d = say(client, "grant momo stage 2 on the ladder")
    assert code == 403 and d["focus"] == "economy"
    code, d = say(client, "promote the momo strategy")
    assert code == 403
    assert grants.history(store) == []
    for path in ("/api/economy", "/api/economy/grant", "/api/zoora/grant"):
        assert client.post(path, json={"strategy": "aai:perps/momo", "stage": 2}).status_code in (403, 404, 405)
    assert grants.history(store) == []
    d = client.get("/api/economy").json
    row = [r for r in d["panel"] if r["id"] == "aai:perps/momo"][0]
    assert row["granted_stage"] == 0 and row["grant_status"] == "eligible_above_grant" and "granted" in d["summary"]
    code, d = say(client, "economy ladder")
    assert code == 200 and "granted" in d["reply"].lower()


def test_cli_grant(cfg, store, monkeypatch, capsys, tmp_path):
    _momo(store)
    monkeypatch.setenv("AAI_WORKSPACE", str(tmp_path))   # no real perps arena in the CLI scorecard
    monkeypatch.setattr("aai.config.load", lambda *a, **k: cfg)
    with pytest.raises(SystemExit, match="refused"):
        cli_main(["economy-grant", "aai:perps/momo", "1", "--by", "Zoorped", "--quote", "go", "--confirm", "nope"])
    cli_main(["economy-grant", "aai:perps/momo", "1", "--by", "Zoorped", "--quote", "go stage 1 paper", "--confirm", "GRANT"])
    assert '"action": "grant"' in capsys.readouterr().out
    cli_main(["economy-grants"])
    assert "go stage 1 paper" in capsys.readouterr().out


def test_static_shows_grant_chip():
    from pathlib import Path
    js = (Path(__file__).resolve().parents[1] / "aai" / "static" / "zoora" / "zoora.js").read_text()
    assert "granted_stage" in js and "GRANTED" in js and "innerHTML" not in js.split("economy ladder (GET /api/economy")[1].split("/* ---")[0]
