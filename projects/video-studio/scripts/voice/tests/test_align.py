import unittest

from voicelib import align
from voicelib.pipeline import timeline_words, translation_warning
from voicelib.words import Word, build_words


class Align(unittest.TestCase):
    def test_one_to_one(self):
        a = align.align("ðə pɹˈaɪs hˈɪt.", ["ðə", "pɹˈaɪs", "hˈɪt."])
        self.assertEqual(a.method, "1:1")
        self.assertEqual([("ðə pɹˈaɪs hˈɪt."[s:e]) for s, e in a.spans], ["ðə", "pɹˈaɪs", "hˈɪt"])

    def test_espeak_merges_are_split_phonetically(self):
        ctx = "juː ˈoʊpən ðɪ ˈæp æt θɹˈiː ɪnðə mˈɔːɹnɪŋ, ænd ðə tʃˈɑːɹt."
        iso = "juː ˈoʊpən ðə ˈæp æt θɹˈiː ˈɪn ðə mˈɔːɹnɪŋ, ænd ðə tʃˈɑːɹt.".split()
        a = align.align(ctx, iso)
        self.assertEqual(a.method, "phonetic")
        got = [ctx[s:e] for s, e in a.spans]
        self.assertEqual(got[6:8], ["ɪn", "ðə"])
        self.assertEqual(got[2], "ðɪ")
        self.assertEqual(got[8], "mˈɔːɹnɪŋ")

    def test_espeak_split_is_joined(self):
        ctx = "fˈɔːɹ hˈʌndɹɪd tˈuː kˈɔɪnz."
        a = align.align(ctx, ["fˈɔːɹhˈʌndɹɪd", "tˈuː", "kˈɔɪnz."])
        self.assertEqual([ctx[s:e] for s, e in a.spans], ["fˈɔːɹ hˈʌndɹɪd", "tˈuː", "kˈɔɪnz"])

    def test_punctuation_tokens_have_no_span(self):
        a = align.align("wˈaʊ — ˈʌp.", ["wˈaʊ", "—", "ˈʌp."])
        self.assertEqual(a.method, "1:1")
        self.assertIsNone(a.spans[1])

    def test_proportional_fallback(self):
        a = align.align("abc def ghi", ["xyz", "qqq"])
        self.assertEqual(a.method, "proportional")
        self.assertTrue(all(s is not None for s in a.spans))
        self.assertLess(a.spans[0][1], a.spans[1][1])

    def test_spans_are_ordered_and_disjoint(self):
        ctx = "nˈoʊbɑːdi tˈɛlz juː ðætðə tˈɑːp kˈɔːlɚɹ ɪz jˈuːʒuːəli ðə wˈʌn hˌuː bˈɔːt fˈɜːst."
        iso = "nˈoʊbɑːdi tˈɛlz juː ðˈæt ðə tˈɑːp kˈɔːlɚ ɪz jˈuːʒuːəli ðə wˌʌn hˈuː bˈɔːt fˈɜːst.".split()
        a = align.align(ctx, iso)
        prev = -1
        for s, e in a.spans:
            self.assertGreater(s, prev)
            self.assertLess(s, e)
            prev = e - 1


class TranslationWarning(unittest.TestCase):
    def test_rule_from_types_ts(self):
        sb = {"sourceLang": "en"}
        self.assertIsNone(translation_warning(sb, "en"))
        self.assertTrue(translation_warning(sb, "es").startswith("machine translation: needs native review"))
        self.assertTrue(translation_warning({**sb, "translation": {"status": "machine"}}, "es"))
        done = {"status": "native-reviewed", "reviewed": True, "reviewer": "x", "date": "2026-11-24"}
        self.assertIsNone(translation_warning({**sb, "translation": done}, "es"))
        # 2026-11-24 review: a half-set record (status alone, reviewed false, no reviewer or date) is still machine translation
        for k, v in (("reviewed", False), ("reviewer", ""), ("date", None)):
            with self.subTest(missing=k):
                self.assertTrue(translation_warning({**sb, "translation": {**done, k: v}}, "es").startswith("machine translation: needs native review"))


class TimelineWords(unittest.TestCase):
    def test_display_words_map_to_spoken_spans(self):
        words = build_words("It hit $40,000 — up {68.67%|sixty eight percent} [src:x].", "en")
        self.assertEqual([w.display for w in words], [["It"], ["hit"], ["$40,000"], ["—"], ["up"], ["68.67%."]])
        self.assertEqual(words[2].spoken, "forty thousand dollars")
        self.assertEqual(words[5].spoken, "sixty eight percent.")
        # fake char timings: 0.1 s per char of a fake phoneme string
        phon = "ɪt hɪt fɔɹti θaʊzənd dɑlɚz — ʌp sɪksti eɪt pɚsɛnt."
        ct = [(i * 0.1, (i + 1) * 0.1) for i in range(len(phon))]
        spans = [(0, 2), (3, 6), (7, 26), None, (29, 31), (32, 49)]
        out = timeline_words(words, spans, ct, spaced=True, duration_ms=10_000)
        self.assertEqual([w["text"] for w in out], ["It", "hit", "$40,000 —", "up", "68.67%."])
        self.assertEqual(out[2]["startMs"], 700)
        self.assertEqual(out[2]["endMs"], 2600)
        for a, b in zip(out, out[1:]):
            self.assertLessEqual(a["endMs"], b["startMs"])

    def test_multiword_display_shares_the_span(self):
        words = [Word(["Pump.fun", "founders"], "pump fun founders")]
        out = timeline_words(words, [(0, 10)], [(i * 0.1, (i + 1) * 0.1) for i in range(10)], True, 5000)
        self.assertEqual([w["text"] for w in out], ["Pump.fun", "founders"])
        self.assertEqual(out[0]["startMs"], 0)
        self.assertEqual(out[1]["endMs"], 1000)
        self.assertEqual(out[0]["endMs"], out[1]["startMs"])

    def test_touching_markup_stays_one_caption_word(self):
        words = build_words("about ~{$40|forty dollars}, (yes)", "en")
        self.assertEqual([w.display for w in words], [["about"], ["~$40,"], ["(yes)"]])
        self.assertEqual(words[1].spoken, "about forty dollars,")

    def test_spoken_only_word_has_no_caption(self):
        words = build_words("well {|uh} no", "en")
        out = timeline_words(words, [(0, 1), (2, 3), (4, 5)], [(i * 0.1, (i + 1) * 0.1) for i in range(5)], True, 5000)
        self.assertEqual([w["text"] for w in out], ["well", "no"])

    def test_stress_onset_from_kokoro_marks(self):
        phon = "ðə pɹˈaɪs fˈɔːɹɾi θˈaʊzənd dˈɑːlɚz"
        ct = [(i * 0.1, (i + 1) * 0.1) for i in range(len(phon))]
        words = [Word(["The"], "the"), Word(["price"], "price"), Word(["$40,000"], "forty thousand dollars")]
        spans = [(0, 2), (3, 9), (10, len(phon))]
        out = timeline_words(words, spans, ct, True, 10_000, phon)
        self.assertNotIn("stressMs", out[0])  # unstressed clitic
        self.assertEqual(out[1]["stressMs"], phon.index("ˈaɪ") * 100 + 100)  # the vowel after ˈ
        self.assertEqual(out[2]["stressMs"], phon.index("ˈɑː") * 100 + 100)  # last stress: "dollars"
        for w in out:
            if "stressMs" in w:
                self.assertTrue(w["startMs"] <= w["stressMs"] <= w["endMs"])

    def test_stress_goes_to_the_display_token_that_contains_it(self):
        phon = "pˈʌmp fˈʌn"
        ct = [(i * 0.1, (i + 1) * 0.1) for i in range(len(phon))]
        out = timeline_words([Word(["Pump.fun", "team"], "pump fun")], [(0, len(phon))], ct, True, 5000, phon)
        self.assertNotIn("stressMs", out[0])
        self.assertIn("stressMs", out[1])

    def test_times_clamped_to_scene(self):
        out = timeline_words([Word(["x"], "x")], [(0, 1)], [(0.0, 9.0)], True, 3000)
        self.assertEqual(out[0], {"text": "x", "startMs": 0, "endMs": 3000})


if __name__ == "__main__":
    unittest.main()
