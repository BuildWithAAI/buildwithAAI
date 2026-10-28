"""The live gate must reject swapped units, missing facts and instruction echoes."""

from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
from live_model_evidence import check_measured_answer  # noqa: E402


class AnswerAcceptanceTests(unittest.TestCase):
    def test_correct_count_unit_associations(self):
        for answer in ("The text has 12 bytes and 2 words.",
                       "There are 12 UTF-8 bytes and 2 words.",
                       "UTF-8 byte count: 12; word count: 2."):
            with self.subTest(answer=answer):
                check_measured_answer(answer)

    def test_swapped_counts_missing_facts_and_instruction_echoes_fail(self):
        for answer in ("The text has 12 words and 2 bytes.",
                       "The text has 112 bytes and 2 words.",
                       "The counts are 12 and 2 for bytes and words.",
                       "The text has 12 bytes and 20 words.",
                       "First call a tool, then write 12 bytes and 2 words."):
            with self.subTest(answer=answer), self.assertRaises(AssertionError):
                check_measured_answer(answer)
