"""End-to-end smoke test of the research pipeline on synthetic data (no network)."""

import json
from pathlib import Path

import yaml

from perps.data.store import ParquetStore
from perps.evaluation.research import run_research

from .conftest import random_walk

ROOT = Path(__file__).resolve().parents[1]


def test_research_pipeline_end_to_end(settings, unit_spec):
    strategies = yaml.safe_load((ROOT / "config" / "strategies.yaml").read_text())
    settings.strategies = strategies.get("strategies", strategies)
    sp = settings.strategies["ema_pullback"]
    sp["sweep"] = {"atr_stop_mult": [1.5, 2.0], "take_profit_r": [2.0, 3.0]}
    st = ParquetStore(settings.data_dir)
    df = random_walk(4000, seed=5, vol=0.01)
    st.upsert_ohlcv("blofin", "UNIT-USDT", "1H", df.reset_index(drop=True))
    st.save_instruments("blofin", [unit_spec])
    out = run_research(settings, "blofin", ["ema_pullback"], ["UNIT-USDT"], ["1H"], True, True, False, workers=1)
    res = json.loads((out / "results.json").read_text())
    assert len(res) == 1 and "error" not in res[0], res[0].get("traceback")
    md = (out / "report.md").read_text()
    assert "Out-of-sample" in md and (out / "report.html").exists()
    assert any(p.suffix == ".png" for p in (out / "charts").iterdir())
