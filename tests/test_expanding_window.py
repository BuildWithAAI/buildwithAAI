"""A fold may use an outcome only after that outcome's window has ended.

The prices below are constructed. They are not a market snapshot. The test
checks the clock: an earlier fold's readout and crow memory stay put when a
later price changes.
"""
from __future__ import annotations

import json
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path

from src.multi_brain_research.expanding_window import (
    choose_config,
    expanding_walk_forward,
)
from src.multi_brain_research.watch import replay


def _iso(ms: int) -> str:
    return datetime.fromtimestamp(ms / 1000, timezone.utc).isoformat()


def _pair(mint, *, ms, price, symbol):
    return {
        "source": "dexscreener_pairs",
        "chain": "solana",
        "token_address": mint,
        "symbol": symbol,
        "pair_address": "Pair" + mint[-4:],
        "dex": "pumpswap",
        "price_usd": price,
        "liquidity_usd": 50_000.0 + (ms % 5),
        "market_cap": 100_000.0,
        "volume_h1": 80_000.0,
        "price_change_h1": 5.0,
        "buys_h1": 40,
        "sells_h1": 10,
        "pair_created_at_ms": 1_000,
        "ts": _iso(ms),
        "fetched_at": _iso(ms),
    }


def _store(folder: Path, prices: dict[int, dict[str, float]]) -> Path:
    root = folder / "data"
    first = None
    for ms in sorted(prices):
        name = f"snapshots/1970-01-01/{ms:06d}.jsonl"
        path = root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        rows = [
            _pair("MintA", ms=ms, price=prices[ms]["MintA"], symbol="AAA"),
            _pair("MintB", ms=ms, price=prices[ms]["MintB"], symbol="BBB"),
        ]
        path.write_text("".join(json.dumps(row) + "\n" for row in rows), encoding="utf-8")
        if first is None:
            first = name
    (root / "latest.json").write_text(json.dumps({"snapshot_file": first, "sources": {}}), encoding="utf-8")
    return root


def _prices() -> dict[int, dict[str, float]]:
    found = {}
    for index, ms in enumerate(range(0, 20_001, 1_000)):
        found[ms] = {"MintA": 1.0 * (1.01 ** index), "MintB": 1.0 * (0.99 ** index)}
    return found


def _run(root: Path, work: Path) -> dict:
    return expanding_walk_forward(
        root, work, limit=25, threshold_ppm=600_000, use_holder_reads=False,
        fold_ms=4_000, min_train_ms=4_000, holdout_ms=4_000, horizons_ms=(1_000, 3_000),
    )


class ExpandingWindowTests(unittest.TestCase):
    def test_choose_config_uses_only_the_rows_it_is_given(self):
        short = {
            "id": "short", "exit_policy": "single_target", "horizon_ms": 300_000,
            "require_primary_vote": True, "closed": 2, "pnl_after_costs": -4.0,
        }
        longer = {
            "id": "longer", "exit_policy": "single_target", "horizon_ms": 3_600_000,
            "require_primary_vote": True, "closed": 2, "pnl_after_costs": -1.0,
        }
        longer_off = {
            "id": "longer-off", "exit_policy": "single_target", "horizon_ms": 3_600_000,
            "require_primary_vote": False, "closed": 2, "pnl_after_costs": -1.0,
        }
        chosen = choose_config([short, longer, longer_off], default_horizon=300_000)
        self.assertEqual(chosen["id"], "longer")
        self.assertEqual(chosen["reason"], "MAX_TRAIN_PNL_AFTER_COSTS")
        self.assertEqual(chosen["selected_on"], "train_folds")
        longer_off["closed"] = 4
        chosen = choose_config([short, longer, longer_off], default_horizon=300_000)
        self.assertEqual(chosen["id"], "longer-off")
        empty = choose_config([
            {"id": "none", "exit_policy": "single_target", "horizon_ms": 3_600_000,
             "require_primary_vote": False, "closed": 0, "pnl_after_costs": None},
        ], default_horizon=300_000)
        self.assertEqual(empty["reason"], "NO_CLOSED_TRAIN_TRADES")
        self.assertEqual(empty["horizon_ms"], 300_000)
        self.assertTrue(empty["require_primary_vote"])

    def test_a_fold_does_not_see_a_later_outcome(self):
        with tempfile.TemporaryDirectory() as folder:
            base = Path(folder)
            root = _store(base, _prices())
            first = _run(root, base / "work-a")
            self.assertFalse(first["execution_allowed"])
            self.assertFalse(first["live_orders"])
            self.assertGreaterEqual(len(first["folds"]), 2)
            roles = [fold["role"] for fold in first["folds"]]
            self.assertEqual(roles[-1], "holdout")
            self.assertNotIn("holdout", roles[:-1])
            for fold in first["folds"]:
                self.assertLess(fold["readout"]["train_outcome_end_max_ms"], fold["start_ms"])
                if fold["memory_outcome_end_max_ms"] is not None:
                    self.assertLess(fold["memory_outcome_end_max_ms"], fold["start_ms"])
                memory = base / "work-a" / f"fold-{fold['index']:02d}" / "crow.jsonl"
                if memory.read_text(encoding="utf-8").strip():
                    for line in memory.read_text(encoding="utf-8").splitlines():
                        if line.strip():
                            self.assertLess(json.loads(line)["outcome_end_ms"], fold["start_ms"])
                for row in first["selection"]["single_target"]["inputs"]:
                    self.assertEqual(row["role"], "train")
                for row in first["selection"]["ladder_e"]["inputs"]:
                    self.assertEqual(row["role"], "train")
            early = first["folds"][0]
            later = next(fold for fold in first["folds"] if fold["start_ms"] > 9_000)
            changed = _prices()
            changed[9_000] = {"MintA": 50.0, "MintB": 0.01}
            root_b = _store(base / "second", changed)
            second = _run(root_b, base / "work-b")
            again = second["folds"][0]
            moved = next(fold for fold in second["folds"] if fold["start_ms"] == later["start_ms"])
            self.assertEqual(again["readout"]["weights"], early["readout"]["weights"])
            self.assertEqual(again["readout"]["bias"], early["readout"]["bias"])
            self.assertEqual(again["memory_rows"], early["memory_rows"])
            self.assertEqual(again["memory_outcome_end_max_ms"], early["memory_outcome_end_max_ms"])
            early_memory = (base / "work-a" / "fold-00" / "crow.jsonl").read_text(encoding="utf-8")
            again_memory = (base / "work-b" / "fold-00" / "crow.jsonl").read_text(encoding="utf-8")
            self.assertEqual(early_memory, again_memory)
            self.assertNotEqual(moved["readout"]["weights"], later["readout"]["weights"])
            self.assertNotEqual(moved["memory_outcome_end_max_ms"], None)
            self.assertLess(moved["memory_outcome_end_max_ms"], moved["start_ms"])

    def test_replay_horizon_and_open_cutoff_stay_on_the_requested_clock(self):
        from src.multi_brain_research.snapshot_feed import parse_time_ms
        first = "2026-11-05T04:00:00+00:00"
        second = "2026-11-05T04:10:00+00:00"
        third = "2026-11-05T04:20:00+00:00"

        def pair(mint, ts, price):
            return {
                "source": "dexscreener_pairs", "chain": "solana", "token_address": mint,
                "symbol": mint[-1], "pair_address": "Pair" + mint[-4:], "dex": "pumpswap",
                "price_usd": price, "liquidity_usd": 50_000.0, "market_cap": 100_000.0,
                "volume_h1": 80_000.0, "price_change_h1": 5.0, "buys_h1": 40, "sells_h1": 10,
                "pair_created_at_ms": 1_000, "ts": ts, "fetched_at": ts,
            }

        def signal(observation, now_ms):
            del observation, now_ms
            return {
                "fused_score_ppm": 700_000,
                "confidence_ppm": 100_000,
                "mint": "Mint111",
                "brains": {
                    "flyvis": {"paper_long_support_ppm": 700_000, "detail": "FLASH_KERNEL_READOUT", "council_member": True, "primary": True},
                    "crow": {"paper_long_support_ppm": 700_000, "detail": "CROW_RECALL", "council_member": True},
                },
                "coordinator": {"research_signal": "PAPER"},
                "provenance": {"observation_sha256": "ab" * 32},
                "action": "NO_EXECUTION",
                "execution_allowed": False,
            }

        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder) / "same"
            day = root / "snapshots" / "2026-11-05"
            day.mkdir(parents=True)
            (day / "0400.jsonl").write_text(json.dumps(pair("MintAAA", first, 1.0)) + "\n", encoding="utf-8")
            (day / "0410.jsonl").write_text(json.dumps(pair("MintAAA", second, 1.01)) + "\n", encoding="utf-8")
            (day / "0420.jsonl").write_text(json.dumps(pair("MintAAA", third, 1.02)) + "\n", encoding="utf-8")
            (root / "latest.json").write_text(json.dumps({"snapshot_file": "snapshots/2026-11-05/0400.jsonl", "sources": {}}), encoding="utf-8")
            short = replay(
                root, root / "short.jsonl", root / "theses-short", score=signal,
                exit_policy="single_target", horizon_ms=60_000, retain_universe=True, use_holder_reads=False,
                not_after_ms=parse_time_ms(third),
            )
            self.assertEqual(short["opened"], 1)
            self.assertEqual(short["closed"], 1)
            opened = json.loads([line for line in (root / "short.jsonl").read_text().splitlines() if '"OPEN"' in line][0])
            self.assertEqual(opened["horizon_ms"], 60_000)
            closed = [json.loads(line) for line in (root / "short.jsonl").read_text().splitlines() if '"CLOSE"' in line]
            self.assertEqual(closed[0]["reason"], "TIMEOUT")
            held = replay(
                root, root / "held.jsonl", root / "theses-held", score=signal,
                exit_policy="single_target", horizon_ms=3_600_000, retain_universe=True, use_holder_reads=False,
                not_after_ms=parse_time_ms(third),
            )
            self.assertEqual(held["opened"], 1)
            self.assertEqual(held["closed"], 0)
            other = Path(folder) / "split"
            other_day = other / "snapshots" / "2026-11-05"
            other_day.mkdir(parents=True)
            (other_day / "0400.jsonl").write_text(json.dumps(pair("MintAAA", first, 1.0)) + "\n", encoding="utf-8")
            (other_day / "0410.jsonl").write_text(json.dumps(pair("MintBBB", second, 1.01)) + "\n", encoding="utf-8")
            (other_day / "0420.jsonl").write_text(json.dumps(pair("MintCCC", third, 1.02)) + "\n", encoding="utf-8")
            (other / "latest.json").write_text(json.dumps({"snapshot_file": "snapshots/2026-11-05/0400.jsonl", "sources": {}}), encoding="utf-8")
            open_all = replay(
                other, other / "all.jsonl", other / "theses-all", score=signal,
                exit_policy="single_target", horizon_ms=3_600_000, retain_universe=True, use_holder_reads=False,
            )
            self.assertEqual(open_all["opened"], 3)
            cutoff = replay(
                other, other / "cut.jsonl", other / "theses-cut", score=signal,
                exit_policy="single_target", horizon_ms=3_600_000, retain_universe=True, use_holder_reads=False,
                open_not_after_ms=parse_time_ms(second),
            )
            self.assertEqual(cutoff["opened"], 1)
            self.assertFalse(cutoff["live_orders"])


if __name__ == "__main__":
    unittest.main()
