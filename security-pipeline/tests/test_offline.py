"""Offline unit tests (no network)."""
from datetime import timedelta
import json
import pytest

from common import config, db
from common.util import now_utc, iso, parse_duration
from intel import normalize as N
from intel.ingest import finalize
from scoring import score as S
from phishing.check import check_domain, levenshtein, skeleton
from wallets import check as W

EXP = config.exposure()


def test_parse_duration():
    assert parse_duration("24h") == timedelta(hours=24)
    assert parse_duration("7d") == timedelta(days=7)


@pytest.mark.parametrize("text,cat", [
    ("Hackers drain $5M from DeFi lending protocol via oracle manipulation", "defi_exploit"),
    ("Wallet drainer phishing kit steals $2M from users", "drainer_phishing"),
    ("Malicious npm package targets crypto developers", "supply_chain"),
    ("Exchange hot wallet hacked, $40M stolen", "exchange_hack"),
])
def test_classify(text, cat):
    assert N.classify(text) == cat


def test_loss_extraction_requires_loss_context():
    assert N.extract_loss("Protocol with $136.3 million TVL patches Linux flaw") is None
    assert N.extract_loss("Attacker stole $2.6 million in an exploit") == pytest.approx(2.6e6)


def test_entity_matcher_exclusions():
    m = N.EntityMatcher(EXP, [])
    assert m.match("Phantom Hacker scam targets seniors", "") != "Phantom"
    assert m.match("Bybit warns users of fake support accounts", "") == "Bybit"


def test_cex_maps_to_exchange_hack():
    m = N.EntityMatcher(EXP, [])
    it = finalize({"title": "Bybit exploit drains hot wallet", "summary": "", "url": "https://x.test/a",
                   "time_utc": iso(now_utc()), "source": "t", "source_type": "news"}, m)
    assert it["category"] == "exchange_hack"


def test_tiers():
    assert S.tier(80, 1.0, "exchange_hack", 1, None) == "CRITICAL"
    assert S.tier(80, 1.0, "exchange_hack", 1, "mitigated") != "CRITICAL"
    assert S.tier(30, 0.0, "regulatory", 1, None) == "INFO"
    assert S.tier(90, 1.0, "exchange_hack", 1, "retrospective") in ("WATCH", "INFO")


def test_lookalikes_offline():
    assert levenshtein("bybit", "bybitt") == 1
    assert skeleton("raydiurn") == skeleton("raydium")
    r = check_domain("https://bybit.com/en/", EXP, online=False)
    assert r["risk_score"] == 0
    r = check_domain("bybit-airdrop-claim.xyz", EXP, online=False)
    assert r["risk_score"] >= 35


def test_wallets_idle_with_zero_addresses():
    exp = dict(EXP, wallets={"evm": [], "solana": []})
    r = W.run(exp)
    assert r["addresses_configured"] == 0 and r["findings"] == [] and "idle" in r["note"]


def test_secret_guard_refuses_private_key_and_seed():
    with pytest.raises(SystemExit):
        W._guard("0x" + "ab" * 32)
    with pytest.raises(SystemExit):
        W._guard("abandon " * 11 + "about")


def test_db_upsert_dedup(tmp_path):
    con = db.connect(tmp_path / "t.db")
    item = {"id": "x1", "time_utc": iso(now_utc()), "source": "a", "source_type": "news", "title": "t", "url": "u",
            "summary": "", "chain": None, "entity": "E", "entity_slug": "e", "category": "defi_exploit",
            "loss_usd": 1e6, "status": None}
    assert db.upsert(con, dict(item), iso(now_utc())) is True
    assert db.upsert(con, dict(item, source="b", loss_usd=2e6), iso(now_utc())) is False
    row = con.execute("SELECT sources, loss_usd FROM items WHERE id='x1'").fetchone()
    assert set(json.loads(row["sources"])) == {"a", "b"} and row["loss_usd"] == 2e6
