"""Crow recall cannot see an outcome that had not finished, and snapshot files stay in time order.

The rows under tests/fixtures/giant-brain-time-gate are copied from the collector
snapshots on 2026-11-04: SI276 at 05:15, 05:20, and 05:25 UTC, and JEANPHIL at
22:00, 22:05, and 22:10 UTC. Prices are those prints. Nothing here is a live order.
"""
from __future__ import annotations

import gzip
import hashlib
import json
import shutil
import tempfile
import unittest
from pathlib import Path

from src.multi_brain_research.brain_input import features
from src.multi_brain_research.crow_brain import recall, remember
from src.multi_brain_research.snapshot_feed import load_snapshot, observation_from_pair, parse_time_ms, snapshot_files
from src.multi_brain_research.walk_forward import walk_forward
from src.multi_brain_research.watch import replay

FIXTURE = Path(__file__).resolve().parents[1] / "tests" / "fixtures" / "giant-brain-time-gate"
EARLY = ("0515.jsonl", "0520.jsonl", "0525.jsonl")
LATE = ("2200.jsonl", "2205.jsonl", "2210.jsonl")


def _row(name: str) -> dict:
    return json.loads((FIXTURE / "snapshots" / "2026-11-04" / name).read_text(encoding="utf-8"))


def _outcome(current_name: str, previous_name: str, later_name: str) -> dict:
    current = _row(current_name)
    previous = _row(previous_name)
    later = _row(later_name)
    mapped = features(observation_from_pair(current, previous))
    digest = hashlib.sha256((FIXTURE / "snapshots" / "2026-11-04" / later_name).read_bytes()).hexdigest()
    return {
        "features": mapped["features"],
        "later_return": (later["price_usd"] - current["price_usd"]) / current["price_usd"],
        "outcome_start_ms": parse_time_ms(current["ts"]),
        "outcome_end_ms": parse_time_ms(later["ts"]),
        "observation_sha256": digest,
        "mint": current["token_address"],
    }


class CrowTimeGateTests(unittest.TestCase):
    def test_a_future_snapshot_outcome_is_excluded_until_its_window_ends(self):
        early = _outcome("0520.jsonl", "0515.jsonl", "0525.jsonl")
        future = _outcome("2205.jsonl", "2200.jsonl", "2210.jsonl")
        self.assertLess(early["outcome_end_ms"], future["outcome_start_ms"])
        self.assertNotEqual(early["mint"], future["mint"])
        self.assertNotEqual(early["later_return"], future["later_return"])
        with tempfile.TemporaryDirectory() as folder:
            memory = Path(folder) / "crow.jsonl"
            for outcome in (future, early):
                remember(memory, {
                    "mint": outcome["mint"],
                    "features": outcome["features"],
                    "later_return": outcome["later_return"],
                    "observation_sha256": outcome["observation_sha256"],
                    "outcome_start_ms": outcome["outcome_start_ms"],
                    "outcome_end_ms": outcome["outcome_end_ms"],
                    "action": "NO_EXECUTION",
                    "execution_allowed": False,
                })
            blocked = recall(future["features"], memory, now_ms=future["outcome_start_ms"])
            self.assertNotEqual(blocked.get("matched_observation_sha256"), future["observation_sha256"])
            self.assertNotEqual(blocked.get("recalled_return"), future["later_return"])
            if blocked["detail"] == "CROW_RECALL":
                self.assertLessEqual(blocked["outcome_end_ms"], future["outcome_start_ms"])
            else:
                self.assertEqual(blocked["detail"], "CROW_NO_SIMILAR_PATTERN")
            opened = recall(future["features"], memory, now_ms=future["outcome_end_ms"])
            self.assertEqual(opened["detail"], "CROW_RECALL")
            self.assertEqual(opened["matched_observation_sha256"], future["observation_sha256"])
            self.assertEqual(opened["outcome_end_ms"], future["outcome_end_ms"])
            self.assertAlmostEqual(opened["recalled_return"], future["later_return"])
            self.assertFalse(opened["execution_allowed"])

    def test_a_memory_row_without_an_end_time_is_not_recalled(self):
        future = _outcome("2205.jsonl", "2200.jsonl", "2210.jsonl")
        with tempfile.TemporaryDirectory() as folder:
            memory = Path(folder) / "crow.jsonl"
            remember(memory, {
                "mint": future["mint"],
                "features": future["features"],
                "later_return": future["later_return"],
                "observation_sha256": future["observation_sha256"],
                "action": "NO_EXECUTION",
                "execution_allowed": False,
            })
            blocked = recall(future["features"], memory, now_ms=future["outcome_end_ms"])
            self.assertEqual(blocked["detail"], "CROW_MEMORY_EMPTY")
            self.assertNotIn("recalled_return", blocked)

    def test_walk_forward_does_not_fill_memory_from_the_later_snapshots(self):
        late = _row("2200.jsonl")["token_address"]
        with tempfile.TemporaryDirectory() as folder:
            work = Path(folder) / "work"
            report = walk_forward(FIXTURE, work)
            self.assertEqual(report["holdout_file"], "snapshots/2026-11-04/2200.jsonl")
            self.assertEqual(report["fill_through_file"], "snapshots/2026-11-04/0525.jsonl")
            self.assertGreater(report["gap_ms"], 0)
            self.assertEqual(report["memory_rows"], 1)
            self.assertLess(report["memory_outcome_end_max_ms"], report["holdout_ms"])
            lines = [json.loads(line) for line in (work / "crow.jsonl").read_text(encoding="utf-8").splitlines() if line.strip()]
            self.assertEqual(len(lines), 1)
            self.assertNotEqual(lines[0]["mint"], late)
            self.assertLess(lines[0]["outcome_end_ms"], report["holdout_ms"])
            self.assertFalse(report["execution_allowed"])
            self.assertFalse(report["live_orders"])
            self.assertFalse(report["with_crow"]["live_orders"])
            self.assertFalse(report["without_crow"]["execution_allowed"])

    def test_gzip_from_an_earlier_day_is_read_before_the_next_utc_day(self):
        early = _row("0520.jsonl")
        later = _row("0525.jsonl")
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            day = root / "snapshots" / "2026-11-04"
            nxt = root / "snapshots" / "2026-11-05"
            day.mkdir(parents=True)
            nxt.mkdir()
            with gzip.open(day / "1200.jsonl.gz", "wb") as handle:
                handle.write(json.dumps(early).encode())
            (nxt / "0100.jsonl").write_bytes(json.dumps(later).encode())
            (day / "1200.jsonl").write_bytes(json.dumps(early).encode())
            (root / "latest.json").write_text(json.dumps({"snapshot_file": "snapshots/2026-11-05/0100.jsonl", "sources": {}}))
            self.assertEqual(snapshot_files(root), [
                "snapshots/2026-11-04/1200.jsonl",
                "snapshots/2026-11-05/0100.jsonl",
            ])
            (day / "1200.jsonl").unlink()
            self.assertEqual(snapshot_files(root), [
                "snapshots/2026-11-04/1200.jsonl.gz",
                "snapshots/2026-11-05/0100.jsonl",
            ])
            loaded = load_snapshot(root, "snapshots/2026-11-04/1200.jsonl.gz")
            self.assertEqual(loaded[0]["price_usd"], early["price_usd"])
            seen = []

            def score(observation, now_ms):
                seen.append(observation.get("previous_price"))
                return {"fused_score_ppm": 0}

            result = replay(root, root / "paper.jsonl", root / "theses", score=score, limit=25)
            self.assertEqual(seen, [None, early["price_usd"]])
            self.assertEqual(result["opened"], 0)
            self.assertFalse(result["live_orders"])
            self.assertFalse(result["execution_allowed"])

    def test_walk_forward_still_learns_the_early_outcome_from_a_gzipped_snapshot(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder) / "root"
            shutil.copytree(FIXTURE, root)
            plain = root / "snapshots" / "2026-11-04" / "0515.jsonl"
            with gzip.open(plain.with_name("0515.jsonl.gz"), "wb") as handle:
                handle.write(plain.read_bytes())
            plain.unlink()
            report = walk_forward(root, Path(folder) / "work")
            self.assertEqual(report["memory_rows"], 1)
            self.assertLess(report["memory_outcome_end_max_ms"], report["holdout_ms"])
            self.assertIn("0515.jsonl.gz", snapshot_files(root)[0])


if __name__ == "__main__":
    unittest.main()
