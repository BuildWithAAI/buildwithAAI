"""The AI-security lane: relevance (positives and today's hard negatives), types, exclusions, subjects, lanes,
scoring on concrete harm, the AI Incident Database parser, redaction of people next to AI product names, and the
offline run over the recorded fixtures of 2026-11-24."""

import datetime as dt
import json
import os
import shutil
import tempfile
import unittest

from radarlib import classify, cluster, parsers, pipeline, safety, score
from radarlib.textutil import MONEY_RE, money_value

from .helpers import CTX, FIXTURES, RUN_DATE, SOURCES, fixture, source


def item(title, excerpt="", url="https://x.test/a", kind="news", categories=(), **extra):
    return {"title": title, "excerpt": excerpt, "url": url, "kind": kind, "categories": list(categories), **extra}


def assess(sid, title, excerpt="", **kw):
    return classify.assess(item(title, excerpt, **kw), source(sid))


class Relevance(unittest.TestCase):
    POSITIVES = (
        # (source, title, excerpt, expected type) -- titles from the 2026-11-24 feeds, plus two hand-made ones
        ("bleepingcomputer", "OpenRouter drops AI providers over leaked prompts and secrets",
         "OpenRouter removed three AI providers from its platform after discovering that they had violated their "
         "stated data-handling policies and exposed sensitive data.", "ai-data-exposure"),
        ("securityweek", "Check Point Security Management Servers Hacked in AI-Assisted Campaign",
         "The attacks were launched from 99 IP addresses and targeted organizations across multiple industries.",
         "ai-assisted-attack"),
        ("securityweek", "European Commission Uncovers Data Breach in Cyberattack Investigation",
         "Names and email addresses of EU Academy users were exposed in the AI-assisted cyberattack the European "
         "Commission detected in October.", "ai-assisted-attack"),
        ("aiid", "Claude Code’s ‘don’t ask again’ button has a secrets-spilling problem",
         "A configuration file meant to store local command permissions on Anthropic’s Claude Code is exposing "
         "thousands of API keys, database credentials and other secrets.", "ai-data-exposure"),
        ("darkreading", "'TheMailer' Phishing Kit Puts AI in the Driver's Seat",
         "The commercial kit uses attacker-supplied AI models to personalize lures and evade spam filters.", "ai-phishing"),
        ("darkreading", "Cursor Traces Malicious Claude Code Extensions to Third-Party Breach",
         "A compromised key issued to AI infrastructure provider Fireworks was used by threat actors.", "malicious-ai-tool"),
        ("darkreading", "'Sleeper Agent' Tactic Hides Payloads in Open-Weight AI Models",
         "Malware can lurk inside just 0.00001% of a neural network.", "model-supply-chain"),
        ("aiid", "57 indicted over NT$900 million voice-cloning romance scam",
         "Prosecutors indicted 57 people over a romance scam that used voice-cloning software.", "deepfake-fraud"),
        ("embracethered-blog", "From Indirect Prompt Injection to DNS Exfiltration in macOS Terminal",
         "Apple fixed a macOS Terminal behavior that enabled a DNS-based data exfiltration technique.", "prompt-injection"),
        ("embracethered-blog", "Visual Studio Copilot and SSMS Remote Code Execution (CVE-2026-103572)",
         "Today Microsoft shipped the patch for a vulnerability in Visual Studio Copilot.", "ai-agent-exploit"),
        ("therecord", "SEC charges adviser over false claims about its AI trading tools",
         "The regulator says the firm misled investors about its use of artificial intelligence.", "ai-washing"),
    )
    NEGATIVES = (
        # vendor deals, product launches, sponsored posts, funding, opinion, AI used for defence, AI incidents that
        # are not security (titles from the 2026-11-24 feeds unless noted)
        ("darkreading", "CrowdStrike Makes AI Security Push With Blockbuster Zscaler Deal",
         "CrowdStrike's $44 billion acquisition of Zscaler would give it greater control over AI agents."),
        ("bleepingcomputer", "New Shirudo tool uses AI to shield unpatched Linux systems from exploits",
         "OpenAI and Cisco launched an open-source Linux security tool named Shirudo."),
        ("securityweek", "OpenAI, Cisco Unveil Open Source Tool to Shield Unpatched Linux Systems",
         "Shirudo uses AI-generated shields to block Linux exploits while patches are prepared."),
        ("securityweek", "Anthropic Expands Enterprise Safeguards for Detecting AI Misuse",
         "EFS helps zero-retention customers spot Claude misuse spread across many requests."),
        ("darkreading", "Microsoft Debuts Offensive, Defensive Security Tools for the AI Era",
         "At its Ignite technical conference, Microsoft announced AI agent security tools."),
        ("darkreading", "Navigating Vulnerability Hysteria in the AI Era",
         "This installment of the Reporters' Notebook video series examines how fears of AI-assisted exploits trigger panic."),
        ("darkreading", "Japan Pushes Emergency Funding for Cybersecurity as AI-Assisted Breaches Rise",
         "The package adds public-private cyber responders."),
        ("securityweek", "AgentShield Raises $40 Million Series B to Stop Prompt Injection",  # hand-made funding round
         "The startup says its AI firewall blocks prompt injection."),
        ("embracethered-blog", "Escaping Linux Sandboxes via PipeWire (CVE-2026-5674)",
         "The vulnerability was discovered using my automated research pipeline with Claude Code."),
        ("aiid", "Waymo pauses robotaxi service amid San Francisco storms",
         "Waymo suspended its autonomous ride-hail service Wednesday morning."),
        ("aiid", "Maricopa County court releases DUI suspect after AI-generated police report",
         "A judge released a suspect after the arresting officer's report was generated with an AI tool."),
        ("therecord", "Bank says no evidence AI was used in the phishing campaign", "Investigators found no AI tooling."),
    )

    def test_positives_from_todays_feeds(self):
        for sid, title, excerpt, kind in self.POSITIVES:
            with self.subTest(title=title):
                found = assess(sid, title, excerpt)
                self.assertTrue(found["security"], found["reason"])
                self.assertIn(found["lane"], ("ai", "both"))
                self.assertEqual(found["aiVote"][0], kind)

    def test_hard_negatives(self):
        for sid, title, excerpt in self.NEGATIVES:
            with self.subTest(title=title):
                found = assess(sid, title, excerpt)
                self.assertFalse(found["security"], found["reason"])

    def test_sponsored_posts_and_press_releases_are_excluded(self):
        sponsored = item("AI Agents Are Creating a Shared Responsibility Gap",
                         "AI agents leak credentials across platforms, Token Security examines.", sponsored=True)
        self.assertEqual(classify.relevance(sponsored, source("bleepingcomputer"))[2], "excluded: sponsored post")
        release = item("F-Secure Identifies 26 Ways AI Can Harm Consumers",
                       "The taxonomy traces harm from misleading chatbot answers to compromised autonomous agents.", byline=False)
        self.assertIn("press release", classify.relevance(release, source("darkreading"))[2])
        bylined = dict(release, title="Attackers hijack AI coding agents through malicious MCP servers", byline=True)
        self.assertTrue(classify.relevance(bylined, source("darkreading"))[0])
        award = item("Microsoft named a Leader in the 2026 Gartner Magic Quadrant for SIEM",
                     categories=["Gartner Magic Quadrant"])
        self.assertFalse(classify.relevance(award, source("msft-security-blog"))[0])
        digest = item("Unit 42 Threat Intelligence Highlights - Nov. 2, 2026", "AI across offensive workflows.")
        self.assertIn("title matches", classify.relevance(digest, source("unit42-blog"))[2])

    def test_negation_and_advice_do_not_count(self):
        self.assertIsNone(classify.ai_type_from_text("The company said there was no evidence of prompt injection."))
        self.assertIsNone(classify.ai_type_from_text("Users should watch out for deepfake calls this season."))

    def test_a_jailbreak_needs_ai_nearby(self):
        self.assertIsNone(classify.ai_type_from_text("A new iOS jailbreak works on iPhone 17. AI news later."))
        self.assertEqual(classify.ai_type_from_text("Hackers jailbreak a chatbot to write malware")[0], "prompt-injection")


class Lanes(unittest.TestCase):
    def test_sources_carry_lanes(self):
        config = pipeline.load_sources(SOURCES)
        lanes = {s["id"]: s.get("lane") for s in config["sources"]}
        self.assertEqual(lanes["coindesk"], "crypto")
        self.assertEqual(lanes["embracethered-blog"], "ai")
        self.assertEqual(lanes["aiid"], "ai")
        for sid in ("bleepingcomputer", "therecord", "securityweek", "darkreading", "krebsonsecurity", "unit42-blog",
                    "msft-security-blog"):
            self.assertEqual(lanes[sid], "both", sid)
        self.assertTrue(source("aiid")["tracker"])
        self.assertEqual(source("aiid")["tier"], "C")

    def test_invalid_lane_is_refused(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "sources.json")
            with open(path, "w", encoding="utf-8") as fh:
                json.dump({"sources": [{"id": "x", "name": "X", "kind": "rss", "url": "https://x.test", "parser": "rss",
                                        "tier": "A", "lane": "games"}]}, fh)
            with self.assertRaises(ValueError):
                pipeline.load_sources(path)

    def test_crypto_sources_need_crypto_context(self):
        # an AI story on a crypto outlet stays out (the AI lane reads the security outlets)
        found = assess("decrypt", "Hackers abuse Claude Code to automate intrusions", "Attackers used the AI agent.")
        self.assertFalse(found["security"])
        both = assess("decrypt", "Deepfake video of exchange CEO used in crypto scam",
                      "Scammers used a deepfake to steal $2 million in crypto from Binance users.")
        self.assertEqual((both["security"], both["lane"]), (True, "both"))

    def test_strict_crypto_context_on_general_outlets(self):
        tokens = assess("darkreading", "Extortion Group Flits Into Law Firms a Second Time",
                        "A social engineering con aimed at stealing Microsoft access tokens.")
        self.assertFalse(tokens["security"], "access tokens are not crypto")
        exchange = assess("bleepingcomputer", "Hackers breach Microsoft Exchange servers", "Attackers exploited a flaw.")
        self.assertFalse(exchange["security"], "Microsoft Exchange is not a crypto exchange")
        crypto = assess("darkreading", "Attackers in Binance Breach Targeted Known Weakness, Missing Controls",
                        "Attacker-deployed sweepers hobble security controls.")
        self.assertEqual((crypto["security"], crypto["lane"]), (True, "crypto"))
        # "cryptographic tools" is not cryptocurrency, on any source
        self.assertFalse(classify.CRYPTO_RE.search("claimed to use advanced cryptographic tools"))

    def test_both_lane_vote(self):
        generic = ("exploit", None, "text 'hacked'")
        ai = ("prompt-injection", "ai-security", "AI text 'prompt injection'")
        self.assertEqual(classify.ai_lane_vote(generic, ai), ai)
        drainer = ("drainer", "drainers", "text 'wallet drainer'")
        self.assertEqual(classify.ai_lane_vote(drainer, ai), drainer, "a crypto mechanism a source states wins")
        self.assertEqual(classify.ai_lane_vote(None, ai), ai)
        self.assertEqual(classify.ai_lane_vote(drainer, None), drainer)


class Types(unittest.TestCase):
    def test_types_labels_and_topics(self):
        for kind in classify.AI_TYPES:
            self.assertIn(kind, classify.TYPES)
            self.assertIn(kind, classify.TYPE_LABEL)
            self.assertIn(kind, classify.TYPE_PRIORITY)
        # crypto types and their order are unchanged
        crypto_order = [t for t in classify.TYPE_PRIORITY if t in classify.CRYPTO_TYPES]
        self.assertEqual(crypto_order, ["social-engineering", "drainer", "phishing", "rug", "key-compromise", "oracle",
                                        "governance", "bridge", "exploit", "other"])
        self.assertGreater(classify.TYPE_PRIORITY.index("deepfake-fraud"), classify.TYPE_PRIORITY.index("bridge"))
        self.assertLess(classify.TYPE_PRIORITY.index("ai-washing"), classify.TYPE_PRIORITY.index("exploit"))
        self.assertEqual(cluster.DEFAULT_TOPIC["prompt-injection"], "ai-security")
        self.assertEqual(cluster.DEFAULT_TOPIC["deepfake-fraud"], "ai-scams")
        self.assertNotIn("ai-assisted-attack", cluster.DEFAULT_TOPIC)
        self.assertLessEqual(set(classify.AI_EVERGREEN), set(classify.EVERGREEN))

    def test_text_rules(self):
        cases = {
            "Prompt injection in a calendar invite made the agent leak secrets": "prompt-injection",
            "Malicious MCP server packages stole emails from developers": "malicious-ai-tool",
            "Fake ChatGPT apps on the store delivered infostealers": "malicious-ai-tool",
            "Poisoned model checkpoints on Hugging Face hid backdoors": "model-supply-chain",
            "Hackers used Claude Code to automate the intrusion": "ai-assisted-attack",
            "A flaw in GitHub Copilot let attackers run code": "ai-agent-exploit",
            "The chatbot leaked users' chat histories": "ai-data-exposure",
            "Scammers used a deepfake video call to steal $25 million": "deepfake-fraud",
            "AI-generated phishing emails hit hotel staff": "ai-phishing",
            "FTC sues firm over AI-washing in its marketing": "ai-washing",
        }
        for text, kind in cases.items():
            with self.subTest(text=text):
                self.assertEqual(classify.ai_type_from_text(text)[0], kind)
        # crypto rules never produce an AI type, and AI rules leave crypto texts alone
        self.assertNotIn(classify.type_from_text("a wallet drainer kit emptied wallets")[0], classify.AI_TYPES)
        self.assertIsNone(classify.ai_type_from_text("Chainflip confirms $12M hack"))
        self.assertIsNone(classify.ai_type_from_text("Mastercard rolls out AI fraud detection for card payments"))


class Subjects(unittest.TestCase):
    CASES = {
        "OpenRouter drops AI providers over leaked prompts and secrets": "OpenRouter",
        "Claude Code’s ‘don’t ask again’ button has a secrets-spilling problem": "Claude Code",
        "Microsoft patches Copilot prompt injection flaw": "Copilot",
        "Anthropic says Chinese state hackers used Claude Code for espionage": "Claude Code",
        "Check Point Security Management Servers Hacked in AI-Assisted Campaign": "Check Point",
        "European Commission Uncovers Data Breach in Cyberattack Investigation": "European Commission",
        "GoDaddy Says Its Been Penetrated by its First AI-Driven Cyber Attack": "GoDaddy",
        "123 Reg discloses 'AI cyberattack' on customer data, suspects China nexus": "123 Reg",
        "'TheMailer' Phishing Kit Puts AI in the Driver's Seat": "TheMailer",
        "Grok Bots Attempt to Access Corporate Data Without User Approval": "Grok",
        "Wiz says attackers abused Gemini CLI to reach cloud keys": "Gemini CLI",
    }
    NONE = (
        "Teodoro Sample Says ‘Explicit and Disturbing’ AI Scam Convinced Fan They Had an Illicit Romance",
        "Prosecutors indict 57 over AI-powered romance scam",
        "Attackers Use Autonomous AI to Target Semiconductor, Defense and Civil Society Sectors",
        "UK cyber agency seeing ‘marked rise’ in AI-driven attacks",
        "Recent Trends and Tactics of Agentic AI Attacks",
        "Avery Example Says AI Voice Scam Cost Her Savings",
        "Cisco Talos finds AI-powered malware in npm packages",  # the reporting firm is not the subject
    )

    def test_products_and_companies(self):
        for title, expected in self.CASES.items():
            with self.subTest(title=title):
                self.assertEqual(classify.extract_ai_subject(title)[0], expected)

    def test_never_a_person_or_a_generic_phrase(self):
        for title in self.NONE:
            with self.subTest(title=title):
                self.assertIsNone(classify.extract_ai_subject(title)[0])

    def test_the_publisher_is_never_the_subject(self):
        self.assertIsNone(classify.extract_ai_subject("OpenAI Explains URL-Based Data Exfiltration Mitigations",
                                                      exclude={"openai"})[0])


class Redaction(unittest.TestCase):
    def test_ai_products_are_not_people(self):
        for text in ("Claude Code’s ‘don’t ask again’ button has a secrets-spilling problem",
                     "Breaking Claude Code Opus 5 Auto Mode", "Claude says the request was blocked",
                     "Gemini CLI and Copilot Studio were patched"):
            with self.subTest(text=text):
                self.assertEqual(safety.redact_people(text)[1], 0)
        self.assertEqual(safety.check_generated("Claude Code: data exposure through an AI tool"), [])

    def test_people_are_still_redacted(self):
        self.assertEqual(safety.redact_people("Claude Dupont said the wallet was drained")[0],
                         "[named person] said the wallet was drained")
        text = "A man surnamed Exampleson (例) and his wife, surnamed Samplez (樣), set up the ring."
        out, n = safety.redact_people(text)
        self.assertEqual(n, 2)
        self.assertNotIn("Exampleson", out)
        self.assertNotIn("例", out)
        # a given name the list does not know goes with its redacted surname; a role word stays
        self.assertEqual(safety.redact_people("Teodoro Sample Says AI Scam Convinced A Fan")[0],
                         "[named person] Says AI Scam Convinced A Fan")
        self.assertTrue(safety.redact_people("Plaintiff Avery Example purchased tokens.")[0].startswith("Plaintiff"))


class Parsers(unittest.TestCase):
    def test_aiid_citation_becomes_an_incident_reference(self):
        items, warnings = parsers.parse_aiid_feed(fixture("aiid.xml"), source("aiid"), CTX)
        self.assertEqual(warnings, [])
        claude = [i for i in items if "Claude Code" in i["title"]]
        self.assertEqual({i["incidentRef"] for i in claude}, {"aiid:1846"})
        self.assertTrue(all(i["trackerUrl"].startswith("https://incidentdatabase.ai/cite/1846#") for i in claude))
        self.assertTrue(all(i["listedReport"] for i in items))
        self.assertTrue(all("incidentdatabase.ai/cite" not in i["excerpt"] for i in items))
        self.assertTrue(claude[0]["url"].startswith("https://blog.gitguardian.com/"), "the link is the original report")
        pending = next(i for i in items if i["title"].startswith("United Airlines"))
        self.assertNotIn("incidentRef", pending)
        self.assertNotIn("report_number", pending["excerpt"])
        self.assertTrue(all(not i["categories"] for i in items))

    def test_sponsored_flag_and_byline(self):
        bleep, _ = parsers.parse_feed(fixture("bleepingcomputer.xml"), source("bleepingcomputer"), CTX)
        self.assertEqual({i["title"][:20] for i in bleep if i.get("sponsored")},
                         {"From Vulnerability N", "AI Agents Are Creati"})
        dark, warnings = parsers.parse_feed(fixture("darkreading.xml"), source("darkreading"), CTX)
        self.assertEqual(warnings, [])
        self.assertEqual([i["title"][:17] for i in dark if i.get("byline") is False], ["Strike Graph Laun"])
        self.assertFalse(any("Dark Reading staff" in json.dumps(i) for i in dark), "author lines are never stored")

    def test_byline_check_switches_off_when_most_items_have_none(self):
        body = ('<?xml version="1.0"?><rss version="2.0"><channel><title>x</title>'
                + "".join(f"<item><title>AI agent flaw {n} exploited</title><link>https://x.test/{n}</link>"
                          f"<pubDate>Tue, 24 Nov 2026 10:00:00 GMT</pubDate></item>" for n in range(5))
                + "</channel></rss>").encode()
        items, warnings = parsers.parse_feed(body, source("darkreading"), CTX)
        self.assertTrue(all("byline" not in i for i in items))
        self.assertIn("byline check skipped", warnings[0])

    def test_wordpress_footer_is_stripped_where_asked(self):
        items, _ = parsers.parse_feed(fixture("securityweek.xml"), source("securityweek"), CTX)
        self.assertTrue(items and all("appeared first on" not in i["excerpt"] for i in items))

    def test_foreign_dollars_are_not_usd(self):
        values = [money_value(m) for m in MONEY_RE.finditer("NT$900 million (US$28.32 million), HK$5 million")]
        self.assertEqual(values, [28.32e6])


class Scoring(unittest.TestCase):
    def mention(self, sid, tier, title, excerpt="", hedge=None, publisher=None):
        return cluster.Mention(sid=sid, tier=tier, title=title, excerpt=excerpt, hedge=hedge, roundup=False,
                               publisher=publisher or sid, lane="ai")

    def test_harm_instead_of_dollars(self):
        inc = {"type": "ai-data-exposure", "lane": "ai", "reportedLosses": []}
        members = [self.mention("securityweek", "B", "Claude Code secrets exposed on GitHub",
                                "31,088 secrets were exposed across 23,276 repositories; Anthropic shipped a fix."),
                   self.mention("unit42-blog", "A", "Attackers used exposed Claude Code keys in the wild")]
        value, reason = score.harm_factor(inc, members)
        self.assertGreater(value, 0.8)
        self.assertIn("exploited or used in real attacks (unit42-blog, tier A)", reason)
        self.assertIn("users or data affected", reason)
        self.assertIn("a fix, advisory or takedown shipped", reason)
        self.assertEqual(score.loss_factor(inc)[0], 0.0, "the crypto loss factor would have buried it")
        nothing, why = score.harm_factor(inc, [self.mention("x", "B", "Researchers study AI agent risks")])
        self.assertEqual(nothing, 0.0)
        self.assertIn("no concrete harm stated", why)

    def test_tier_and_hedge_weight_and_figures_still_count(self):
        inc = {"type": "deepfake-fraud", "lane": "ai", "reportedLosses": []}
        c_only = score.harm_factor(inc, [self.mention("aiid", "C", "Scammers stole funds with a deepfake call")])[0]
        b_only = score.harm_factor(inc, [self.mention("b", "B", "Scammers stole funds with a deepfake call")])[0]
        hedged = score.harm_factor(inc, [self.mention("b", "B", "Scammers stole funds with a deepfake call", hedge="suspected")])[0]
        self.assertLess(c_only, b_only)
        self.assertLess(hedged, b_only)
        big = dict(inc, reportedLosses=[{"amountUsd": 25e6, "by": "b", "tier": "B"}])
        self.assertGreaterEqual(score.harm_factor(big, [])[0], score.log_scale(25e6))

    def test_who_is_scored_on_harm(self):
        self.assertTrue(score.ai_scored({"type": "prompt-injection", "lane": "ai"}))
        self.assertTrue(score.ai_scored({"type": "prompt-injection", "lane": "both"}))
        self.assertFalse(score.ai_scored({"type": "drainer", "lane": "both"}), "a crypto mechanism keeps the loss rule")
        self.assertFalse(score.ai_scored({"type": "exploit", "lane": "crypto"}))

    def test_evergreen_and_audience(self):
        self.assertEqual(score.evergreen_factor({"type": "deepfake-fraud", "evergreenTopic": "ai-scams"}, [])[0], 1.0)
        self.assertEqual(score.evergreen_factor({"type": "prompt-injection", "evergreenTopic": "ai-security"}, [])[0], 1.0)
        self.assertEqual(score.evergreen_factor({"type": "model-supply-chain", "evergreenTopic": "ai-security"}, [])[0], 0.6)
        self.assertEqual(score.evergreen_factor({"type": "ai-assisted-attack", "evergreenTopic": None}, [])[0], 0.0)
        value, _ = score.audience_factor({"type": "deepfake-fraud"}, [])
        self.assertGreaterEqual(value, 0.85)


class OfflineAiLane(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.mkdtemp(prefix="radar-ai-")
        cls.doc, _, cls.md_path = pipeline.run_collect(RUN_DATE, offline=True, out_dir=cls.tmp, cache_dir=None,
                                                       sources_path=SOURCES, fixtures_dir=FIXTURES, log=lambda m: None)
        cls.incidents = {i["id"]: i for i in cls.doc["top"] + cls.doc["alsoSeen"]}

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.tmp, True)

    def test_every_output_carries_a_lane(self):
        for inc in self.incidents.values():
            self.assertIn(inc["lane"], classify.LANES)
            for src in inc["sources"]:
                self.assertIn(src["lane"], classify.LANES)
        for entry in self.doc["unclustered"]:
            self.assertIn(entry["lane"], classify.LANES)
        for row in self.doc["sources"]:
            self.assertIn(row["lane"], classify.LANES)
        self.assertEqual(set(self.doc["laneTop"]), {"crypto", "ai"})
        self.assertEqual(sum(self.doc["counts"]["candidatesByLane"].values()), self.doc["counts"]["candidates"])

    def test_ai_incidents_of_the_day(self):
        openrouter = self.incidents["2026-11-23-openrouter"]
        self.assertEqual((openrouter["lane"], openrouter["type"], openrouter["status"], openrouter["evergreenTopic"]),
                         ("ai", "ai-data-exposure", "developing", "ai-security"))
        self.assertEqual(openrouter["title"], "OpenRouter: reported data exposure through an AI tool (developing)")
        self.assertEqual(openrouter["score"]["factors"]["loss"]["basis"], "harm")
        self.assertGreater(openrouter["score"]["factors"]["loss"]["value"], 0)
        self.assertEqual(self.incidents["2026-11-24-check-point"]["type"], "ai-assisted-attack")
        self.assertEqual(self.doc["laneTop"]["ai"][0], "2026-11-23-openrouter")
        self.assertTrue(all(i in self.incidents for i in self.doc["laneTop"]["ai"]))

    def test_listed_reports_are_discovery_only(self):
        # an incident only the AI Incident Database lists is a lead, never a candidate: its listing date (when the
        # database added the reports) is not coverage, so it never looks fresh
        self.assertFalse([i for i in self.incidents if i.endswith("-claude-code")])
        leads = {e["protocol"]: e for e in self.doc["listedOnly"]}
        claude = leads["Claude Code"]
        self.assertEqual(self.doc["counts"]["listedOnly"], len(self.doc["listedOnly"]))
        self.assertEqual(claude["incidentRefs"], ["aiid:1846"])
        self.assertEqual(claude["listedUtc"], "2026-11-23")
        self.assertTrue(claude["dateNote"].startswith("listed by AI Incident Database on 2026-11-23"))
        self.assertNotIn("first coverage", claude["dateNote"])
        # the report the AI rules alone would drop is read as its accepted sibling's incident (same reference), and its
        # text dates the story earlier than the listing
        self.assertEqual(len(claude["sources"]), 3)
        self.assertEqual(claude["dateUtc"], "2026-11-07")
        for src in claude["sources"]:
            self.assertTrue(src["listedReport"] and src["trackerUrl"].startswith("https://incidentdatabase.ai/cite/"))
            self.assertIsNone(src["publishedUtc"], "a listing date is never a publication date")
            self.assertEqual(src["listedUtc"], "2026-11-23T00:00:00Z")
        md = open(self.md_path, encoding="utf-8").read()
        self.assertIn("## Listed by an incident database only (leads, never candidates)", md)

    def test_ai_items_never_join_crypto_seeds(self):
        # "National Cyber Security Centre" in an AI story is not the Cyber Bridge hack
        cyber = self.incidents["2026-11-21-cyber-bridge"]
        self.assertEqual(cyber["lane"], "crypto")
        self.assertNotIn("therecord", {s["id"] for s in cyber["sources"]})
        self.assertIn("UK cyber agency seeing ‘marked rise’ in AI-driven attacks",
                      [u["title"] for u in self.doc["unclustered"]])

    def test_crypto_ranking_is_unchanged(self):
        top = [i["protocol"] for i in self.doc["top"]]
        self.assertEqual(top[:4], ["Binance", "Chainflip", "Lighter", "Cyber Bridge"])
        self.assertEqual(self.incidents["2026-10-29-binance"]["score"]["total"], 89.5)
        self.assertEqual(self.incidents["2026-11-21-chainflip"]["score"]["total"], 70.9)

    def test_hard_negatives_never_reach_the_brief(self):
        text = json.dumps(self.doc, ensure_ascii=False)
        for title in ("Zscaler Deal", "Shirudo", "Expands Enterprise Safeguards", "Magic Quadrant", "Strike Graph",
                      "Rethinking Security in the AI Era", "Shared Responsibility Gap", "Waymo", "RansomwareHelp"):
            self.assertNotIn(title, text)

    def test_generated_text_and_names(self):
        for inc in self.incidents.values():
            self.assertEqual(safety.check_generated(inc["title"]), [], inc["title"])
            for src in inc["sources"]:
                self.assertEqual(safety.redact_people(src["title"])[1], 0, src["title"])
        with open(self.md_path, encoding="utf-8") as fh:
            md = fh.read()
        self.assertIn("## AI security lane", md)
        self.assertIn("OpenRouter: reported data exposure through an AI tool (developing)", md)
        self.assertIn("lane ai", md)


class AiClustering(unittest.TestCase):
    def test_reports_of_one_database_incident_cluster(self):
        src = source("aiid")
        base = {"kind": "news", "publishedUtc": "2026-11-23T00:00:00Z", "categories": [], "listedReport": True,
                "incidentRef": "aiid:1846", "trackerUrl": "https://incidentdatabase.ai/cite/1846#1"}
        items = [
            dict(base, title="Claude Code settings leak secrets on GitHub", url="https://a.test/1",
                 excerpt="Secrets were exposed in public repositories."),
            dict(base, title="Secrets spill from a coding agent's hidden file", url="https://b.test/2",
                 excerpt="Thousands of API keys were exposed through the AI agent's settings."),
        ]
        mentions, _ = cluster.build_mentions({"aiid": {"items": items}}, {"aiid": src}, RUN_DATE)
        self.assertEqual(len(mentions), 2)
        clusters, unclustered = cluster.cluster_mentions(mentions)
        self.assertEqual([len(c) for c in clusters], [2], "the subject-less report joins by its incident reference")
        self.assertEqual(unclustered, [])


if __name__ == "__main__":
    unittest.main()
