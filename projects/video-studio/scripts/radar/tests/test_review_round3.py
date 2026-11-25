"""Regression tests for the third pass of the AI-lane review (2026-11-25): one test per finding fixed, each a case that
failed before its fix.

  * statements: a project's statement confirms its incident only when what it says affirms the incident (no denial,
    inquiry, hedge or report of others' words), never a headline passive ("Bybit said targeted by ..."), never another
    party's words ("according to Bybit users"); denials and "no evidence of a breach" walk a report back;
  * origins: an inline tag never joins a name to the next sentence ("GitGuardian.The"); an origin, a statement or a
    status line never carries a person's name (outlet ids instead), and a full name's surname spreads run-wide;
  * clustering: one shared word or generic impact words never make two issues of one product one confirmed incident;
  * links: a person's name with an age, a figure or a plain word after it in a slug is withheld, a product's version
    and product words are not;
  * redaction: a single name after a person-only role word, a name with an age, a name before a legal action, a
    surname before a group or scheme noun, a name after a legal action's entity, and handles that did an attack;
  * subjects: a person's handle or name is never an AI or crypto incident's subject (quotes, brackets, appositions,
    "known online as", plural person words, a legal action next to it, a person word opening it), an attacker group
    is never the party hit, and an AI name a person can have is a subject only with a product cue; personRisk exported;
  * owner review: a sexual-image story is held in every lane, the crypto lane included;
  * carried sources: an entry carried from an earlier run is redacted and its link withheld under today's names.
"""

import datetime as dt
import json
import os
import unittest

from radarlib import classify, cluster, history, safety
from radarlib.textutil import html_to_text

from .test_regressions import Scenario, llama


def pub(day, hour=10):
    d = dt.date.fromisoformat(day)
    return dt.datetime(d.year, d.month, d.day, hour, tzinfo=dt.timezone.utc).strftime("%a, %d %b %Y %H:%M:%S +0000")


def news(title, url, day, desc="", hour=10):
    return {"title": title, "url": url, "pub": pub(day, hour), "desc": desc}


# ---------------------------------------------------------------- statements and walk-backs

NOT_STATEMENTS = (
    # (text, headline): the project speaks, but confirms nothing (repro-statement-not-a-confirmation)
    ("Bybit said it is looking into reports of unusual outflows from a cold wallet.", False),
    ("Bybit said it had seen no evidence of a breach and that client funds were safe.", False),
    ("Bybit said it wasn't hacked and called the outflow a planned wallet move.", False),
    ("The stolen funds moved to new wallets, according to the Bybit exploiter's onchain message.", False),
    ("Withdrawals stalled for hours, according to Bybit users on social media.", False),
    ("Funds left the cold wallet, according to Bybit critics who flagged the outflow.", False),
    ("Bybit says it is looking into reports of a $1.5 billion hack", True),
    ("Radiant Capital says it is reviewing reports of a $50 million exploit", True),
    ("Bybit says it is monitoring a reported $1.5 billion cold wallet hack", True),
    ("Bybit reports emerge of $1.5 billion cold wallet hack", True),
    ("Bybit reports of a $1.5 billion hack spread on social media", True),
    ("Bybit warns users after reports of a $1.5 billion hack", True),
    ("Bybit says withdrawals paused while it checks reports of $1.5 billion hack", True),
    # headline passives about the project, not by it (repro-statement-passive-participles)
    ("Bybit said targeted by Lazarus in $1.5 billion hack", True),
    ("Bybit confirmed victim of $1.5 billion cold wallet hack", True),
    ("Bybit confirmed among victims of $1.5 billion Lazarus hack", True),
    ("Bybit said infiltrated by hackers who stole $1.5 billion", True),
    ("Radiant Capital confirmed affected by $50 million multisig exploit", True),
    ("Moonwell confirmed impacted by $1 million oracle exploit", True),
    # a research firm first, then the project's hedged or denying words (regress-statement-any-speech-confirms)
    ("PeckShield flagged $30 million in outflows from the exchange's Solana hot wallet. Upbit said it is investigating "
     "and has paused deposits.", False),
    ("Arkham's data shows $1.5 billion left the cold wallet. Bybit said it is looking into unusual activity.", False),
    ("Lookonchain's data shows $3 million moved out overnight. Kraken said the drained wallet does not belong to the "
     "exchange.", False),
)


class Statements(unittest.TestCase):
    def test_words_that_confirm_nothing_are_no_statement(self):
        for text, headline in NOT_STATEMENTS:
            with self.subTest(text=text):
                self.assertIsNone(classify.statement_of(text, "The Defiant", headline=headline))

    def test_words_that_affirm_the_incident_still_are(self):
        for text, headline, name in (
                ("Chainflip confirms $12M hack, offers attacker 10% bounty", True, "chainflip"),
                ("Abracadabra says it was exploited for $13 million", True, "abracadabra"),
                ("Bybit confirms $1.5 billion hack, says no user funds were lost", True, "bybit"),
                ("Bybit said on Friday that hackers drained its cold wallet.", False, "bybit"),
                ("Bullpen reports unauthorized transfers in 18 accounts", True, "bullpen"),
                ("Attackers drained the cold wallet, according to Bybit.", False, "bybit")):
            with self.subTest(text=text):
                self.assertEqual(classify.statement_of(text, "CoinDesk", headline=headline), name)

    def test_denials_and_no_evidence_walk_a_report_back(self):
        for text in ("Kraken denies $3 million hot wallet hack", "Bybit said it wasn't hacked.",
                     "The exchange hasn't been breached, it said.", "Bybit said it had seen no evidence of a breach.",
                     "Kraken said the drained wallet does not belong to the exchange.",
                     "Upbit said its systems were not compromised."):
            with self.subTest(text=text):
                self.assertTrue(cluster.RETRACT_RE.search(text))
        # "no user funds were affected" is said about real hacks of an exchange's own wallets: not a walk-back
        self.assertIsNone(cluster.RETRACT_RE.search("Bybit said no user funds were affected by the hack."))


class StatementPipelines(Scenario):
    def test_one_outlet_relaying_words_that_confirm_nothing_stays_developing(self):
        cases = (
            ("thedefiant", "Bybit Reported Hacked for $1.5 Billion",
             "Bybit said it is looking into reports of unusual outflows from a cold wallet.", "Bybit"),
            ("thedefiant", "Bybit Reported Hacked for $1.5 Billion",
             "Bybit said it had seen no evidence of a breach and that client funds were safe.", "Bybit"),
            ("coindesk", "Bybit hacked for $1.5 billion in cold wallet exploit",
             "The stolen funds moved to new wallets, according to the Bybit exploiter's onchain message.", "Bybit"),
            ("coindesk", "Bybit says it is looking into reports of a $1.5 billion hack",
             "Onchain sleuths flagged outflows from the exchange's cold wallet.", "Bybit"),
            ("coindesk", "Bybit said targeted by Lazarus in $1.5 billion hack",
             "Onchain data shows $1.5 billion left the exchange's cold wallet.", "Bybit"),
            ("theblock", "Radiant Capital confirmed affected by $50 million multisig exploit",
             "Onchain data shows $50 million left the protocol.", "Radiant Capital"),
            ("thedefiant", "Upbit Loses $30 Million in Hot Wallet Hack",
             "PeckShield flagged $30 million in outflows from the exchange's Solana hot wallet. Upbit said it is "
             "investigating and has paused deposits.", "Upbit"),
            ("thedefiant", "Kraken Loses $3 Million in Hot Wallet Hack",
             "Lookonchain's data shows $3 million moved out overnight. Kraken said the drained wallet does not belong "
             "to the exchange.", "Kraken"),
        )
        for n, (sid, title, excerpt, protocol) in enumerate(cases):
            with self.subTest(title=title, excerpt=excerpt):
                doc = self.run_radar("2026-11-24", None, {sid: [news(title, f"https://example.test/s{n}", "2026-11-23",
                                                                     excerpt)]}, name=f"case{n}")
                inc = self.only(doc, protocol)[0]
                self.assertEqual(inc["status"], "developing", inc["statusReason"])
                self.assertIn("(developing)", inc["title"])
                self.assertNotIn("own statement", inc["statusReason"])

    def test_a_denial_headline_is_a_walk_back(self):
        doc = self.run_radar("2026-11-24", None, {"coindesk": [news(
            "Kraken denies $3 million hot wallet hack", "https://example.test/deny", "2026-11-23",
            "Kraken said the drained wallet does not belong to the exchange and user funds are safe.")]})
        inc = self.only(doc, "Kraken")[0]
        self.assertEqual(inc["status"], "developing")
        self.assertIn("walks the report back", inc["statusReason"])


# ---------------------------------------------------------------- origins

class Origins(unittest.TestCase):
    def test_an_inline_tag_never_joins_a_name_to_the_next_sentence(self):
        self.assertEqual(html_to_text("research by <a href='x'>GitGuardian</a>.<span>The firm found</span>"),
                         "research by GitGuardian. The firm found")
        self.assertEqual(html_to_text("research by GitGuardian.</span><span>The firm"), "research by GitGuardian. The firm")
        self.assertEqual(html_to_text("Crypto.<b>com</b> users"), "Crypto.com users")
        self.assertEqual(classify.origin_of("Secrets leaked, according to research by GitGuardian.The firm found 31,088 "
                                            "secrets.", "SecurityWeek"), "gitguardian")
        self.assertEqual(classify.origin_of("Funds moved, according to Crypto.com.", "CoinDesk"), "crypto.com")

    def test_a_surname_spreads_with_its_full_name(self):
        found = []
        safety.redact_people("Security researcher Lena Weiss reported the flaw to the vendor.", found=found)
        tokens = safety.person_tokens(found)
        self.assertIn("Weiss", tokens)
        self.assertEqual(safety.People(tokens).redact("Weiss found that a poisoned README could steer the agent.")[0],
                         "[named person] found that a poisoned README could steer the agent.")

    def test_an_origin_or_statement_is_never_a_persons_name(self):
        people = safety.People({"Lena Weiss", "Weiss"})
        for name in ("weiss", "lena weiss", "kruw"):
            with self.subTest(name=name):
                self.assertFalse(cluster._org_name_ok(name, people))
        for name in ("gitguardian", "bybit", "stake dao", "crypto.com", "osmosis"):
            with self.subTest(name=name):
                self.assertTrue(cluster._org_name_ok(name, people))


class OriginPipelines(Scenario):
    def test_no_name_in_an_origin_a_statement_or_the_status_line(self):
        cases = {
            "surname": {
                "darkreading": [news("Cursor Patches Prompt Injection Bug That Exposed Developer Secrets",
                                     "https://www.darkreading.com/application-security/cursor-patches-prompt-injection-bug",
                                     "2026-11-23", "Cursor patched a prompt injection bug that exposed developer secrets. "
                                     "Security researcher Lena Weiss reported the flaw to the vendor. Weiss found that "
                                     "a poisoned README could steer the agent.", 14)],
                "therecord": [news("Cursor fixes prompt injection bug that exposed developer secrets",
                                   "https://therecord.media/cursor-prompt-injection-bug-fixed", "2026-11-23",
                                   "Weiss found that a poisoned README file could make the Cursor agent read and leak "
                                   "secrets; Weiss confirmed the fix works.", 16)]},
            "title-case": {
                "securityweek": [news("Lena Weiss Finds Prompt Injection Flaw In Cursor",
                                      "https://www.securityweek.com/prompt-injection-flaw-cursor/", "2026-11-23",
                                      "A prompt injection flaw in Cursor let a malicious repository make the coding agent "
                                      "leak secrets.")],
                "darkreading": [news("Lena Weiss Discovers Cursor Prompt Injection Bug",
                                     "https://www.darkreading.com/application-security/cursor-prompt-injection-bug",
                                     "2026-11-23", "A poisoned README could steer the Cursor agent into leaking developer "
                                     "secrets.", 14)]},
        }
        for name, feeds in cases.items():
            with self.subTest(case=name):
                doc = self.run_radar("2026-11-24", None, feeds, name=name)
                text = json.dumps(doc, ensure_ascii=False)
                self.assertNotIn("Weiss", text)
                self.assertNotIn("weiss", text)
                inc = self.only(doc, "Cursor")[0]
                # one researcher relayed by two outlets is one origin: still developing, and the outlets are named
                self.assertEqual(inc["status"], "developing", inc["statusReason"])
                self.assertRegex(inc["statusReason"], r"relay one origin \((?:darkreading|securityweek), "
                                                      r"(?:darkreading|securityweek|therecord)\)")
                for src in inc["sources"]:
                    self.assertNotIn("origin", src)
                    self.assertNotIn("statement", src)

    def test_an_inline_tag_never_makes_two_origins(self):
        doc = self.run_radar("2026-11-24", None, {
            "bleepingcomputer": [news("Claude Code settings leaked 31,000 developer secrets on GitHub",
                                      "https://www.bleepingcomputer.com/news/security/claude-code-secrets-github/",
                                      "2026-11-23", "Claude Code settings files leaked secrets on GitHub, according to "
                                      "research by GitGuardian.", 15)],
            "securityweek": [news("Claude Code Settings Leak 31,000 Developer Secrets On GitHub",
                                  "https://www.securityweek.com/claude-code-secrets-github/", "2026-11-23",
                                  "Thousands of developer secrets leaked, according to research by "
                                  "<a href='https://gitguardian.example'>GitGuardian</a>.<span>The firm found 31,088 "
                                  "secrets.</span>", 14)]})
        inc = self.only(doc, "Claude Code")[0]
        self.assertEqual(inc["status"], "developing", inc["statusReason"])
        self.assertEqual({s.get("origin") for s in inc["sources"]}, {"gitguardian"})


# ---------------------------------------------------------------- clustering

class SameIssue(Scenario):
    def pair(self, a, b, name, a_day="2026-11-23", b_day="2026-11-23"):
        return self.run_radar("2026-11-24", None, {
            "bleepingcomputer": [news(a[0], f"https://www.bleepingcomputer.com/news/security/{name}-a/", a_day, a[1], 15)],
            "securityweek": [news(b[0], f"https://www.securityweek.com/{name}-b/", b_day, b[1], 14)]}, name=name)

    def test_distinct_issues_of_one_product_stay_apart(self):
        cases = {
            "cline-extension": ("Cline", ("Malicious extension hijacked Cline agent through a poisoned README",
                                          "A malicious VS Code extension hijacked the Cline agent."),
                                ("Cline Extensions Flaw Let Websites Hijack The Agent's Browser",
                                 "A Cline browser flaw let websites hijack the agent.")),
            "copilot-calendar": ("Copilot Chat", ("Copilot Chat flaw leaked emails and exposed private data",
                                                  "A Copilot Chat flaw in the Outlook integration exposed private data "
                                                  "and leaked emails."),
                                 ("Copilot Chat Bug Exposed Data Through Malicious Calendar Invites",
                                  "A different Copilot Chat bug exposed data when a malicious calendar invite was "
                                  "summarised.")),
            "chatgpt-payment": ("ChatGPT", ("OpenAI says ChatGPT bug exposed some users' payment data",
                                            "OpenAI said a bug in an open-source library exposed some ChatGPT Plus "
                                            "users' payment data and chat titles."),
                                ("ChatGPT Plugin Flaws Exposed User Data and Accounts",
                                 "Researchers found flaws in ChatGPT plugins that could expose user data and allow "
                                 "account takeover.")),
            "chatgpt-history": ("ChatGPT", ("ChatGPT bug exposed users' chat history to other users",
                                            "A caching bug in ChatGPT exposed the chat history of some users to others."),
                                ("ChatGPT Plugin Flaw Leaked Customer Data And Exposed Conversation History",
                                 "A third-party ChatGPT plugin leaked customer data and exposed conversation history.")),
            "claude-cve-sandbox": ("Claude Code", ("Anthropic fixes Claude Code flaw that exposed developer secrets "
                                                   "(CVE-2026-41234)", "Anthropic fixed CVE-2026-41234, a Claude Code "
                                                   "flaw that exposed developer secrets."),
                                   ("Claude Code Sandbox Escape Exposed Secrets on Developer Machines",
                                    "A sandbox escape in Claude Code exposed secrets stored on developer machines.")),
        }
        for name, (protocol, a, b) in cases.items():
            with self.subTest(case=name):
                doc = self.pair(a, b, name)
                found = [i for i in self.incidents(doc) if i["protocol"] == protocol]
                self.assertEqual(len(found), 2, [(i["title"], i["status"]) for i in found])
                self.assertTrue(all(i["status"] == "developing" for i in found))

    def test_one_flaw_from_two_outlets_is_still_one_confirmed_incident(self):
        doc = self.pair(("Anthropic fixes Claude Code flaw that exposed developer secrets",
                         "Anthropic fixed a Claude Code flaw that exposed developer secrets."),
                        ("Claude Code Flaw Exposed Secrets of Thousands of Developers",
                         "A Claude Code flaw exposed secrets of thousands of developers, Anthropic said."), "one-flaw")
        found = [i for i in self.incidents(doc) if i["protocol"] == "Claude Code"]
        self.assertEqual(len(found), 1)
        self.assertEqual(found[0]["status"], "confirmed", found[0]["statusReason"])


# ---------------------------------------------------------------- links

class Slugs(unittest.TestCase):
    WITHHELD = {
        "Claude": ("https://news.example.org/2026/11/22/claude-72-lost-40000-to-ai-voice-clone",
                   "https://news.example.org/retiree-claude-72-loses-40000-in-ai-voice-scam",
                   "https://news.example.org/grandfather-claude-ai-voice-clone-scam",
                   "https://news.example.org/scam-victim-claude-for-years-trusted-his-grandson",
                   "https://www.bleepingcomputer.com/news/security/claude-for-weeks-trusted-a-cloned-voice-elevenlabs-scam/",
                   "https://www.bleepingcomputer.com/news/security/claude-2-grandson-voice-clone-scam-elevenlabs/",
                   "https://www.bleepingcomputer.com/news/security/claude-67-lost-40000-to-ai-voice-clone-scam/"),
        "Kiro": ("https://news.example.org/kiro-19-arrested-over-ai-phishing-kit/", "https://news.example.org/kiro-live-scam"),
        "Devin": ("https://news.example.org/devin-pro-trader-scammed",),
    }
    KEPT = ("https://www.bleepingcomputer.com/news/security/anthropic-fixes-claude-code-flaw-secrets/",
            "https://example.com/news/claude-opus-4-1-jailbreak/", "https://example.com/news/claude-desktop-bug/",
            "https://example.com/news/claude-for-chrome-flaw/", "https://example.com/news/claude-3-5-sonnet-jailbreak/",
            "https://example.com/news/sora-2")

    def test_an_age_a_figure_or_a_plain_word_after_the_name_withholds_the_link(self):
        for name, urls in self.WITHHELD.items():
            for url in urls:
                with self.subTest(url=url):
                    self.assertTrue(safety.url_names_person(url, {name}))

    def test_product_words_and_versions_keep_the_link(self):
        for url in self.KEPT:
            with self.subTest(url=url):
                self.assertFalse(safety.url_names_person(url, {"Claude", "Sora"}))

    def test_the_run_wide_token_follows_the_same_rule(self):
        people = safety.People({"Claude"})
        self.assertEqual(people.redact("Claude For Weeks Trusted A Cloned Voice")[0],
                         "[named person] For Weeks Trusted A Cloned Voice")
        self.assertEqual(people.redact("Claude 72 lost money")[0], "[named person] 72 lost money")
        for text in ("Claude Code said", "Claude for Chrome leaks", "Claude Opus 4 jailbreak", "Claude 3.5 Sonnet"):
            with self.subTest(text=text):
                self.assertEqual(people.redact(text), (text, 0))


class SlugPipelines(Scenario):
    def test_a_name_and_age_slug_is_withheld_when_the_name_is_a_person_token(self):
        doc = self.run_radar("2026-11-24", None, {
            "aiid": [news("Retiree says cloned voice of grandson tricked him into wiring $40,000",
                          "https://news.example.org/2026/11/22/cloned-voice-grandson", "2026-11-23",
                          "Claude said he lost $40,000 after a call that used an AI voice clone of his grandson.")],
            "bleepingcomputer": [news("Retiree, 67, lost $40,000 to an AI voice-clone scam, police say",
                                      "https://www.bleepingcomputer.com/news/security/claude-67-lost-40000-to-ai-voice-clone-scam/",
                                      "2026-11-23", "A 67-year-old said a caller used an AI clone of his grandson's "
                                      "voice to ask for $40,000.", 14)]})
        self.assertNotIn("claude-67", json.dumps(doc))


# ---------------------------------------------------------------- redaction

class Redaction(unittest.TestCase):
    REDACTED = {
        # role + one name (repro-radar-role-name-unredacted, privacy-radar-role-single-name)
        "Victim Kiro loses $40,000 to ElevenLabs voice clone scam": "Kiro",
        "Victim Kiro Loses $40,000 To ElevenLabs Voice Clone Scam": "Kiro",
        "Trader Mateo Loses $1.2M In Fake Uniswap Phishing": "Mateo",
        "Crypto Investor Kiro Loses $2 Million To Address Poisoning": "Kiro",
        "Researcher Lena Weiss Finds Prompt Injection Flaw In Coding Agent": "Weiss",
        "Hacker 'Sora' Sold Access Stolen With AI Phishing Kit": "Sora",
        "Teen Hacker Cline Arrested Over AI Chatbot Breach": "Cline",
        "Victim Kevin lost $40,000 to a cloned voice.": "Kevin",
        "Retiree Kevin lost $40,000 to a cloned voice.": "Kevin",
        "Nurse Kiro Loses $40,000 To ElevenLabs Voice Clone Scam": "Kiro",
        "Victim, Kiro, Loses $40,000 To ElevenLabs Voice Clone Scam": "Kiro",
        "Victim (Kiro) Loses $40,000 To ElevenLabs Voice Clone Scam": "Kiro",
        "Victim «Kiro» Loses $40,000 To ElevenLabs Voice Clone Scam": "Kiro",
        "Kiro, A Retiree, Loses $40,000 To ElevenLabs Voice Clone Scam": "Kiro",
        "Ransomware Operator 'Cline' Leaks Data From AI Startup": "Cline",
        # one name and an age
        "Kevin, 72, said he lost $40,000.": "Kevin",
        "Claude, 72, said he lost $40,000.": "Claude",
        "A retiree, Kevin, 72, said he lost $40,000.": "Kevin",
        "Kiro (19) Arrested Over AI Phishing Kit": "Kiro",
        # a name before a legal action (privacy-name-before-legal-verb)
        "Lena Weiss Arrested Over AI Chatbot Breach": "Weiss",
        "Ruslan Astamirov sentenced over LockBit ransomware attacks": "Astamirov",
        "Ruslan Astamirov Sentenced Over LockBit Ransomware Attacks": "Astamirov",
        "Wang Xiaoming Extradited Over $40M Crypto Laundering": "Xiaoming",
        "Aleksei Burkov Charged Over Darknet Market": "Burkov",
        "Lena Weiss pleads guilty to wire fraud": "Weiss",
        "Lena Weiss was charged with fraud": "Weiss",
        # a surname before a group or scheme noun (repro-legal-surname-entity-noun, regress-legal-entity-noun-surname)
        "Police Arrest Kwon Associate Over Terra Collapse": "Kwon",
        "Feds Charge Tanaka Crew Over $5 Million SIM Swap Thefts": "Tanaka",
        "Police Arrest Nakamura Gang Leader Over Crypto Kidnapping": "Nakamura",
        "Feds Charge Weiss Scheme Promoter Over $3 Million Fraud": "Weiss",
        "Police Arrest Kowalski Ring Over Crypto ATM Scams": "Kowalski",
        "Police Arrest Min Gang Over $3 Million Crypto Theft": "Min",
        "Prosecutors Charge Jian Admin Over Darknet Market": "Jian",
        "Police Arrest Wang Ring Over Crypto Laundering": "Wang",
        # a name after a legal action's entity or role
        "Police Arrest Hyperverse Promoter Wang Xiaoming Over Crypto Scheme": "Xiaoming",
        "Treasury Sanctions Sinbad Mixer Operator Kim Il Over Laundering": "Kim",
        # a Title Case headline opening with a name and a person's verb; handles that did an attack
        "Lena Weiss Finds Prompt Injection Flaw In Cursor": "Weiss",
        "Kiro Tanaka Loses $40,000 To ElevenLabs Voice Clone Scam": "Tanaka",
        "AI Chatbot Data Leaked By IntelBroker": "IntelBroker",
        "Hacker Known Only As 'IntelBroker' Leaks AI Chatbot Logs": "IntelBroker",
        "Teenager Kiberphant0m Leaks AI Chatbot Logs": "Kiberphant0m",
        "Gamer Known Online as Sora Sold Stolen ChatGPT Accounts": "Sora",
    }
    KEPT = (
        "Treasury Sanctions Sinbad Mixer Over Lazarus Laundering",
        "Police Arrest Hyperverse Promoter Over $1.7 Billion Crypto Scheme",
        "DOJ Charges Tornado Cash Developers Over Laundering",
        "Tornado Cash Developer Charged Over Laundering",
        "North Korean Hackers Charged Over Crypto Theft",
        "Two Men Charged Over Crypto Scam",
        "Check Point Finds New Phishing Campaign Targeting AI Users",
        "Researcher Finds Prompt Injection Flaw In Cursor",
        "Chainflip Founder Weighs Compensation After Vault Hack",
        "AI developer Cline patched the flaw",
        "Coding agent Claude Code leaked secrets",
        "Developer Called Cursor Agent a Risk After Repo Secrets Leaked",
        "Coinbase, a crypto exchange, said it would reimburse users",
        "Dunamu, the operator of Upbit, said it would reimburse users",
        "Feds Suspect Ransom Negotiator Ran ShinyHunters Extortion Site",
    )

    def test_people_are_redacted(self):
        for text, name in self.REDACTED.items():
            with self.subTest(text=text):
                found = []
                out, n = safety.redact_people(text, found=found)
                self.assertGreater(n, 0, out)
                self.assertNotIn(name, out)
                self.assertTrue(any(strong for _, strong in found))

    def test_organisations_products_and_title_words_are_kept(self):
        for text in self.KEPT:
            with self.subTest(text=text):
                self.assertEqual(safety.redact_people(text), (text, 0))


class RedactionPipelines(Scenario):
    def test_a_role_and_a_name_withhold_the_link_and_never_name_an_incident(self):
        doc = self.run_radar("2026-11-24", None, {
            "bleepingcomputer": [news("Victim Kiro loses $40,000 to ElevenLabs voice clone scam",
                                      "https://www.bleepingcomputer.com/news/security/victim-kiro-loses-40000-to-elevenlabs-voice-clone-scam/",
                                      "2026-11-23", "Scammers used an ElevenLabs voice clone of a relative to convince the "
                                      "victim to wire $40,000, police said.")],
            "securityweek": [news("ElevenLabs Voice Clones Used In $40,000 Family Emergency Scam",
                                  "https://www.securityweek.com/elevenlabs-voice-clones-used-in-40000-family-emergency-scam/",
                                  "2026-11-23", "A voice clone made with ElevenLabs was used in a family emergency scam "
                                  "that cost the victim $40,000.", 14)]})
        text = json.dumps(doc, ensure_ascii=False)
        self.assertNotIn("Kiro", text)
        self.assertNotIn("kiro", text)
        bleeping = [s for i in self.incidents(doc) for s in i["sources"] if s["id"] == "bleepingcomputer"]
        self.assertEqual([(s["url"], s.get("urlWithheld")) for s in bleeping],
                         [("https://www.bleepingcomputer.com/", "names a person")])


# ---------------------------------------------------------------- subjects

class Subjects(unittest.TestCase):
    NONE = (
        # repro-ai-subject-person-variants
        "Hacker «Sora» Sold Access Stolen With AI Phishing Kit",
        "Hacker (Sora) Sold Access Stolen With AI Phishing Kit",
        "Hacker, Sora, Sold Access Stolen With AI Phishing Kit",
        "Hacker — 'Sora' — Sold Access Stolen With AI Phishing Kit",
        "Hackers 'Sora' and 'Kiro' Sold Access Stolen With AI Phishing Kit",
        "Teenager 'Sora' Sold Access Stolen With AI Phishing Kit",
        "Teenager Sora Arrested Over AI Deepfake Scam",
        "Cybercriminal 'Kiro' Leaks Data From AI Chatbot Vendor",
        "Ransomware Operator 'Cline' Leaks Data From AI Startup",
        "Kiro, a hacker from Ohio, leaked data stolen from an AI chatbot vendor",
        # privacy-ai-subject-cue-gaps
        "FBI Arrests Kiro, Hacker Behind AI Phishing Kit",
        "'Sora' The Hacker Leaks AI Chatbot Logs",
        "Sora, Hacker Behind AI Chatbot Breach, Arrested",
        "Kiro (19) Arrested Over AI Phishing Kit",
        "Teenager Kiro Leaks AI Chatbot Logs",
        "Hackers Led By 'Kiro' Breach AI Startup",
        "AI Chatbot Data Leaked By IntelBroker",
        "Hacker Known Only As 'IntelBroker' Leaks AI Chatbot Logs",
        "Teenager Kiberphant0m Leaks AI Chatbot Logs",
        "Teen Known Online as 'Claude' Arrested Over AI Voice-Clone Scams",
        "Hacker Behind 'Kiro' Alias Leaks AI Chatbot Logs",
        # repro-ai-subject-actor-distinctive-token
        "ShinyHunters Breaches AI Startup, Steals Customer Chats",
        "ShinyHunters Breaches AI Startup's Chatbot Database",
        "ShinyHunters Strikes AI Startup, Steals Customer Chats",
        "Hacking Group ShinyHunters Breaches AI Startup",
        # privacy-name-before-legal-verb
        "Lena Weiss Arrested Over AI Chatbot Breach",
    )
    NOT_THE_PERSON = {
        # a person's name never; the product the story is about may be
        "Gamer Known Online as Sora Sold Stolen ChatGPT Accounts": "Sora",
        "Hacker Known Only As 'Sora' Sold Stolen ChatGPT Accounts": "Sora",
        "'Sora' Hacker Sold Stolen ChatGPT Accounts": "Sora",
        "Sora the Hacker Sold Stolen ChatGPT Accounts": "Sora",
        "Nurse Kiro Loses $40,000 To ElevenLabs Voice Clone Scam": "Kiro",
        "Victim, Kiro, Loses $40,000 To ElevenLabs Voice Clone Scam": "Kiro",
        "Kiro Loses $40,000 To ElevenLabs Voice Clone Scam": "Kiro",
    }
    KEEP = {
        "Developer Called Cursor Agent a Risk After Repo Secrets Leaked": "Cursor",  # regress-naming-verb-overcorrection
        "Claude Tricked Into Leaking Data via Prompt Injection": "Claude",
        "Breaking Opus 4.7 with ChatGPT (Hacking Claude's Memory)": "Claude",
        "Sora 2 Deepfakes Used In Investment Scam": "Sora",
        "An AI model named Sora was abused to make deepfake ads": "Sora",
        "A tool called Cursor leaked secrets through a prompt injection": "Cursor",
    }

    def test_people_handles_and_attackers_are_never_ai_subjects(self):
        for title in self.NONE:
            with self.subTest(title=title):
                self.assertEqual(classify.extract_ai_subject(title), (None, None))
        for title, name in self.NOT_THE_PERSON.items():
            with self.subTest(title=title):
                self.assertNotEqual(classify.extract_ai_subject(title)[0], name)

    def test_products_keep_their_subject(self):
        for title, expected in self.KEEP.items():
            with self.subTest(title=title):
                self.assertEqual(classify.extract_ai_subject(title)[0], expected)

    def test_a_person_word_never_opens_a_crypto_subject(self):
        for title in ("Crypto Investor Kiro Loses $2 Million To Address Poisoning",
                      "Trader Mateo Loses $1.2M In Fake Uniswap Phishing",
                      "Retiree Tanaka Loses Life Savings To Deepfake Investment Scam",
                      "Whale Kirov Loses $3M To Permit Phishing",
                      "Influencer Mateo's Wallet Drained Of $500K",
                      "Trader Kruw loses $1 million in wallet drain"):
            with self.subTest(title=title):
                self.assertEqual(classify.extract_subject(title), (None, None))
        # a one-word name nothing knows, in an item about a person, or a given name a person has
        self.assertTrue(classify.subject_is_person("Tanaka", "headline subject",
                                                   "Tanaka Loses $40,000 To Wallet Drainer. The retiree lost his savings."))
        self.assertTrue(classify.subject_is_person("Kiro", "headline subject", "Kiro Loses $2 Million In Address Poisoning"))
        self.assertFalse(classify.subject_is_person("Moonwell", "headline subject",
                                                    "Moonwell exploited. The attacker swapped his funds to ETH."))
        self.assertFalse(classify.subject_is_person("Bullpen", "structured", "Bullpen said his account was hit."))


class SubjectPipelines(Scenario):
    def test_a_persons_name_is_never_a_crypto_incident_and_a_risky_one_is_flagged(self):
        doc = self.run_radar("2026-11-24", None, {
            "thedefiant": [news("Crypto Investor Kiro Loses $2 Million To Address Poisoning",
                                "https://thedefiant.io/news/hacks/crypto-investor-kiro-loses-2-million-address-poisoning",
                                "2026-11-23", "A crypto investor lost $2 million in USDT after copying a poisoned address "
                                "from their transaction history, according to on-chain sleuths."),
                           news("Kruw Wallet Drained of $1 Million After Malicious Approval",
                                "https://thedefiant.io/news/hacks/kruw-wallet-drained", "2026-11-23",
                                "The wallet was drained of $1 million after a malicious approval.", 8)],
            "decrypt": [news("Crypto Investor Kiro Loses $2M In Address Poisoning Scam",
                             "https://decrypt.co/350000/crypto-investor-kiro-loses-2m-address-poisoning", "2026-11-23",
                             "An investor sent $2 million in USDT to a look-alike address planted by scammers, "
                             "blockchain security firm data shows.", 14)]})
        self.assertNotIn("Kiro", json.dumps(doc, ensure_ascii=False))
        kruw = self.only(doc, "Kruw")[0]
        self.assertIs(kruw["personRisk"], True)
        self.assertIs(kruw["subjectKnown"], False)

    def test_a_known_or_structured_name_is_no_risk(self):
        record = llama("2026-11-22", "Abracadabra", 13_000_000, "Protocol Logic", None,
                       description="An attacker exploited Abracadabra's cauldrons on November 22, 2026.")
        doc = self.run_radar("2026-11-24", [record], {"coindesk": [news(
            "Abracadabra confirms $13 million exploit, pauses cauldrons",
            "https://www.coindesk.com/tech/2026/11/23/abracadabra-confirms-exploit", "2026-11-23",
            "The lending protocol said attackers drained $13 million on Nov. 22.")]})
        self.assertIs(self.only(doc, "Abracadabra")[0]["personRisk"], False)


# ---------------------------------------------------------------- owner review in every lane

class SensitiveInEveryLane(Scenario):
    def test_a_sexual_image_story_with_crypto_is_held_never_a_candidate(self):
        root_name = "held"
        doc = self.run_radar("2026-11-24", None, {
            "bleepingcomputer": [news("Hackers steal nude photos from Replika users, demand Bitcoin ransom",
                                      "https://www.bleepingcomputer.com/news/security/hackers-steal-nude-photos-replika-users/",
                                      "2026-11-23", "Attackers stole private photos from users of the Replika AI "
                                      "companion app and demanded a Bitcoin ransom.")],
            "coindesk": [news("Muah.ai Breach Exposes Nude Images, Crypto Wallets Of 400,000 Users",
                              "https://www.coindesk.com/tech/2026/11/23/muah-ai-breach", "2026-11-23",
                              "A breach of the AI companion app exposed users' images and crypto wallet addresses.")]},
            name=root_name)
        self.assertEqual(doc["counts"]["candidates"], 0)
        self.assertEqual(doc["unclustered"], [])
        self.assertEqual(doc["counts"]["ownerReview"], 2)
        self.assertEqual({r["suggestedType"] for r in doc["ownerReview"]}, {"ai-data-exposure"})
        with open(os.path.join(self.tmp, root_name, "out", "2026-11-24.md"), encoding="utf-8") as fh:
            md = fh.read()
        text = (json.dumps(doc, ensure_ascii=False) + md).lower()
        for word in ("nude", "replika", "muah", "bitcoin ransom"):
            self.assertNotIn(word, text)

    def test_an_app_name_is_not_a_creation_case(self):
        hold = classify.sensitive_hold("AI Image Generator App Leaked Users' Private Photos In Breach. The app exposed "
                                       "nude images of its users.")
        self.assertEqual(hold["suggestedType"], "ai-data-exposure")
        self.assertIsNone(classify.sensitive_hold("Teen charged over deepfake nude images of classmates")["suggestedType"])
        self.assertIsNone(classify.sensitive_hold("He generated nude images of a colleague with an AI app")["suggestedType"])


# ---------------------------------------------------------------- carried sources

class CarriedSources(Scenario):
    def test_a_carried_entry_is_redacted_and_its_link_withheld_under_todays_names(self):
        previous = {
            "mode": "live", "runDate": "2026-11-23", "seenRecordKeys": [], "alsoSeen": [], "top": [{
                "id": "2026-11-22-cursor", "protocol": "Cursor", "lane": "ai", "dateUtc": None,
                "firstSeenUtc": "2026-11-22", "status": "developing", "type": "prompt-injection", "reportedLosses": [],
                "sources": [{
                    "id": "securityweek", "url": "https://www.securityweek.com/lena-weiss-finds-prompt-injection-flaw/",
                    "title": "Lena Weiss Finds Prompt Injection Flaw In Cursor That Leaks Secrets",
                    "excerpt": "Cursor fixed a prompt injection flaw; Weiss found it, the vendor said.",
                    "publishedUtc": "2026-11-22T10:00:00Z", "tier": "B", "publisher": "SecurityWeek", "kind": "news",
                    "lane": "ai", "origin": "lena weiss"}]}]}
        doc = self.run_radar("2026-11-24", None, {"darkreading": [news(
            "Cursor Patches Prompt Injection Bug That Exposed Developer Secrets",
            "https://www.darkreading.com/application-security/cursor-patches-prompt-injection-bug", "2026-11-23",
            "Cursor patched a prompt injection bug that exposed developer secrets. Security researcher Lena Weiss "
            "reported the flaw to the vendor.", 14)]}, history={"2026-11-23.json": previous})
        text = json.dumps(doc, ensure_ascii=False)
        self.assertNotIn("Weiss", text)
        self.assertNotIn("weiss", text)
        carried = [s for i in self.incidents(doc) for s in i["sources"] if s.get("carried")]
        self.assertEqual(len(carried), 1)
        self.assertEqual((carried[0]["url"], carried[0]["urlWithheld"]), ("https://www.securityweek.com/", "names a person"))
        self.assertNotIn("origin", carried[0])

    def test_rescrub_without_todays_names_changes_nothing(self):
        entry = {"title": "Lena Weiss Finds Flaw", "url": "https://x.test/lena-weiss"}
        self.assertEqual(history.rescrub(entry), entry)


if __name__ == "__main__":
    unittest.main()
