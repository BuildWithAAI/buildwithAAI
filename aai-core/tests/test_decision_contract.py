import json, os, subprocess, sys
import pytest
from aai_core.risk import decision as D
from aai_core.hub import smr_bridge, cli
from aai_core.hub import assess as A

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SMR_SCHEMA = "/workspace/solana-meme-risk/smr/schemas/risk_report.v1.json"


def test_decide_thresholds():
    r = lambda p, s="warn": D.reason("x", p, s, "d", s == "hard")
    assert D.decide([r(10), r(19)])[:2] == (29, "NORMAL")
    assert D.decide([r(30)])[1] == "REDUCED"
    assert D.decide([r(60)])[1] == "SKIP"
    s, dec, hard = D.decide([r(0, "hard")])
    assert dec == "SKIP" and s >= 60 and hard == ["x"]
    assert D.decide([r(80), r(80)])[0] == 100


def test_top_reasons_order_and_length():
    rs = [D.reason("a", 5, "warn", "x" * 400), D.reason("b", 30, "warn", "y"), D.reason("c", 0, "hard", "z", True), D.reason("d", 0, "info", "i")]
    t = D.top_reasons(rs)
    assert [x.split()[0] for x in t] == ["c", "b", "a"] and all(len(x) <= 160 for x in t)


def test_schema_is_valid_and_superset_of_smr_summary():
    import jsonschema
    s = json.load(open(D.SCHEMA_PATH))
    jsonschema.Draft202012Validator.check_schema(s)
    for k in D.ORCH_KEYS:
        assert k in s["properties"]
    if os.path.exists(SMR_SCHEMA):
        smr = json.load(open(SMR_SCHEMA))
        assert set(smr["properties"]["orchestrator_summary"]["required"]) <= set(s["required"])


SMR_SUMMARY = {"v": 1, "asset_id": "solana:9fs2XDSXyp3HNtGyciv7bvNtZGpCsTvActAWwS1Npump", "symbol": "YE", "decision": "REDUCED", "score": 55,
               "max_size_pct": 1.0, "confidence": "high", "hard_flags": [],
               "top_reasons": ["fresh_wallet_ratio +20: 10/14 traced early buyers were young", "creator_sold +15: creator sold 100%"],
               "as_of": "2026-11-02T01:06:31Z", "valid_until": "2026-11-02T01:21:31Z", "model": "smr-pumpfun-launch-risk@1.0.0+th.default",
               "line": "YE REDUCED score=55 size<=1.0% conf=high top=fresh_wallet_ratio"}


def _smr_validator():
    import jsonschema
    if not os.path.exists(SMR_SCHEMA):
        pytest.skip("smr not present")
    smr = json.load(open(SMR_SCHEMA))
    sub = dict(smr["properties"]["orchestrator_summary"]); sub["$defs"] = smr["$defs"]
    return jsonschema.Draft202012Validator(sub)


def test_meme_delegation_mocked(monkeypatch, tmp_path):
    monkeypatch.setattr(smr_bridge, "score_summary", lambda st, mint, extra=None: dict(SMR_SUMMARY))
    from aai_core.config import Settings
    st = Settings(home=str(tmp_path))
    d = A.assess("solana_meme", "9fs2XDSXyp3HNtGyciv7bvNtZGpCsTvActAWwS1Npump", bankroll=10000, settings=st)
    assert D.validate(d) == []
    assert d["decision"] == "REDUCED" and d["max_size_pct"] == 1.0 and d["suggested_size"]["risk_amount"] == 100
    assert d["source_summary"] == SMR_SUMMARY and d["asset_id"] == SMR_SUMMARY["asset_id"]
    assert [r["code"] for r in d["reasons"]][:2] == ["fresh_wallet_ratio", "creator_sold"]
    assert list(_smr_validator().iter_errors(D.orchestrator_view(d))) == []
    # account guardrail overrides smr
    book = tmp_path / "b.json"
    book.write_text(json.dumps({"account": {"equity": 9000, "day_start_equity": 10000}, "positions": []}))
    d = A.assess("solana_meme", "9fs2XDSXyp3HNtGyciv7bvNtZGpCsTvActAWwS1Npump", bankroll=10000, book_path=str(book), settings=st)
    assert d["decision"] == "SKIP" and d["max_size_pct"] == 0 and "daily_loss_limit" in d["hard_flags"]
    with pytest.raises(A.AssessError):
        A.assess("solana_meme", "x", side="short", settings=st)


def test_smr_reason_parsing():
    rs = smr_bridge.reasons_from_summary({**SMR_SUMMARY, "hard_flags": ["mint_authority"]})
    assert rs[0] == {"code": "fresh_wallet_ratio", "points": 20, "severity": "warn", "detail": "10/14 traced early buyers were young"}
    assert rs[-1]["code"] == "mint_authority" and rs[-1]["severity"] == "hard"
    with pytest.raises(smr_bridge.SmrError):
        smr_bridge.score_summary(None, "not-a-mint!")


def test_cli_contract_parse():
    p = cli.build_parser()
    a = p.parse_args(["assess", "--asset-class", "crypto_perp", "--symbol", "BTCUSDT", "--side", "short", "--entry", "1",
                      "--stop", "2", "--bankroll", "100", "--risk-pct", "2", "--book", "b.json", "--summary", "-o", "x.json"])
    assert (a.asset_class, a.symbol, a.side, a.entry, a.stop, a.bankroll, a.risk_pct, a.book, a.summary) == \
           ("crypto_perp", "BTCUSDT", "short", 1.0, 2.0, 100.0, 2.0, "b.json", True)
    h = p.parse_args(["health", "--quick"])
    assert h.quick and not h.no_smr
    with pytest.raises(SystemExit):
        p.parse_args(["assess", "--asset-class", "bonds", "--symbol", "X"])


def test_cli_bad_input_exit_code(tmp_path):
    env = {**os.environ, "AAI_HOME": str(tmp_path), "AAI_CACHE_MODE": "replay"}
    p = subprocess.run([sys.executable, "-m", "aai", "assess", "--asset-class", "forex", "--symbol", "EURO"], cwd=REPO,
                       capture_output=True, text=True, env=env, timeout=60)
    assert p.returncode == 2 and json.loads(p.stdout)["error"] == "bad_input"
