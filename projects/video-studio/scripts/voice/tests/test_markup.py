import unittest

from voicelib import markup
from voicelib.markup import MarkupError, SourceRef, Spoken, Text


class MarkupTest(unittest.TestCase):
    def test_display_spoken(self):
        segs = markup.parse("It hit {$40,000|forty thousand dollars} today.")
        self.assertEqual(segs, [Text("It hit "), Spoken("$40,000", "forty thousand dollars"), Text(" today.")])

    def test_source_tags_removed_from_captions_and_speech(self):
        n = "The fee was 2% [src:fees-2026]. Then it rose {68.67%|sixty eight percent} [src:a,b], fast."
        self.assertEqual(markup.display_text(n), "The fee was 2%. Then it rose 68.67%, fast.")
        self.assertEqual(markup.spoken_text(n), "The fee was 2%. Then it rose sixty eight percent, fast.")
        self.assertEqual(markup.source_ids(n), ["fees-2026", "a", "b"])

    def test_source_tag_mid_sentence_keeps_one_space(self):
        self.assertEqual(markup.display_text("claim [src:x] and more"), "claim and more")
        self.assertEqual(markup.display_text("claim [src:x]"), "claim")
        self.assertEqual(markup.display_text("价格[src:x]，涨了"), "价格，涨了")

    def test_spoken_only_and_display_only(self):
        self.assertEqual(markup.parse("{|uh}"), [Spoken("", "uh")])
        self.assertEqual(markup.parse("{SOL|}"), [Spoken("SOL", "")])
        self.assertEqual(markup.display_text("well {|uh} no"), "well no")
        self.assertEqual(markup.spoken_text("a {SOL|} b"), "a b")

    def test_whitespace_inside_markup_is_trimmed(self):
        self.assertEqual(markup.parse("{ $5 | five dollars }"), [Spoken("$5", "five dollars")])

    def test_errors(self):
        for bad in ["{unclosed", "close} only", "{a|b|c}", "{no pipe}", "{a{b|c}}", "{|}", "[src:bad id]", "[src:"]:
            with self.subTest(bad=bad):
                with self.assertRaises(MarkupError):
                    markup.parse(bad)

    def test_plain_brackets_are_text(self):
        self.assertEqual(markup.parse("a [note] b"), [Text("a [note] b")])

    def test_strip_sources_merges_text(self):
        segs = markup.strip_sources(markup.parse("x [src:a] y"))
        self.assertEqual(segs, [Text("x y")])
        self.assertFalse(any(isinstance(s, SourceRef) for s in segs))


if __name__ == "__main__":
    unittest.main()
