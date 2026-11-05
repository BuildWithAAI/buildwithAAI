"""Vanished mints stay in the paper book and exit at the last real print.

A volume cap used to drop a coin once it left the top of the file. The
retained universe still marks that coin. A later file that does not contain
it closes the position at the last positive price. A missing price is
NOT_OBSERVED and does not invent a fill. Nothing here sends an order.
"""
from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from src.multi_brain_research.paper_trader import PaperError, close_vanished, metrics, open_position
from src.multi_brain_research.snapshot_feed import files_through
from src.multi_brain_research.thesis import write_thesis
from src.multi_brain_research.watch import replay


def _signal(**crow):
    brain = {"paper_long_support_ppm": 800_000, "detail": "CROW_RECALL", "council_member": True}
    brain.update(crow)
    return {
        "fused_score_ppm": 700_000,
        "confidence_ppm": 100_000,
        "mint": "Mint111",
        "brains": {
            "crow": brain,
            "flyvis": {"paper_long_support_ppm": 400_000, "detail": "FLASH_KERNEL_READOUT", "council_member": True},
        },
        "coordinator": {"research_signal": "ABSTAIN"},
        "provenance": {"observation_sha256": "ab" * 32},
        "action": "NO_EXECUTION",
        "execution_allowed": False,
    }


def _pair(mint, *, ts, price, volume, symbol="DEMO"):
    return {
        "source": "dexscreener_pairs",
        "chain": "solana",
        "token_address": mint,
        "symbol": symbol,
        "pair_address": "Pair" + mint[:4],
        "dex": "pumpswap",
        "price_usd": price,
        "liquidity_usd": 50_000.0,
        "market_cap": 100_000.0,
        "volume_h1": volume,
        "price_change_h1": 20.0,
        "buys_h1": 30,
        "sells_h1": 10,
        "pair_created_at_ms": 1_000,
        "ts": ts,
        "fetched_at": ts,
    }


def _root(folder: str, files: dict[str, list[dict]]) -> Path:
    root = Path(folder) / "data"
    for name, rows in files.items():
        path = root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("".join(json.dumps(row) + "\n" for row in rows))
    latest = next(iter(files))
    (root / "latest.json").write_text(json.dumps({"snapshot_file": latest, "sources": {}}))
    return root


class UniverseRetentionTests(unittest.TestCase):
    def test_a_vanished_mint_exits_at_the_last_print_and_not_at_zero(self):
        first = "2026-11-04T05:20:01+00:00"
        second = "2026-11-04T05:25:01+00:00"
        with tempfile.TemporaryDirectory() as folder:
            root = _root(folder, {
                "snapshots/2026-11-04/0520.jsonl": [_pair("LOW", ts=first, price=1.0, volume=10, symbol="LOW")],
                "snapshots/2026-11-04/0525.jsonl": [
                    _pair("HIGH", ts=second, price=1.0, volume=10, symbol="HIGH"),
                    {"source": "dexscreener_token_profiles_latest", "chain": "solana", "token_address": "DEAD", "ts": second},
                ],
            })
            result = replay(
                root, root / "paper.jsonl", root / "theses",
                score=lambda observation, now_ms: _signal(),
                retain_universe=True, entry_floor=True, exit_policy="single_target", limit=1,
            )
            self.assertEqual(result["opened"], 2)
            self.assertEqual(result["vanished"], 1)
            self.assertEqual(result["not_observed_exits"], 0)
            self.assertGreaterEqual(result["universe_mints"], 3)
            self.assertGreaterEqual(result["never_priced"], 1)
            self.assertFalse(result["live_orders"])
            self.assertFalse(result["execution_allowed"])
            close = [json.loads(line) for line in (root / "paper.jsonl").read_text().splitlines() if '"CLOSE"' in line][-1]
            self.assertEqual(close["reason"], "VANISHED")
            self.assertEqual(close["fill_model"], "LAST_OBSERVED_PRICE")
            self.assertEqual(close["exit_raw_usd"], 1.0)
            self.assertNotEqual(close["exit_raw_usd"], 0)
            self.assertLess(close["pnl_after_costs_usd"], 0)
            report = metrics(root / "paper.jsonl")
            self.assertEqual(report["closed"], 1)
            self.assertEqual(report["vanished"], 1)
            self.assertEqual(report["unpriced_exits"], 0)
            self.assertLess(report["pnl_after_costs"], 0)

    def test_the_volume_cap_drops_the_same_mint_when_retention_is_off(self):
        first = "2026-11-04T05:20:01+00:00"
        second = "2026-11-04T05:22:01+00:00"
        files = {
            "snapshots/2026-11-04/0520.jsonl": [_pair("LOW", ts=first, price=1.0, volume=1, symbol="LOW")],
            "snapshots/2026-11-04/0522.jsonl": [
                _pair("HIGH", ts=second, price=1.0, volume=1_000_000, symbol="HIGH"),
                _pair("LOW", ts=second, price=0.4, volume=1, symbol="LOW"),
            ],
        }
        with tempfile.TemporaryDirectory() as folder:
            root = _root(folder, files)
            kept = replay(
                root, root / "kept.jsonl", root / "theses-kept",
                score=lambda observation, now_ms: _signal(),
                retain_universe=True, exit_policy="single_target", limit=1,
            )
            dropped = replay(
                root, root / "dropped.jsonl", root / "theses-dropped",
                score=lambda observation, now_ms: _signal(),
                retain_universe=False, exit_policy="single_target", limit=1,
            )
            self.assertEqual(kept["opened"], 2)
            self.assertEqual(kept["closed"], 1)
            self.assertEqual(dropped["closed"], 0)
            self.assertEqual(dropped["opened"], 2)
            close = json.loads((root / "kept.jsonl").read_text().splitlines()[-1])
            self.assertEqual(close["reason"], "STOP")
            self.assertEqual(close["exit_raw_usd"], 0.8)
            self.assertFalse(kept["live_orders"])

    def test_a_missing_price_does_not_invent_pnl(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            thesis = write_thesis(_signal(), _pair("LOW", ts="2026-11-04T05:20:01+00:00", price=1.0, volume=10), now_ms=1_000)
            open_position(root / "paper.jsonl", thesis, mark_price_usd=1.0, now_ms=1_000, notional_usd=100, exit_policy="single_target")
            row = close_vanished(root / "paper.jsonl", thesis["thesis_id"], now_ms=2_000, last_price=None, last_price_ms=None)
            self.assertEqual(row["reason"], "NOT_OBSERVED")
            self.assertNotIn("pnl_usd", row)
            self.assertNotIn("exit_raw_usd", row)
            self.assertFalse(row["live_orders"])
            with self.assertRaises(PaperError):
                close_vanished(root / "paper.jsonl", "missing", now_ms=2_000, last_price=1.0, last_price_ms=1_000)
            report = metrics(root / "paper.jsonl")
            self.assertEqual(report["closed"], 0)
            self.assertEqual(report["unpriced_exits"], 1)
            self.assertEqual(report["net_pnl_usd"], 0.0)
            self.assertIsNone(report["pnl_after_costs"])

    def test_close_vanished_rejects_a_non_positive_print(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            thesis = write_thesis(_signal(), _pair("LOW", ts="2026-11-04T05:20:01+00:00", price=1.0, volume=10), now_ms=1_000)
            open_position(root / "paper.jsonl", thesis, mark_price_usd=1.0, now_ms=1_000, notional_usd=100, exit_policy="ladder_e")
            row = close_vanished(root / "paper.jsonl", thesis["thesis_id"], now_ms=2_000, last_price=0, last_price_ms=1_000)
            self.assertEqual(row["reason"], "NOT_OBSERVED")
            self.assertEqual(row["fill_model"], "NOT_OBSERVED")
            self.assertFalse(row["execution_allowed"])

    def test_a_loose_crow_match_is_refused_only_when_the_gate_is_on(self):
        ts = "2026-11-04T05:20:01+00:00"
        with tempfile.TemporaryDirectory() as folder:
            root = _root(folder, {"snapshots/2026-11-04/0520.jsonl": [_pair("LOW", ts=ts, price=1.0, volume=10)]})

            def score(observation, now_ms):
                return _signal(recalled_return=0.8, distance=0.55)

            off = replay(
                root, root / "off.jsonl", root / "theses-off",
                score=score, retain_universe=True, exit_policy="single_target",
            )
            on = replay(
                root, root / "on.jsonl", root / "theses-on",
                score=score, retain_universe=True, exit_policy="single_target", max_crow_distance=0.3,
            )
            self.assertEqual(off["opened"], 1)
            self.assertEqual(on["opened"], 0)
            self.assertEqual(on["entry_skipped"], 1)
            self.assertEqual(on["skip_reasons"].get("CROW_DISTANCE_ABOVE_MAX"), 1)
            self.assertFalse(on["live_orders"])
            self.assertGreater(on["abstention_rate"], 0)

    def test_a_missing_primary_vote_is_refused_only_when_the_gate_is_on(self):
        ts = "2026-11-04T05:20:01+00:00"
        with tempfile.TemporaryDirectory() as folder:
            root = _root(folder, {"snapshots/2026-11-04/0520.jsonl": [_pair("LOW", ts=ts, price=1.0, volume=10)]})
            quiet = _signal()
            quiet["brains"]["flyvis"]["paper_long_support_ppm"] = None
            off = replay(
                root, root / "off.jsonl", root / "theses-off",
                score=lambda observation, now_ms: quiet,
                retain_universe=True, exit_policy="single_target",
            )
            on = replay(
                root, root / "on.jsonl", root / "theses-on",
                score=lambda observation, now_ms: quiet,
                retain_universe=True, exit_policy="single_target", require_primary_vote=True,
            )
            fly = _signal()
            fly["brains"]["flyvis"]["paper_long_support_ppm"] = 420_000
            allowed = replay(
                root, root / "allowed.jsonl", root / "theses-allowed",
                score=lambda observation, now_ms: fly,
                retain_universe=True, exit_policy="single_target", require_primary_vote=True,
            )
            self.assertEqual(off["opened"], 1)
            self.assertEqual(on["opened"], 0)
            self.assertEqual(on["skip_reasons"].get("PRIMARY_ABSTAINED"), 1)
            self.assertEqual(allowed["opened"], 1)
            self.assertFalse(allowed["live_orders"])

    def test_cutoff_file_drops_a_later_snapshot(self):
        files = [
            "snapshots/2026-11-04/0515.jsonl.gz",
            "snapshots/2026-11-05/0800.jsonl",
            "snapshots/2026-11-05/0805.jsonl",
        ]
        kept = files_through(files, "snapshots/2026-11-05/0800.jsonl")
        self.assertEqual(kept, files[:2])
        self.assertEqual(files_through(files, None), files)
