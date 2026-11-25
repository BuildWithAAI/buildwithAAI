"""Regression tests for the second pass of the AI-lane review (2026-11-25): one test per finding fixed, each a case
that failed before its fix.

  * own statements: a Title Case or passive headline ("Bybit Reported Hacked", "Cursor Reported Vulnerable",
    "Stake DAO Warns of ...") is never the project's own statement, so one tier-B outlet never confirms it; a passive
    cue verb names no origin ("USDC Tied to Binance Hack"); origins still stop at a sentence end;
  * AI subjects: a quoted or "dubbed" handle after a person word is a person, not the product it shares a name with;
    a handle that attacks something ("ShinyHunters Breach AI Startup") is the attacker, never the incident's subject;
  * AI clustering: two publishers' same-day reports of one flaw are one incident (plurals folded, or two shared words
    of what was exposed), while two CVEs, two database incidents or two mechanisms stay apart;
  * redaction: a pair after a legal verb that ends in an entity or role word ("Sanctions Sinbad Mixer") is no person,
    and a link is never withheld for an AI product's name used as the product ("claude-code-flaw");
  * owner review: a sexual-abuse or intimate-image story the AI lane holds back reaches the JSON and the MD as a count,
    its outlet and its reason (a completed AI-app breach with the type ai-data-exposure), never its words or link, and
    never as a candidate.
"""

import datetime as dt
import json
import os
import unittest

from radarlib import classify, cluster, history, safety

from .test_regressions import Scenario, llama


def pub(day, hour=10):
    d = dt.date.fromisoformat(day)
    return dt.datetime(d.year, d.month, d.day, hour, tzinfo=dt.timezone.utc).strftime("%a, %d %b %Y %H:%M:%S +0000")


def news(title, url, day, desc="", hour=10):
    return {"title": title, "url": url, "pub": pub(day, hour), "desc": desc}


class OwnStatements(unittest.TestCase):
    """titlecase-origin-false-confirm and origin-spans-sentence-boundary: only a speech verb in running text names a
    project's own statement; a passive or a Title Case headline never does."""

    def test_title_case_and_passive_headlines_make_no_statement(self):
        for title in ("Bybit Reported Hacked for $1.5 Billion",
                      "Cursor Reported Vulnerable to Prompt Injection That Leaks Secrets",
                      "Stake DAO Warns of Forum Breach, Says Funds Unaffected",
                      "Abracadabra Confirms $13 Million Exploit",
                      "Shibarium Bridge Reported Hacked for $2.4 Million",
                      "Upbit Found to Have Lost $30 Million in Hot Wallet Exploit",
                      "Hyperliquid Linked to $5 Million Oracle Exploit",
                      "Balancer Flagged as Victim of $120 Million Exploit",
                      "Bybit reported hacked for $1.5 billion",
                      "Bybit linked to $1.5 billion cold wallet exploit",
                      "Upbit found to have lost $30 million in hot wallet exploit",
                      "Exchange said to be weighing a bounty after $5 million hack",
                      "Bybit hack: what we know"):
            with self.subTest(title=title):
                self.assertIsNone(classify.statement_of(title, "The Defiant", headline=True))

    def test_a_speech_verb_in_running_text_is_a_statement(self):
        self.assertEqual(classify.statement_of("Chainflip confirms $12M hack, offers attacker 10% bounty", "Cointelegraph",
                                               headline=True), "chainflip")
        self.assertEqual(classify.statement_of("Abracadabra says it was exploited for $13 million", "CoinDesk",
                                               headline=True), "abracadabra")
        self.assertEqual(classify.statement_of("The lending protocol was drained. Abracadabra said its cauldrons were "
                                               "drained of $13 million.", "CoinDesk"), "abracadabra")
        self.assertEqual(classify.statement_of("Attackers drained the cold wallet, according to Bybit.", "CoinDesk"), "bybit")
        # round 3 (repro-statement-not-a-confirmation): only words that affirm the incident are its statement
        self.assertIsNone(classify.statement_of("The lending protocol was drained. Abracadabra said its cauldrons were "
                                                "paused.", "CoinDesk"))
        self.assertIsNone(classify.statement_of("Funds left the cold wallet, according to Bybit.", "CoinDesk"))
        # finding verbs name an origin (who the outlet relays), never a statement
        self.assertIsNone(classify.statement_of("Elliptic traced the funds to Lazarus.", "CoinDesk"))
        self.assertEqual(classify.origin_of("Elliptic traced the funds to Lazarus.", "CoinDesk"), "elliptic")

    def test_a_passive_cue_names_no_origin(self):
        for title in ("DOJ Seeks Over $1.1 Billion in USDC Tied to Binance Hack",
                      "Bybit Reported Hacked for $1.5 Billion",
                      "Cursor Reported Vulnerable to Prompt Injection That Leaks Secrets",
                      "Hyperliquid Linked to $5 Million Oracle Exploit",
                      "Balancer Flagged as Victim of $120 Million Exploit",
                      "Exchange Warned Over Lax Controls After $5 Million Hack"):
            with self.subTest(title=title):
                self.assertIsNone(classify.origin_of(title, "The Defiant", headline=True))
        # a present-tense cue is always active ("Osmosis links ... to the attacker")
        self.assertEqual(classify.origin_of("It freezes 64 accounts Osmosis links to the attacker.", "The Defiant"), "osmosis")
        # who an outlet relays is still read from a Title Case headline (it only ever merges outlets into one origin)
        self.assertEqual(classify.origin_of("Elliptic Traces $1.5 Billion Bybit Haul to Lazarus", "The Defiant",
                                            headline=True), "elliptic")
        # and the sentence-boundary fix holds
        self.assertEqual(classify.origin_of("Secrets leaked, according to findings by GitGuardian. The code security "
                                            "firm found 31,088 secrets.", "BleepingComputer"), "gitguardian")
        self.assertEqual(classify.statement_of("Thousands of secrets sat on GitHub. GitGuardian said 31,088 leaked.",
                                               "SecurityWeek"), "gitguardian")

    def test_a_carried_source_is_read_again_under_todays_rules(self):
        previous = {"radarDate": "2026-11-23", "lossEntries": [], "sources": [{
            "id": "thedefiant", "url": "https://thedefiant.io/news/hacks/bybit", "tier": "B", "publisher": "The Defiant",
            "title": "Bybit Reported Hacked for $1.5 Billion", "excerpt": "", "origin": "bybit"}]}
        carried = history.carried_sources(previous, {"sources": []})
        self.assertIsNone(carried[0].statement)
        self.assertEqual(cluster._status([], carried, {"bybit"})[0], "developing")


class QuotedHandlesAndActors(unittest.TestCase):
    """ai-subject-quoted-handle-and-actor (and the rest of ai-subject-accepts-people-and-handles)."""

    NONE = (
        "Hacker 'Sora' Sold Access Stolen With AI Phishing Kit",
        "Hacker “Kiro” Leaks Data Stolen From AI Chatbot Vendor",
        "Scammer going by Sora used AI voice clones to steal $2 million",
        "A hacker who goes by Cline leaked data stolen from an AI startup",
        "A man named Claude lost $40,000 to an AI voice clone",
        "ShinyHunters Breach AI Startup, Steal Customer Chats",
        "ScarletEel Hacks AI Startup's Cloud, Steals Training Data",
    )
    KEEP = {
        "A tool called Cursor leaked secrets through a prompt injection": "Cursor",
        "An AI agent called Cursor leaked secrets through a prompt injection": "Cursor",
        "An AI model named Sora was abused to make deepfake ads": "Sora",
        "Check Point Security Management Servers Hacked in AI-Assisted Campaign": "Check Point",
        "DeepSeek Breach Exposes Chat Histories": "DeepSeek",
        "Muah.ai Hack Drains Users' Accounts": "Muah.ai",
    }

    def test_people_and_attackers_are_never_subjects(self):
        for title in self.NONE:
            with self.subTest(title=title):
                self.assertEqual(classify.extract_ai_subject(title), (None, None))
        # the person is never the subject; the product whose accounts were stolen may be
        for title in ("Hacker Dubbed Claude Sold Stolen ChatGPT Accounts", "Hacker called Kiro sold stolen ChatGPT accounts"):
            with self.subTest(title=title):
                self.assertNotIn(classify.extract_ai_subject(title)[0], ("Claude", "Kiro"))

    def test_products_and_victims_keep_their_subject(self):
        for title, expected in self.KEEP.items():
            with self.subTest(title=title):
                self.assertEqual(classify.extract_ai_subject(title)[0], expected)


class OwnStatementPipelines(Scenario):
    """One tier-B outlet's unconfirmed report stays developing; a project's own words relayed in running text still
    confirm."""

    def test_title_case_reports_stay_developing(self):
        cases = (
            ("thedefiant", "Bybit Reported Hacked for $1.5 Billion", "https://thedefiant.io/news/hacks/bybit-reported",
             "Onchain data shows $1.5 billion left the exchange's cold wallet.", "Bybit"),
            ("securityweek", "Cursor Reported Vulnerable to Prompt Injection That Leaks Secrets",
             "https://www.securityweek.com/cursor-reported-vulnerable/",
             "Researchers reported the flaw in Cursor; the vendor has not commented.", "Cursor"),
            ("thedefiant", "Stake DAO Warns of Forum Breach, Says Funds Unaffected",
             "https://thedefiant.io/news/hacks/stake-dao-forum",
             "The copied database may contain emails. Stake DAO urged forum users to reset access.", "Stake DAO"),
            ("coindesk", "Bybit reported hacked for $1.5 billion", "https://www.coindesk.com/tech/2026/11/23/bybit",
             "Onchain data shows $1.5 billion left the exchange's cold wallet.", "Bybit"),
        )
        for n, (sid, title, url, excerpt, protocol) in enumerate(cases):
            with self.subTest(title=title):
                doc = self.run_radar("2026-11-24", None, {sid: [news(title, url, "2026-11-23", excerpt)]}, name=f"case{n}")
                inc = self.only(doc, protocol)[0]
                self.assertEqual(inc["status"], "developing", inc["statusReason"])
                self.assertIn("(developing)", inc["title"])
                self.assertIn(": reported ", inc["title"])
                self.assertNotIn("own statement", inc["statusReason"])
                self.assertNotIn("statement", inc["sources"][0])

    def test_the_projects_own_words_still_confirm(self):
        record = llama("2026-11-22", "Abracadabra", 13_000_000, "Protocol Logic", None,
                       description="An attacker exploited Abracadabra's cauldrons on November 22, 2026.")
        doc = self.run_radar("2026-11-24", [record], {"coindesk": [news(
            "Abracadabra confirms $13 million exploit, pauses cauldrons",
            "https://www.coindesk.com/tech/2026/11/23/abracadabra-confirms-exploit", "2026-11-23",
            "The lending protocol said attackers drained $13 million on Nov. 22.")]})
        inc = self.only(doc, "Abracadabra")[0]
        self.assertEqual(inc["status"], "confirmed", inc["statusReason"])
        self.assertIn("the project's own statement, relayed unhedged by coindesk", inc["statusReason"])
        self.assertEqual([s.get("statement") for s in inc["sources"] if s["id"] == "coindesk"], ["abracadabra"])
        # the same words as a Title Case headline are no statement the radar can attribute
        doc = self.run_radar("2026-11-24", [record], {"thedefiant": [news(
            "Abracadabra Confirms $13 Million Exploit, Pauses Cauldrons",
            "https://thedefiant.io/news/hacks/abracadabra-confirms", "2026-11-23",
            "The lending protocol was drained of $13 million on Nov. 22.")]}, name="title-case")
        self.assertEqual(self.only(doc, "Abracadabra")[0]["status"], "developing")



class SubjectPipelines(Scenario):
    def test_a_quoted_handle_and_an_attacker_stay_unclustered(self):
        doc = self.run_radar("2026-11-24", None, {
            "bleepingcomputer": [news("Hacker 'Sora' Sold Access Stolen With AI Phishing Kit",
                                      "https://www.bleepingcomputer.com/news/security/hacker-sold-access-ai-phishing-kit/",
                                      "2026-11-23", "The hacker used an AI-powered phishing kit to steal logins and sold "
                                      "access to 40 companies.")],
            "securityweek": [news("ShinyHunters Breach AI Startup, Steal Customer Chats",
                                  "https://www.securityweek.com/shinyhunters-ai-startup-chats/", "2026-11-23",
                                  "The group stole customer chat logs from the AI startup's chatbot database.", 14)]})
        self.assertEqual([i["protocol"] for i in self.incidents(doc)], [])
        self.assertEqual(len(doc["unclustered"]), 2)



class SameIssue(Scenario):
    """ai-same-issue-oversplit: genuine two-outlet coverage of one AI flaw is one incident again; distinct issues of
    one product stay apart (test_review_fixes.Pipelines.test_two_findings_about_one_product_stay_apart keeps the
    original cases)."""

    def pair(self, a_title, a_excerpt, b_title, b_excerpt, name, a_day="2026-11-23", b_day="2026-11-23"):
        return self.run_radar("2026-11-24", None, {
            "bleepingcomputer": [news(a_title, "https://www.bleepingcomputer.com/news/security/" + name + "-a/", a_day,
                                      a_excerpt, 15)],
            "securityweek": [news(b_title, "https://www.securityweek.com/" + name + "-b/", b_day, b_excerpt, 14)]},
            name=name)

    def test_two_publishers_reporting_one_flaw_are_one_incident(self):
        doc = self.pair("Anthropic fixes Claude Code flaw that exposed developer secrets",
                        "Anthropic fixed a Claude Code flaw that exposed developer secrets.",
                        "Claude Code Flaw Exposed Secrets of Thousands of Developers",
                        "A Claude Code flaw exposed secrets of thousands of developers, Anthropic said.", "claude-secrets")
        claude = [i for i in self.incidents(doc) if i["protocol"] == "Claude Code"]
        self.assertEqual(len(claude), 1, [i["id"] for i in claude])
        self.assertEqual({s["id"] for s in claude[0]["sources"]}, {"bleepingcomputer", "securityweek"})
        self.assertEqual(claude[0]["status"], "confirmed", claude[0]["statusReason"])
        # round 3 (regress-same-issue-impact-overmerge): words of what was exposed alone ("exposed", "secrets",
        # "keys") no longer join two reports; without a shared distinctive word they stay apart (developing)
        doc = self.pair("Claude Code flaw leaked API keys and exposed secrets", "The bug exposed secrets.",
                        "Anthropic Patches Claude Code Flaw That Exposed Secrets and Leaked Keys",
                        "Secrets and keys were exposed.", "claude-keys")
        self.assertEqual(len([i for i in self.incidents(doc) if i["protocol"] == "Claude Code"]), 2)

    def test_distinct_issues_stay_apart(self):
        doc = self.pair("Claude Code flaw CVE-2026-11111 exposed developer secrets", "The bug exposed secrets.",
                        "Claude Code Flaw CVE-2026-22222 Exposed Secrets of Developers", "Another bug exposed secrets.",
                        "two-cves")
        self.assertEqual(len([i for i in self.incidents(doc) if i["protocol"] == "Claude Code"]), 2)

    def test_impact_words_join_only_reports_a_day_apart(self):
        # round 3: renamed rule. A shared distinctive word and a specific thing exposed join two reports; impact words
        # alone never do (regress-same-issue-impact-overmerge), whatever the dates
        def mention(title, publisher, day, vote="ai-agent-exploit", ref=None):
            when = dt.datetime.fromisoformat(day + "T10:00:00+00:00")
            return cluster.Mention(title=title, excerpt="", aliases={"claude code"}, publisher=publisher, sid=publisher,
                                   type_vote=(vote, None, "test"), published=when, fresh=when, ref=ref)
        a = mention("Claude Code flaw leaked developers' API keys", "BleepingComputer", "2026-11-21")
        self.assertTrue(cluster._same_issue(a, mention("Anthropic Patches Claude Code Flaw That Leaked Developer Keys",
                                                       "SecurityWeek", "2026-11-22")))
        self.assertFalse(cluster._same_issue(a, mention("Anthropic Patches Claude Code Flaw That Leaked Developer Keys",
                                                        "SecurityWeek", "2026-11-22", vote="prompt-injection")))
        b = mention("Claude Code flaw leaked API keys and exposed secrets", "BleepingComputer", "2026-11-21")
        self.assertFalse(cluster._same_issue(b, mention("Anthropic Patches Claude Code Flaw That Exposed Secrets and "
                                                        "Leaked Keys", "SecurityWeek", "2026-11-22")))
        # two different incident-database incidents are two findings, whatever words they share
        self.assertFalse(cluster._same_issue(
            mention("Claude Code flaw exposed developer secrets", "Outlet A", "2026-11-22", ref="aiid:1"),
            mention("Claude Code flaw exposed developer secrets", "Outlet B", "2026-11-22", ref="aiid:2")))

    def test_plurals_fold_and_product_words_never_count(self):
        def mention(title, aliases=("github copilot chat",)):
            return cluster.Mention(title=title, aliases=set(aliases))
        self.assertEqual(cluster._issue_words(mention("Flaw exposed developers' secrets")), {"developer"})
        self.assertEqual(cluster._impact_words(mention("GitHub Copilot Chat bug exposed chats")), {"exposed"})



class LegalNamesAndSlugs(unittest.TestCase):
    """legal-name-entity-overredaction and url-withheld-product-slugs."""

    def test_an_entity_after_a_legal_verb_is_no_person(self):
        for title in ("Treasury Sanctions Sinbad Mixer Over Lazarus Laundering",
                      "Police Arrest Hyperverse Promoter Over $1.7 Billion Crypto Scheme",
                      "DOJ Charges Tornado Cash Developers Over Laundering"):
            with self.subTest(title=title):
                found = []
                self.assertEqual(safety.redact_people(title, found=found), (title, 0))
                self.assertEqual(safety.person_tokens(found), set())
        # a name after a legal verb is still a person's, in Title Case too
        for title, name in (("Feds Charge John Smith Over $5 Million Crypto Theft", "John Smith"),
                            ("Police Arrest Wang Xiaoming Over Crypto Scam", "Wang Xiaoming"),
                            ("Police Arrest Founder John Weiss Over Exchange Collapse", "John Weiss")):
            with self.subTest(title=title):
                out, n = safety.redact_people(title)
                self.assertGreater(n, 0)
                self.assertNotIn(name.split()[-1], out)

    def test_an_ai_products_name_in_a_slug_is_not_a_persons(self):
        claude = {"Claude"}
        for url in ("https://www.bleepingcomputer.com/news/security/anthropic-fixes-claude-code-flaw-secrets/",
                    "https://www.securityweek.com/claude-code-flaw-exposed-secrets-of-thousands-of-developers/",
                    "https://example.com/news/claude-opus-4-jailbreak/"):
            with self.subTest(url=url):
                self.assertFalse(safety.url_names_person(url, claude))
        for url in ("https://example.com/news/claude-says-he-lost-40000-to-ai-voice-clone/",
                    "https://example.com/news/claude-code-flaw-and-claude-who-lost-money/"):
            with self.subTest(url=url):
                self.assertTrue(safety.url_names_person(url, claude))
        self.assertTrue(safety.url_names_person("https://example.com/news/trader-kruw-says-wallet-hacked/", {"Kruw"}))


class SlugPipelines(Scenario):
    def test_product_links_stay_when_a_product_name_is_also_a_persons(self):
        doc = self.run_radar("2026-11-24", None, {
            "aiid": [news("Retiree says cloned voice of grandson tricked him into wiring $40,000",
                          "https://news.example.org/2026/11/22/cloned-voice-grandson", "2026-11-23",
                          "Claude said he lost $40,000 after a call that used an AI voice clone of his grandson.")],
            "securityweek": [news("Claude Code Flaw Exposed Secrets of Thousands of Developers",
                                  "https://www.securityweek.com/claude-code-flaw-secrets/", "2026-11-23",
                                  "A Claude Code flaw exposed secrets of thousands of developers, Anthropic said.", 14)],
            "bleepingcomputer": [news("Anthropic fixes Claude Code flaw that exposed developer secrets",
                                      "https://www.bleepingcomputer.com/news/security/anthropic-fixes-claude-code-flaw/",
                                      "2026-11-23", "Anthropic fixed a Claude Code flaw that exposed developer secrets.", 15)]})
        sources = [s for i in self.incidents(doc) if i["protocol"] == "Claude Code" for s in i["sources"]]
        self.assertEqual(len(sources), 2)
        for src in sources:
            self.assertNotIn("urlWithheld", src)
            self.assertIn("claude-code", src["url"])

    def test_a_sanctioned_mixer_keeps_its_name_across_the_run(self):
        doc = self.run_radar("2026-11-24", None, {
            "decrypt": [news("Treasury Sanctions Sinbad Mixer Over Lazarus Laundering",
                             "https://decrypt.co/350001/treasury-sanctions-sinbad-mixer", "2026-11-23",
                             "The US Treasury sanctioned the Sinbad mixer, which laundered funds stolen by Lazarus.")],
            "thedefiant": [news("Police Arrest Hyperverse Promoter Over $1.7 Billion Crypto Scheme",
                                "https://thedefiant.io/news/hacks/police-arrest-hyperverse-promoter", "2026-11-23",
                                "Police arrested a promoter of the Hyperverse crypto scheme.")]})
        text = json.dumps(doc, ensure_ascii=False)
        self.assertNotIn("named person", text)
        self.assertIn("Treasury Sanctions Sinbad Mixer Over Lazarus Laundering", text)
        self.assertIn("https://decrypt.co/350001/treasury-sanctions-sinbad-mixer", text)



SENSITIVE_FEEDS = {
    "aiid": [news("Teen charged over deepfake nude images of classmates",
                  "https://news.example.org/2026/11/23/teen-charged-deepfake-nude-images-classmates", "2026-11-23",
                  "Prosecutors charged a teenager over AI-generated nude images of classmates.")],
    "bleepingcomputer": [news("Hackers steal nude photos from AI companion app users",
                              "https://www.bleepingcomputer.com/news/security/hackers-steal-nude-photos-ai-companion-app/",
                              "2026-11-23", "A breach of the AI companion app exposed private images of 400,000 users, "
                              "the company said.", 12)],
}


class OwnerReview(Scenario):
    """sensitive-drop-is-silent."""

    def test_the_hold_carries_a_reason_and_a_type_never_the_words(self):
        from .test_ai_lane import assess
        creation = assess("aiid", "Teen charged over deepfake nude images of classmates")
        self.assertFalse(creation["security"])
        self.assertIn("owner decision", creation["reason"])
        self.assertIsNone(creation["hold"]["suggestedType"])
        breach = assess("bleepingcomputer", "Hackers steal nude photos from AI companion app users",
                        "A breach of the AI companion app exposed private images of 400,000 users.")
        self.assertEqual(breach["hold"]["suggestedType"], "ai-data-exposure")
        self.assertNotIn("hold", assess("bleepingcomputer", "OpenRouter drops AI providers over leaked prompts"))

    def test_held_items_reach_the_json_and_the_md_as_a_count_and_a_reason(self):
        root_name = "held"
        doc = self.run_radar("2026-11-24", None, SENSITIVE_FEEDS, name=root_name)
        self.assertEqual(doc["counts"]["ownerReview"], 2)
        self.assertEqual(doc["counts"]["candidates"], 0)
        self.assertEqual(doc["unclustered"], [])
        rows = {r["sourceId"]: r for r in doc["ownerReview"]}
        self.assertEqual(set(rows), {"aiid", "bleepingcomputer"})
        self.assertEqual(rows["bleepingcomputer"]["suggestedType"], "ai-data-exposure")
        self.assertIsNone(rows["aiid"]["suggestedType"])
        for row in rows.values():
            self.assertEqual(set(row) & {"title", "excerpt", "url"}, set())
            self.assertTrue(row["urlRef"].startswith("u:") and row["reason"] and row["date"] == "2026-11-23")
        self.assertEqual({s["id"]: s["heldForOwner"] for s in doc["sources"]}, {"aiid": 1, "bleepingcomputer": 1})
        # every held item of a feed, fresh or not, is counted with its reason on its source row
        reasons = {s["id"]: s["heldForOwnerReasons"] for s in doc["sources"]}
        self.assertEqual(reasons["aiid"], {rows["aiid"]["reason"]: 1})
        self.assertEqual(reasons["bleepingcomputer"], {rows["bleepingcomputer"]["reason"]: 1})
        self.assertTrue(any("held back for the owner" in w for w in doc["warnings"]))
        with open(os.path.join(self.tmp, root_name, "out", "2026-11-24.md"), encoding="utf-8") as fh:
            md = fh.read()
        self.assertIn("## Held back for the owner (words withheld)", md)
        self.assertIn("suggested type: data exposure through an AI tool", md)
        text = (json.dumps(doc, ensure_ascii=False) + md).lower()
        for word in ("nude", "classmates", "companion", "teen", "news.example.org", "hackers-steal"):
            self.assertNotIn(word, text)


if __name__ == "__main__":
    unittest.main()
