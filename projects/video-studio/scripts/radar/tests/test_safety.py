import unittest

from radarlib import safety


class RedactPeople(unittest.TestCase):
    def redacted(self, text):
        return safety.redact_people(text)[0]

    def test_role_cues_and_known_names(self):
        self.assertEqual(self.redacted("Plaintiff Larry Pearl purchased TerraUSD on Coinbase shortly before the token collapsed."),
                         "Plaintiff [named person] purchased TerraUSD on Coinbase shortly before the token collapsed.")
        self.assertEqual(self.redacted("Binance founder Changpeng Zhao said the exchange would cover losses"),
                         "Binance founder [named person] said the exchange would cover losses")
        self.assertIn("[named person]", self.redacted("Judge Melissa Crane did not shut down the operations in a hearing"))
        self.assertEqual(self.redacted("Blockchain investigator ZachXBT posted on November 2"),
                         "Blockchain investigator [named person] posted on November 2")
        self.assertEqual(self.redacted("on-chain sleuth @ExampleSleuth flagged it"), "on-chain sleuth [named person] flagged it")

    def test_possessives_and_hyphen_suffixes_keep_grammar(self):
        self.assertEqual(self.redacted("Justin Sun's HTX was hit"), "[named person]'s HTX was hit")
        self.assertEqual(self.redacted("Eric Trump-backed American Bitcoin secures a loan"),
                         "[named person]-backed American Bitcoin secures a loan")
        self.assertEqual(self.redacted("Tom Lee Says Ethereum Is as Scarce as Bitcoin"),
                         "[named person] Says Ethereum Is as Scarce as Bitcoin")

    def test_age_honorific_and_according_to(self):
        out = self.redacted("Police arrested John Doe, 31, on Monday. Mr. Smith declined. according to Kevin Brown the funds moved")
        self.assertNotIn("John Doe", out)
        self.assertNotIn("Smith", out)
        self.assertNotIn("Kevin Brown", out)

    def test_organisations_places_and_title_case_are_left_alone(self):
        for text in (
            "Chainflip Founder Weighs Compensation After Vault Hack",
            "North Korea said nothing; Binance Research said it tracked funds",
            "Morgan Stanley and Charles Schwab declined to comment",
            "An Ethereum deposit sweep ran four hours after Mercado Bitcoin said contained",
            "security firm PeckShield flagged the exploit",
            "South Korean exchanges halt CYBER transfers",
            "A malicious ad campaign known as MoldyRoost can compromise iPhones",
            "Lighter user(s) exploited for $15 million",
        ):
            out, count = safety.redact_people(text)
            self.assertEqual(count, 0, out)
            self.assertEqual(out, text)

    def test_idempotent(self):
        once = self.redacted("CEO Jane Example said users would be repaid")
        twice, count = safety.redact_people(once)
        self.assertEqual(once, twice)
        self.assertEqual(count, 0)


class PersonPropagation(unittest.TestCase):
    """A name the redactor saw used for a person somewhere in the run is redacted everywhere in it (Quorvex is a
    made-up handle)."""

    def tokens(self, texts, known=None):
        found = []
        for text in texts:
            safety.redact_people(text, known, found=found)
        return safety.person_tokens(found, known)

    def test_person_evidence_decides_which_lone_words_spread(self):
        tokens = self.tokens([
            "Crypto trader Quorvex says his wallet was hacked",      # role word before, pronoun after
            "Glassnode said in a post that the drop was the first",  # a firm that "says": no evidence
            "Wiz Says Attacker Mined AI Coding Histories",
            "Exampleswap said it paused the pools",                  # "it" is not a person
            "an entity called Kruwex moved the funds",               # a pseudonym cue is evidence on its own
            "executive chairman Michael Saylor said on Nov. 23",      # a full name spreads as written
        ])
        self.assertEqual(tokens, {"Quorvex", "Kruwex", "Michael Saylor"})

    def test_pronoun_must_be_in_the_same_sentence(self):
        self.assertEqual(self.tokens(["Sonic says the supply mismatch is under review. He added nothing."]), set())
        self.assertEqual(self.tokens(["Quorvex said he is conducting a security review."]), {"Quorvex"})

    def test_known_organisations_never_spread(self):
        # a protocol in the run's incident databases is never a person, whatever a sentence says about "his"
        self.assertEqual(self.tokens(["Lighter said his team is reviewing it"], known={"lighter"}), set())

    def test_people_redacts_every_form_and_keeps_suffixes(self):
        people = safety.People({"Quorvex"})
        cases = {
            "Was Quorvex hacked? $2.15M moves to Arbitrum": "Was [named person] hacked? $2.15M moves to Arbitrum",
            "Tracker Flags Suspected Hack of Quorvex-Linked Wallet": "Tracker Flags Suspected Hack of [named person]-Linked Wallet",
            "Quorvex's wallet": "[named person]'s wallet",
            "QUORVEX MOVES": "[named person] MOVES",
            "@Quorvex posted": "[named person] posted",
        }
        for text, expected in cases.items():
            self.assertEqual(people.redact(text)[0], expected)
            self.assertTrue(people.mentioned(text))
        for text in ("Quorvexian Labs", "https://example.com/quorvex-wallet", "no names here"):
            self.assertEqual(people.redact(text), (text, 0))
            self.assertFalse(people.mentioned(text))
        self.assertEqual(safety.People().redact("Quorvex"), ("Quorvex", 0))

    def test_sanitize_applies_the_run_names(self):
        text, flags = safety.sanitize("Quorvex faces a suspected wallet hack", people=safety.People({"Quorvex"}))
        self.assertEqual(text, "[named person] faces a suspected wallet hack")
        self.assertEqual(flags["names"], 1)


class RedactCode(unittest.TestCase):
    def test_identifiers_calls_and_addresses(self):
        cases = {
            "flaw in totalAssets calculation": "flaw in [code] calculation",
            "drain the escrow via claim() calls": "drain the escrow via [code] calls",
            "call withdraw(uint256 amount) then set_minter": "call [code] then [code]",
            "sent to 0x3C5c2F4bCeC51a36494682f91Dbc6cA7c63B514C now": "sent to [address] now",
            "Solana addr 7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU here": "Solana addr [address] here",
            "use `upgradeToAndCall` here": "use [code] here",
        }
        for text, expected in cases.items():
            self.assertEqual(safety.redact_code(text)[0], expected)

    def test_token_and_product_names_survive(self):
        text = "wstETH, sBOLD, iPhone, zkSync, ankrFLOW, cLTC, stUSDS and user(s) and Wagyu (XMR1)"
        self.assertEqual(safety.redact_code(text), (text, 0))


class Flags(unittest.TestCase):
    def test_price_talk(self):
        self.assertTrue(safety.price_talk("Token price surges 40% after the hack"))
        self.assertTrue(safety.price_talk("analysts are bullish"))
        self.assertFalse(safety.price_talk("Chainflip confirms $12M hack"))
        self.assertFalse(safety.price_talk("Pump.fun to End External Wallet Login on Nov. 30"))
        self.assertTrue(safety.price_talk("Token pumps 300% overnight"))
        for text in ("creator coin plummets 55%", "his namesake token cratered", "the token slumped", "a coin nosedived"):
            self.assertTrue(safety.price_talk(text), text)

    def test_strong_hedge(self):
        self.assertEqual(safety.strong_hedge("amid suspected bridge exploit"), "suspected")
        self.assertEqual(safety.strong_hedge("the bridge experienced an anomaly"), "anomaly")
        self.assertIsNone(safety.strong_hedge("Chainflip was attacked on November 21, 2026."))

    def test_legal_terms_are_legal_only(self):
        self.assertEqual(safety.legal_terms("prosecutors filed a forfeiture complaint; alleged theft"),
                         ["alleged", "forfeiture", "prosecutors"])
        self.assertEqual(safety.legal_terms("the mechanism remains under investigation"), [])

    def test_check_generated(self):
        self.assertEqual(safety.check_generated("Chainflip: key compromise"), [])
        self.assertEqual(safety.check_generated("DefiLlama classifies it as Key Compromise / Validator Key Compromised."), [])
        problems = safety.check_generated("Price will pump; probably an inside job by John Smith via flashLoan()")
        self.assertIn("contains price or investment talk", problems)
        self.assertIn("contains speculation", problems)
        self.assertIn("contains a personal name", problems)
        self.assertIn("contains code, an address or a function name", problems)
        self.assertIn("looks like a step list", safety.check_generated("1. borrow\n2. swap"))


if __name__ == "__main__":
    unittest.main()
