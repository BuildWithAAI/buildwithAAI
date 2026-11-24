import copy
import unittest

from tests import helpers
from topiclib import classify

FMT = helpers.config()["format"]


def video(title, description="", tags=(), duration=600, w=640, h=360, **extra):
    v = {"title": title, "description": description, "tags": list(tags), "durationSec": duration, "embedWidth": w, "embedHeight": h}
    v.update(extra)
    return v


class TaxonomyFile(unittest.TestCase):
    def test_committed_taxonomy_is_valid(self):
        data = helpers.load_json(helpers.TAXONOMY)
        self.assertEqual(classify.validate(data, helpers.FORMATS, set(helpers.SECURITY_EVERGREEN)), [])

    def test_validation_catches_editing_slips(self):
        data = helpers.load_json(helpers.TAXONOMY)
        broken = copy.deepcopy(data)
        broken["topics"][0]["subtopics"][0]["oneFix"] = ""
        broken["topics"][0]["subtopics"][0]["titles"]["explainer"] = ["x" * 101]
        broken["topics"][1]["fits"][0]["format"] = "vlog"
        broken["topics"][2]["fits"][0]["evergreenTopic"] = "not-a-security-topic"
        del broken["angleTemplates"]["zoora-ai/explainer"]
        problems = classify.validate(broken, helpers.FORMATS, set(helpers.SECURITY_EVERGREEN))
        joined = " | ".join(problems)
        for needle in ("oneFix is missing", "1-100 characters", "vlog", "not-a-security-topic", "zoora-ai/explainer"):
            self.assertIn(needle, joined)
        with self.assertRaises(classify.TaxonomyError):
            classify.Taxonomy(broken, helpers.FORMATS, set(helpers.SECURITY_EVERGREEN))


class Topics(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tax = helpers.taxonomy()

    def topic(self, title, **kw):
        c = classify.classify_video(video(title, **kw), self.tax, FMT, "en")
        return c["topic"], c["subtopic"]

    def test_english_titles(self):
        self.assertEqual(self.topic("I signed one message and lost everything (wallet drainer explained)"), ("drainers", "permit-signatures"))
        self.assertEqual(self.topic("Address poisoning: the copy paste trap"), ("address-poisoning", None))
        self.assertEqual(self.topic("Voice clone scam call: what it sounds like"), ("ai-security", "voice-clone"))
        self.assertEqual(self.topic("Prompt injection, explained for AI agents"), ("ai-security", "prompt-injection"))
        self.assertEqual(self.topic("My token is a honeypot: can't sell, rug pull"), ("rug-pulls", "honeypot"))
        self.assertEqual(self.topic("Fake job interview malware"), ("fake-job-malware", None))
        self.assertEqual(self.topic("SIM swap: how they took my number"), ("sim-swap", None))

    def test_spanish_and_portuguese_titles(self):
        self.assertEqual(self.topic("Frase semilla: el error que vació mi billetera"), ("key-management", "seed-phrase"))
        self.assertEqual(self.topic("Estafa con deepfake en directo"), ("ai-security", "deepfake-live"))
        self.assertEqual(self.topic("Golpe da voz clonada: ligação falsa"), ("ai-security", "voice-clone"))
        self.assertEqual(self.topic("Comprei a memecoin e não consigo vender: honeypot"), ("rug-pulls", "honeypot"))
        self.assertEqual(self.topic("Injeção de prompt em agentes de IA"), ("ai-security", "prompt-injection"))

    def test_strong_phrases_beat_weak_ones(self):
        # "crypto security" is a weak key-management phrase; "wallet drainer" is strong for drainers.
        self.assertEqual(self.topic("Crypto security: the wallet drainer wave")[0], "drainers")

    def test_off_niche(self):
        c = classify.classify_video(video("New GPU driver vulnerability patched (and what AI labs said)"), self.tax, FMT, "en")
        self.assertEqual((c["topic"], c["exclude"]), (None, "off-niche"))


class CuesAndExclusions(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tax = helpers.taxonomy()

    def c(self, title, **kw):
        return classify.classify_video(video(title, **kw), self.tax, FMT, "en")

    def test_attack_tutorials_are_excluded(self):
        for title in ("How to build a wallet drainer (full script tutorial)", "Como criar seu proprio drainer", "How to hack a MetaMask wallet in 5 minutes", "Tutorial de como hacer un drainer"):
            self.assertEqual(self.c(title)["exclude"], "attack-tutorial", title)
        self.assertEqual(self.c("Wallet drainer explained", description="Drainer script walkthrough.")["exclude"], "attack-tutorial")
        self.assertIsNone(self.c("How to protect your wallet from drainers")["exclude"])

    def test_price_content_is_excluded_only_from_titles(self):
        self.assertEqual(self.c("Bitcoin price prediction and crypto security")["exclude"], "price-content")
        self.assertIsNone(self.c("Wallet drainer explained", description="no price prediction here")["exclude"])

    def test_income_claims_are_flagged(self):
        self.assertIn("income-claims", self.c("How I Made $50,000 Sniping Memecoins on Pump.fun")["flags"])
        self.assertIn("income-claims", self.c("Rug pull? Gané 3000 dólares con memecoins")["flags"])
        self.assertNotIn("income-claims", self.c("Rug pull losses hit $50 million, says tracker")["flags"])

    def test_style_cues_come_from_the_title_only(self):
        c = self.c("Voice clone scam call", description="Como funciona: explained step by step", tags=["explained"])
        self.assertIn("scamPattern", c["cues"])
        self.assertNotIn("explainer", c["cues"])
        self.assertIn("crypto", self.c("Voice clone scam", description="send crypto")["cues"])


class FormatAndLanguage(unittest.TestCase):
    def test_formats(self):
        cases = [
            ((41, 203, 360), ("short", False, "vertical")),
            ((170, 360, 360), ("short", False, "square")),
            ((120, 640, 360), ("long", False, "horizontal")),
            ((200, 203, 360), ("long", False, "vertical")),
            ((45, None, None), ("short", False, None)),
            ((95, None, None), ("long", True, None)),
            ((900, None, None), ("long", False, None)),
            ((None, 640, 360), ("long", True, "horizontal")),
            ((0, None, None), ("long", True, None)),
        ]
        for (dur, w, h), expected in cases:
            self.assertEqual(classify.detect_format(dur, w, h, FMT), expected, (dur, w, h))

    def test_language_sources(self):
        self.assertEqual(classify.detect_language({"defaultAudioLanguage": "es-419", "defaultLanguage": "en"}), ("es", "defaultAudioLanguage"))
        self.assertEqual(classify.detect_language({"defaultLanguage": "pt-BR"}), ("pt", "defaultLanguage"))
        self.assertEqual(classify.detect_language({"title": "Golpe da voz clonada: a ligação falsa do seu filho"}), ("pt", "text"))
        self.assertEqual(classify.detect_language({"title": "Rug pull"}, "es"), ("es", "query"))


class Fit(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tax = helpers.taxonomy()

    def test_cues_choose_the_format_on_the_uncapped_score(self):
        plain = self.tax.choose_fit("ai-security", {})
        self.assertEqual((plain[0]["channel"], plain[0]["format"]), ("zoora-security", "explainer"))
        scam = self.tax.choose_fit("ai-security", {"scamPattern": ["scam"]})
        self.assertEqual(scam[0]["format"], "scam-of-the-week", "0.9 + 0.15 beats an unboosted 1.0")
        self.assertEqual(scam[0]["fit"], 1.0, "the component itself is capped at 1")
        story = self.tax.choose_fit("drainers", {"story": ["i lost"]})
        self.assertEqual((story[0]["channel"], story[0]["format"]), ("zoora-ai", "pov-story"))

    def test_language_weight_and_missing_crypto_context(self):
        self.assertEqual(self.tax.choose_fit("drainers", {}, 0.95)[0]["fit"], 0.95)
        no_crypto = self.tax.choose_fit("ai-trading-agents", {})
        with_crypto = self.tax.choose_fit("ai-trading-agents", {"crypto": ["crypto"]})
        self.assertAlmostEqual(no_crypto[0]["fit"], 0.7)
        self.assertEqual(with_crypto[0]["fit"], 1.0)

    def test_only_known_channel_formats(self):
        tax = classify.Taxonomy(helpers.load_json(helpers.TAXONOMY), {"zoora-security": ["explainer", "scam-of-the-week"], "zoora-ai": ["pov-story", "explainer"]}, set(helpers.SECURITY_EVERGREEN))
        for topic in tax.topics:
            for option in tax.choose_fit(topic["id"], {}):
                self.assertIn(option["format"], helpers.FORMATS[option["channel"]])


if __name__ == "__main__":
    unittest.main()
