import datetime as dt
import unittest

from tests import helpers  # noqa: F401  (puts scripts/topics on sys.path)
from topiclib import text


class FoldAndPhrases(unittest.TestCase):
    def test_fold_strips_accents_case_and_space(self):
        self.assertEqual(text.fold("  Inyección   de PROMPTS "), "inyeccion de prompts")
        self.assertEqual(text.fold("Golpe da memecoin: não consigo"), "golpe da memecoin: nao consigo")
        self.assertEqual(text.fold("can’t sell"), "can't sell")
        self.assertEqual(text.fold(None), "")

    def test_phrases_match_at_word_boundaries_with_flexible_joins(self):
        pat = text.compile_phrases(["rug pull*", "pump.fun", "kol", "seed phrase"])
        found = lambda s: text.find_phrases(pat, text.fold(s))  # noqa: E731
        self.assertTrue(found("He got RUG-PULLED"))
        self.assertTrue(found("rugpulls everywhere"))
        self.assertTrue(found("launched on Pump.fun"))
        self.assertTrue(found("pump fun launch"))
        self.assertTrue(found("a KOL posted"))
        self.assertFalse(found("Kolkata news"), "a bare word must not match inside a longer word")
        self.assertFalse(found("seedphrases"), "no wildcard on 'phrase': plural must not match")
        self.assertFalse(found("drug pull"), "the match must start at a word boundary")

    def test_empty_phrase_list_compiles_to_none(self):
        self.assertIsNone(text.compile_phrases([]))
        self.assertEqual(text.find_phrases(None, "anything"), [])


class Durations(unittest.TestCase):
    def test_youtube_durations(self):
        cases = {"PT15M33S": 933, "PT1H2M": 3720, "P1DT2H3M4S": 93784, "PT45S": 45, "P0D": 0, "PT0S": 0, "PT1H": 3600, "P1W": 604800}
        for raw, seconds in cases.items():
            self.assertEqual(text.parse_duration(raw), seconds, raw)

    def test_invalid_durations(self):
        for raw in ("", "P", "PT", "15:33", "P1DT", None, 12, "PT-5S"):
            self.assertIsNone(text.parse_duration(raw), raw)

    def test_format_duration(self):
        self.assertEqual(text.format_duration(41), "0:41")
        self.assertEqual(text.format_duration(3725), "1:02:05")
        self.assertEqual(text.format_duration(None), "unknown length")


class Times(unittest.TestCase):
    def test_parse_and_format_rfc3339(self):
        t = text.parse_time("2026-11-05T16:00:00Z")
        self.assertEqual(t, dt.datetime(2026, 11, 5, 16, tzinfo=dt.timezone.utc))
        self.assertEqual(text.parse_time("2026-11-05T16:00:00.123+02:00").hour, 14)
        self.assertEqual(text.rfc3339(dt.datetime(2026, 8, 26, 0, 0, 0, 500, tzinfo=dt.timezone.utc)), "2026-08-26T00:00:00Z")
        self.assertIsNone(text.parse_time("yesterday"))
        self.assertIsNone(text.parse_time(None))

    def test_naive_times_are_utc(self):
        self.assertEqual(text.parse_time("2026-11-05T16:00:00").tzinfo, dt.timezone.utc)


class Languages(unittest.TestCase):
    def test_codes(self):
        self.assertEqual(text.language_from_code("es-419"), "es")
        self.assertEqual(text.language_from_code("pt-BR"), "pt")
        self.assertEqual(text.language_from_code("en_US"), "en")
        self.assertIsNone(text.language_from_code(""))

    def test_guess(self):
        self.assertEqual(text.guess_language("Estafa con deepfake en directo: así te roban con un sorteo falso"), "es")
        self.assertEqual(text.guess_language("Golpe da voz clonada: a ligação falsa do seu filho pedindo dinheiro"), "pt")
        self.assertEqual(text.guess_language("How the scam works and why you should check your wallet"), "en")
        self.assertIsNone(text.guess_language("Bitcoin"))


class CopyMeasures(unittest.TestCase):
    def test_jaccard_ignores_function_words(self):
        self.assertEqual(text.jaccard("The wallet and the drainer", "a drainer of wallet"), 1.0)
        self.assertEqual(text.jaccard("", "anything"), 0.0)

    def test_longest_shared_run(self):
        self.assertEqual(text.longest_shared_run("How wallet drainers empty wallets fast", "Why wallet drainers empty wallets"), 4)
        self.assertEqual(text.longest_shared_run("alpha beta", "gamma delta"), 0)

    def test_slugify(self):
        self.assertEqual(text.slugify("POV: Your token only goes up!"), "pov-your-token-only-goes-up")
        self.assertLessEqual(len(text.slugify("x" * 200)), 64)


if __name__ == "__main__":
    unittest.main()
