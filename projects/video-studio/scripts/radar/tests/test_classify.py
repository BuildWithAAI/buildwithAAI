import unittest

from radarlib import classify

from .helpers import source


def item(title, excerpt="", url="https://x.test/a", kind="news", categories=()):
    return {"title": title, "excerpt": excerpt, "url": url, "kind": kind, "categories": list(categories)}


class Relevance(unittest.TestCase):
    def test_incident_topic_and_noise(self):
        news = source("coindesk")
        self.assertEqual(classify.relevance(item("Chainflip confirms $12M hack", "The cross-chain swap protocol paused."), news)[:2],
                         (True, True))
        url_only = item("Chainflip confirms $12M hack", url="https://cointelegraph.com/news/chainflip-12m-crypto-hack")
        self.assertEqual(classify.relevance(url_only, news)[:2], (True, True))
        self.assertFalse(classify.relevance(item("Chainflip confirms $12M hack"), news)[0], "no crypto context at all")
        pump = item("Pump.fun draws criticism over private key imports as it retires external wallet sign-in on web")
        self.assertEqual(classify.relevance(pump, news)[:2], (True, False))
        # "private keys" alone is not crypto context (a supercomputer's SSH keys, say)
        self.assertFalse(classify.relevance(item("RIKEN Confirms Theft of 430 Private Keys From Fugaku"), news)[0])
        self.assertEqual(classify.relevance(item("Bitcoin rebounds to $61K"), news)[:2], (False, False))

    def test_negated_breach_is_not_an_incident(self):
        text = item("Bitcoin briefly drops to $17K on Kraken, exchange upholds trades",
                    "Kraken said all orders were processed correctly and found no evidence of a security breach or compromised accounts.")
        self.assertEqual(classify.relevance(text, source("cointelegraph"))[:2], (False, False))

    def test_needs_crypto_context(self):
        ai = item("Citi Says Customers Are Responsible When AI Banking Agents Go Rogue, Even After a Hack",
                  "Citi updated its terms for AI agents acting on bank accounts.")
        self.assertFalse(classify.relevance(ai, source("decrypt"))[0])

    def test_source_rules(self):
        defiant = source("thedefiant")
        frontier = item("Wiz Says Attacker Mined AI Coding Histories for Logins", url="https://thedefiant.io/frontier/ai/wiz")
        self.assertFalse(classify.relevance(frontier, defiant)[0])
        section = item("Ten Under Formal Investigation in Paris Gold-Crypto Probe", url="https://thedefiant.io/news/security/ten")
        self.assertEqual(classify.relevance(section, defiant)[:2], (True, False))
        promo = item("TRM Labs Selected to Support New Federal Threat Disruption Center Targeting Scams",
                     url="https://www.trmlabs.com/resources/blog/x", kind="blog", categories=["Insights"])
        self.assertFalse(classify.relevance(promo, source("trm-blog"))[0])
        product = item("How Chain, Our AI Workspace, Helps Investigators", "The biggest hack in crypto history",
                       categories=["Crypto Hacks", "Product Announcement"])
        self.assertFalse(classify.relevance(product, source("chainalysis-blog"))[0])

    def test_outlet_host_is_not_crypto_context(self):
        breach = item("Samsung Securities confirms data breach affecting 8,241 clients",
                      "An intrusion into its customer feedback system exposed client data.",
                      url="https://crypto.news/samsung-securities-data-breach/")
        self.assertFalse(classify.relevance(breach, source("cryptonews"))[0])

    def test_laundering_alone_is_not_an_incident(self):
        text = item("FinCEN Bars U.S. Institutions From Moving Funds for MEXC Global", "Money laundering concerns for crypto flows.")
        self.assertFalse(classify.relevance(text, source("chainalysis-blog"))[1])


class Types(unittest.TestCase):
    def test_text_rules_in_priority_order(self):
        self.assertEqual(classify.type_from_text("Binance disclosed that a DPRK fake employment scheme... a fabricated job interview")[:2],
                         ("social-engineering", "fake-job-malware"))
        # malicious ads that compromise the device are not phishing: no explainer fits, so the type stays "other"
        self.assertEqual(classify.type_from_text("MoldyRoost ads can steal crypto wallet recovery phrases")[:2], ("other", None))
        self.assertEqual(classify.type_from_text("ads compromise vulnerable iPhones with a single tap")[:2], ("other", None))
        self.assertEqual(classify.type_from_text("a phishing site stole recovery phrases")[:2], ("phishing", "phishing"))
        self.assertEqual(classify.type_from_text("victims lost funds to address poisoning transfers")[:2], ("phishing", "address-poisoning"))
        self.assertEqual(classify.type_from_text("a wallet drainer kit emptied wallets")[:2], ("drainer", "drainers"))
        self.assertEqual(classify.type_from_text("Chainflip Suspects Key Theft in Vault Hack")[:2], ("key-compromise", "key-management"))
        self.assertEqual(classify.type_from_text("South Korean exchanges halt CYBER transfers amid suspected bridge exploit")[:2],
                         ("bridge", "bridge-security"))
        self.assertIsNone(classify.type_from_text("Bitcoin rebounds to $61K"))

    def test_advice_is_not_a_mechanism(self):
        self.assertIsNone(classify.type_from_text("Stake DAO Warns of Forum Breach. Users should watch for phishing."))

    def test_defillama_mapping(self):
        self.assertEqual(classify.type_from_defillama({"classification": "Key Compromise", "technique": "Validator Key Compromised"})[:2],
                         ("key-compromise", "key-management"))
        self.assertEqual(classify.type_from_defillama({"classification": "Frontend & Infrastructure", "technique": "DNS Hijack"})[:2],
                         ("phishing", "drainers"))
        self.assertEqual(classify.type_from_defillama({"classification": "Protocol Logic", "technique": "Unknown", "bridgeHack": True})[:2],
                         ("bridge", "bridge-security"))
        self.assertEqual(classify.type_from_defillama({"classification": "Rugpull", "technique": "Liquidity Rug"})[:2],
                         ("rug", "rug-pulls"))
        self.assertEqual(classify.type_from_defillama({"classification": "Access Control", "technique": "Improper Access Control"})[:2],
                         ("exploit", None))
        self.assertEqual(classify.type_from_slowmist("Private Key Leakage")[:2], ("key-compromise", "key-management"))
        self.assertIsNone(classify.type_from_slowmist("Unknown"))


class Subjects(unittest.TestCase):
    CASES = {
        "Chainflip confirms $12M hack, offers attacker 10% bounty": "Chainflip",
        "Kava Lend exploited for $3.8 million": "Kava Lend",
        "Mercado Bitcoin halts withdrawals after $40 million hack": "Mercado Bitcoin",
        "US seeks to recover $1.1B in crypto stolen in North Korea-linked Binance hack": "Binance",
        "North Korea Moves $247 Million of Binance Hack Loot Through Bitcoin Mixers": "Binance",
        "Lighter user(s) exploited for $15 million": "Lighter",
        "French bank Crédit Mutuel Arkéa hit in $133M crypto theft": "Crédit Mutuel Arkéa",
        "AI-focused Qubic blockchain halts after weak wallet seeds enable $1.4 million in thefts": "Qubic",
        "Trezor and Exodus wallets lose $600K in reported theft": "Trezor and Exodus",
        "Chainflip Suspects Key Theft in $12.6 Million Vault Hack": "Chainflip",
        "Chainflip Founder Weighs Compensation After Vault Hack": "Chainflip",
        "Stake DAO Warns of Forum Breach, Says Funds Unaffected": "Stake DAO",
        "Fusionist Urges ACE Trading Pause After Exploit Alert": "Fusionist",
        "Cyber Bridge Hack Followed LayerZero's Support Exit": "Cyber",
        "South Korean exchanges halt CYBER transfers amid suspected bridge exploit": "CYBER",
        "South Korea's DCENT to Shut App Wallet After Crypto Theft Reports Surface": "DCENT",
        "K3 Capital's yield-bearing sBOLD vault drained in flash loan attack": "K3 Capital",
        "North Korea hacks Binance for around $6.3 billion, some frozen": "Binance",
        "Polymarket users' funds stolen, again": "Polymarket",
        "Keystone to destroy 18,835 hardware wallets after website breach": "Keystone",
        "‘MoldyRoost’ ads can steal crypto wallet recovery phrases from iPhones": "MoldyRoost",
        "Hackers drain $5 million from Acme Finance": "Acme Finance",
        "Wrapped Monero Token Collapses 99% After $13 Million Hack Blamed on Web Host": "Wrapped Monero",
    }
    NONE = (
        "Crypto thieves are using online ads to infect iPhones with a single tap, research finds",
        "Fraudsters Used Fake Crypto Exchanges to Steal $37 Million, SEC Alleges",
        "Elliptic Traces About $247M in Binance Theft-Linked Bitcoin to Coinjoins",
        "DPRK Hackers Perfected Their Fake Interview Playbook Over Dozens of Attacks Before Binance",
    )

    def test_subjects(self):
        for title, expected in self.CASES.items():
            with self.subTest(title=title):
                self.assertEqual(classify.extract_subject(title)[0], expected)
        for title in self.NONE:
            with self.subTest(title=title):
                self.assertIsNone(classify.extract_subject(title)[0])

    def test_publisher_is_never_the_subject(self):
        title = "CertiK Uncovers PolinRider-Linked Malware in a Smart Contract Development Workflow"
        self.assertEqual(classify.extract_subject(title, exclude={"certik"})[0], "PolinRider")


class Amounts(unittest.TestCase):
    def amounts(self, text):
        return [v for v, _ in classify.reported_amounts(text)]

    def test_losses(self):
        self.assertEqual(self.amounts("Chainflip confirms $12M hack"), [12e6])
        self.assertEqual(self.amounts("Kava Lend exploited for $3.8 million"), [3.8e6])
        self.assertEqual(self.amounts("Chainflip Suspects Key Theft in $12.6 Million Vault Hack"), [12.6e6])
        self.assertEqual(self.amounts("French bank hit in $133M crypto theft"), [133e6])
        self.assertEqual(self.amounts("weak wallet seeds enable $1.4 million in thefts"), [1.4e6])
        self.assertEqual(self.amounts("An attacker withdrew $10.39 million USDC from Lighter"), [10.39e6])
        self.assertEqual(self.amounts("Trezor and Exodus wallets lose $600K in reported theft"), [600e3])

    def test_not_losses(self):
        for text in (
            "US seeks to recover $1.1B in crypto stolen in North Korea-linked Binance hack",
            "North Korea Moves $247 Million of Binance Hack Loot Through Bitcoin Mixers",
            "Binance obtains $6.5 billion freezing order for stolen crypto",
            "DOJ seeks $1.17 billion in USDC tied to Binance hack",
            "Binance hackers push $247 million through transactions",
            "Chainflip offers a $1.2 million bounty",
            "Bitcoin sold for $17,000 on Kraken",
        ):
            with self.subTest(text=text):
                self.assertEqual(self.amounts(text), [])

    def test_excerpt_skips_other_incidents(self):
        text = ("On November 2, as the project came back online from a previous $2.7 million exploit, it tweeted. "
                "This time the exploiter stole $3.27 million. Another account may have lost $5.1 million.")
        self.assertEqual([v for v, _ in classify.excerpt_amounts(text)], [3.27e6])


class Misc(unittest.TestCase):
    def test_follow_up_cues(self):
        self.assertEqual(classify.follow_up("DOJ seeks $1.17 billion tied to Binance hack"), "tied to")
        self.assertEqual(classify.follow_up("Elliptic Traces About $247M in Binance Theft-Linked Bitcoin"), "traces")
        self.assertIsNone(classify.follow_up("Chainflip confirms $12M hack"))

    def test_chains(self):
        self.assertEqual(classify.chains_in_text("minted on Solana, then released on Ethereum and BSC"),
                         ["Solana", "Ethereum", "BNB Chain"])
        self.assertEqual(classify.normalize_chain("Binance"), "BNB Chain")

    def test_cues(self):
        self.assertIn("users", classify.retail_cues("users should reset access"))
        self.assertIn("market maker", classify.institutional_cues("one market maker account was emptied"))


if __name__ == "__main__":
    unittest.main()
