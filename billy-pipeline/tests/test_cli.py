"""End-to-end CLI run on a temp project with synthetic market data (no network)."""
import json
from pathlib import Path

import numpy as np
import yaml

from billy.cli import main
from billy.market import KlineCache
from billy.market.binance import INTERVAL_MS

ROOT = Path(__file__).resolve().parents[1]


def _seed_cache(db, assets, start_ms, n_hours, rng):
    c = KlineCache(db)
    for a in assets:
        px = 100 * np.cumprod(1 + rng.normal(0, 0.004, n_hours))
        h = INTERVAL_MS["1h"]
        rows = [[start_ms + i * h, px[i - 1] if i else px[0], max(px[i], px[i - 1] if i else px[0]) * 1.002,
                 min(px[i], px[i - 1] if i else px[0]) * 0.998, px[i], 1.0, start_ms + (i + 1) * h - 1]
                for i in range(n_hours)]
        c.upsert(f"{a}USDT", "1h", rows)
        d = INTERVAL_MS["1d"]
        drows = []
        for k in range(n_hours // 24):
            seg = px[k * 24:(k + 1) * 24]
            drows.append([start_ms + k * d, seg[0], seg.max(), seg.min(), seg[-1], 1.0, start_ms + (k + 1) * d - 1])
        c.upsert(f"{a}USDT", "1d", drows)


def test_cli_end_to_end(tmp_path, real_posts):
    cfg = yaml.safe_load((ROOT / "config" / "default.yaml").read_text())
    cfg["assets"] = ["BTC", "ETH", "LINK"]
    cfg["paths"]["root"] = str(tmp_path)
    cfg["paths"]["seed_posts"] = [str(ROOT / "tests" / "fixtures" / "real_posts.jsonl")]
    cfg["paths"]["events_file"] = str(ROOT / "config" / "events.yaml")
    cfg["backtest"]["start"] = "2026-09-01"
    cfg["backtest"]["grid"] = {"n_hold": [1, 2]}
    p = tmp_path / "cfg.yaml"
    p.write_text(yaml.safe_dump(cfg))
    _seed_cache(tmp_path / "data/cache/market.sqlite", cfg["assets"], 1788220800000, 24 * 70, np.random.default_rng(3))
    args = ["--config", str(p), "--log-level", "WARNING"]
    assert main(args + ["ingest"]) == 0
    assert main(args + ["parse"]) == 0
    cov = json.loads((tmp_path / "reports/parse_coverage.json").read_text())
    assert cov["outlooks"] == 4
    assert main(args + ["data", "--offline"]) == 0
    assert main(args + ["backtest"]) == 0
    m = json.loads((tmp_path / "reports/artifacts/metrics.json").read_text())
    assert "full" in m and m["funnel"]["outlooks"] == 4
    assert main(args + ["report"]) == 0
    assert (tmp_path / "reports/backtest_report.md").exists() and (tmp_path / "reports/equity_curve.png").exists()
    assert main(args + ["signals", "--now", "2026-10-24T03:00:00+00:00", "--paper"]) == 0
    payload = json.loads((tmp_path / "reports/signals_today.json").read_text())
    assert payload["equity_example"] == 10000
