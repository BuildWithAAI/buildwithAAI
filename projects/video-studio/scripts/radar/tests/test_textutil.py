import datetime as dt
import unittest

from radarlib import textutil as t


class Text(unittest.TestCase):
    def test_truncate_respects_limit_and_words(self):
        text = "word " * 200
        out = t.truncate(text, 280)
        self.assertLessEqual(len(out), 280)
        self.assertTrue(out.endswith("…"))
        self.assertFalse(out[:-1].endswith(" "))
        self.assertEqual(t.truncate("short text"), "short text")

    def test_html_to_text_drops_scripts_and_decodes(self):
        html = "<p>Hello&nbsp;<b>world</b></p><script>alert('x')</script><style>p{}</style>&amp; more"
        self.assertEqual(t.html_to_text(html), "Hello world & more")
        self.assertEqual(t.html_to_text("What&amp;#039;s new"), "What&#039;s new")
        self.assertEqual(t.html_to_text(None), "")

    def test_clean_ws_removes_zero_width(self):
        self.assertEqual(t.clean_ws("a​ b \n c"), "a b c")


class Dates(unittest.TestCase):
    def test_rfc822_and_iso(self):
        self.assertEqual(t.iso_z(t.parse_rfc822("Tue, 24 Nov 2026 05:24:47 GMT")), "2026-11-24T05:24:47Z")
        self.assertEqual(t.iso_z(t.parse_rfc822("Mon, 23 Nov 2026 23:06:02 +0000")), "2026-11-23T23:06:02Z")
        self.assertEqual(t.iso_z(t.parse_iso("2026-11-22T21:54:09.607Z")), "2026-11-22T21:54:09Z")
        self.assertEqual(t.iso_z(t.parse_iso("2026-11-20T08:55-05:00")), "2026-11-20T13:55:00Z")
        self.assertEqual(t.iso_z(t.parse_iso("2026-11-22")), "2026-11-22T00:00:00Z")
        self.assertIsNone(t.parse_rfc822("not a date"))
        self.assertIsNone(t.parse_iso("yesterday"))

    def test_dates_in_text_infers_year_and_drops_future(self):
        ref = dt.date(2026, 11, 23)
        found = t.dates_in_text("stolen in the October 29 hack; a Dec. 1 hearing", ref)
        self.assertEqual(found, [dt.date(2026, 10, 29)])
        self.assertEqual(t.dates_in_text("On November 2 ... On Nov. 10, 2026 again", ref),
                         [dt.date(2026, 11, 2), dt.date(2026, 11, 10)])
        self.assertEqual(t.dates_in_text("on December 15", dt.date(2026, 1, 5)), [dt.date(2025, 12, 15)])
        self.assertEqual(t.dates_in_text("May is a month", ref), [])


class Money(unittest.TestCase):
    def values(self, text):
        return [t.money_value(m) for m in t.MONEY_RE.finditer(text)]

    def test_money_forms(self):
        self.assertEqual(self.values("$12M hack"), [12e6])
        self.assertEqual(self.values("$12.6 Million Vault"), [12.6e6])
        self.assertEqual(self.values("$1.17 billion"), [1.17e9])
        self.assertEqual(self.values("$600K"), [600e3])
        self.assertEqual(self.values("$ 5,700,000"), [5.7e6])
        self.assertEqual(self.values("$1.04M–$2M"), [1.04e6, 2e6])
        self.assertEqual(self.values("US$3 bn"), [3e9])

    def test_formatting_and_scale(self):
        self.assertEqual(t.format_usd(11960000), "$11.96M")
        self.assertEqual(t.format_usd(968000), "$968K")
        self.assertEqual(t.format_usd(6360000000), "$6.36B")
        self.assertEqual(t.format_usd(750), "$750")
        self.assertEqual(t.format_usd_exact(11960000), "$11,960,000")
        self.assertEqual(t.format_usd_exact(287665.98), "$287,665.98")
        self.assertEqual(t.log_scale(1e4), 0.0)
        self.assertEqual(t.log_scale(1e9), 1.0)
        self.assertAlmostEqual(t.log_scale(1e6), 0.4)
        self.assertEqual(t.log_scale(None), 0.0)
        self.assertEqual(t.log_scale(5e12), 1.0)


class Names(unittest.TestCase):
    def test_core_and_slug(self):
        self.assertEqual(t.core_name("Chainflip AMM"), "chainflip")
        self.assertEqual(t.core_name("Binance CEX"), "binance")
        self.assertEqual(t.core_name("Wagyu (XMR1)"), "wagyu")
        self.assertEqual(t.core_name("Kava Lend"), "kava")
        self.assertEqual(t.core_name("Mercado Bitcoin"), "mercado bitcoin")
        self.assertEqual(t.norm_name("Crédit Mutuel Arkéa"), "credit mutuel arkea")
        self.assertEqual(t.slugify("Pump.fun"), "pump-fun")
        self.assertEqual(t.slugify("Trezor and Exodus"), "trezor-and-exodus")


if __name__ == "__main__":
    unittest.main()
