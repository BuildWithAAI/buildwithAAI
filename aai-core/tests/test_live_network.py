"""Live smoke tests against the public endpoints. Deselected in quick runs: pytest -m 'not network'."""
import pytest
from aai_core.config import Settings
from aai_core.data.registry import Market

pytestmark = pytest.mark.network


@pytest.fixture(scope="module")
def market(tmp_path_factory):
    st = Settings(home=str(tmp_path_factory.mktemp("live")))
    return Market(st)


@pytest.mark.parametrize("ac,sym,iv", [("crypto_perp", "BTCUSDT", "1h"), ("forex", "EURUSD", "1h"), ("equity", "SPY", "1d")])
def test_live_feed(market, ac, sym, iv):
    f = market.feed(ac)
    s = f.candles(sym, iv, 50)
    q = f.quote(sym)
    assert len(s.candles) >= 30 and q.last and q.last > 0
