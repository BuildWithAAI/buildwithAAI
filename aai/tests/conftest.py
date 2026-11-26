import time, pytest
from aai import config
from aai.store import Store
from aai.ledger import PaperLedger


@pytest.fixture(autouse=True)
def _no_real_hud_token_file(tmp_path, monkeypatch):
    """Tests never read the box's real HUD token file; point the lookup at a path that does not exist."""
    monkeypatch.setenv("AAI_HUD_TOKEN_FILE", str(tmp_path / "no-such-hud-token"))


@pytest.fixture(autouse=True)
def _no_live_hud_record(tmp_path, monkeypatch):
    """Tests never see (or overwrite) the box's live data/hud.json: health.run's zoora_live check would otherwise
    probe the real running HUD (slow, and couples tests to the live box). A test that needs a HUD record writes one here."""
    from aai import runtime
    monkeypatch.setattr(runtime, "PATH", tmp_path / "hud.json")


@pytest.fixture
def cfg(tmp_path):
    return config.load(overrides={"store": {"path": str(tmp_path / "t.db")}})


@pytest.fixture
def store(cfg):
    return Store(cfg["store"]["path"])


@pytest.fixture
def ledger(store, cfg):
    return PaperLedger(store, cfg)


def meme_signal(store, mint, rec, score=10, age=0):
    payload = {"mint": mint, "reasons": [f"test {rec}"], "recommendation": rec}
    import json
    cur = store.execute("INSERT INTO signals(ts,sector,source,symbol,kind,score,recommendation,payload) VALUES(?,?,?,?,?,?,?,?)",
                        (time.time() - age, "solana_meme", "test", mint, "rug_risk_score", score, rec, json.dumps(payload)))
    return cur.lastrowid


@pytest.fixture(autouse=True)
def _no_live_shotdiff_record(tmp_path, monkeypatch):
    """Tests never read (or write) the box's live data/shotdiff_last.json or the blessed baselines."""
    from aai import shotcheck
    monkeypatch.setattr(shotcheck, "RESULT_PATH", tmp_path / "shotdiff_last.json")
    monkeypatch.setattr(shotcheck, "BASELINE_DIR", tmp_path / "baseline")


@pytest.fixture(autouse=True)
def _no_live_watchlist_file(tmp_path, monkeypatch):
    """Tests never read (or write) the owner's data/watchlist.json; config.load sees no owner file unless a test writes one."""
    monkeypatch.setenv("AAI_WATCHLIST", str(tmp_path / "no-such-watchlist.json"))
