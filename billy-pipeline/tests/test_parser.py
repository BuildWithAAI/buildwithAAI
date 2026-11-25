"""Parser tests on the synthetic fixture at tests/fixtures/real_posts.jsonl."""
import pytest

from billy.parse import coverage_report, parse_post, parse_posts
from billy.parse.parser import detect_asset, parse_close_label


def test_link_short_breakdown(real_posts):
    s = parse_post(real_posts["1001"])
    assert (s.asset, s.close_label, s.bias, s.parse_status) == ("LINK", "indecisive", 0, "actionable")
    assert s.direction == "short" and s.condition_type == "breakout"
    assert s.trigger == 12.0 and s.targets == [11.4] and s.invalidation == 12.7
    assert s.flags["explicit_trade"] and s.flags["has_target"]
    assert s.url.endswith("1001")


def test_eth_two_sided_inherits_level(real_posts):
    s = parse_post(real_posts["1002"])
    sides = [(x.side, x.cond, x.level) for x in s.scenarios]
    assert sides == [("long", "above", 2380.0), ("short", "below", 2380.0)]
    assert s.direction == "long" and s.targets == [2580.0]
    assert s.flags["two_sided"] and s.flags["pair_dependent"]


def test_eth_explicit_long_above_resistance(real_posts):
    s = parse_post(real_posts["1003"])
    assert s.direction == "long" and s.trigger == 2580.0 and s.scenarios[0].explicit
    assert s.invalidation == 2400.0  # "Below, $2,400" picks its own level, not the previous one


def test_retest_short_xrp(real_posts):
    s = parse_post(real_posts["1004"])
    assert s.condition_type == "retest" and s.direction == "short"
    assert s.trigger == 1.44 and s.targets == [1.32]
    assert s.flags["waits_for_confirmation"]


def test_retest_short_ltc_with_upside_alternative(real_posts):
    s = parse_post(real_posts["1005"])
    assert s.condition_type == "retest" and s.direction == "short" and s.trigger == 66.2
    assert s.targets == [61.5] and s.invalidation == 71.5


@pytest.mark.parametrize("pid,label,bias", [("1006", "strongly_bearish", -2),
                                            ("1007", "bearish", -1)])
def test_wait_posts_are_no_trade(real_posts, pid, label, bias):
    s = parse_post(real_posts[pid])
    assert s.parse_status == "no_trade" and s.close_label == label and s.bias == bias
    assert s.direction is None and s.trigger is None


def test_non_outlook_and_non_crypto(real_posts):
    assert parse_post(real_posts["1008"]).parse_status == "not_outlook"
    sigs = parse_posts(real_posts.values(), ["BTC", "ETH", "XRP", "LTC", "LINK"])
    assert all(s.asset in {"BTC", "ETH", "XRP", "LTC", "LINK"} for s in sigs)
    assert "1009" not in {s.post_id for s in sigs}  # GBPUSD dropped
    assert [s.post_ts for s in sigs] == sorted(s.post_ts for s in sigs)


@pytest.mark.parametrize("text,label,bias", [
    ("$BTC closed strongly bullish. x", "strongly_bullish", 2),
    ("$BTC closed slightly bearish. x", "slightly_bearish", -1),
    ("$ETH closed indecisively. x", "indecisive", 0),
    ("$XRP printed a doji. x", "doji", 0),
])
def test_close_labels(text, label, bias):
    assert parse_close_label(text) == (label, bias)


def test_detect_asset():
    assert detect_asset("BTC Daily Technical Outlook:\n$BTC closed") == "BTC"
    assert detect_asset("hello world") is None


def test_coverage(real_posts):
    cov = coverage_report(parse_posts(real_posts.values()))
    assert cov["outlooks"] == 7 and cov["asset_detected_pct"] == 100.0
    assert 0 < cov["actionable_pct"] <= 100
    assert coverage_report([]) == {"outlooks": 0}
