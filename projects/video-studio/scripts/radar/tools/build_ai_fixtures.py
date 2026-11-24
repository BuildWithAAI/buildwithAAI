"""Rebuild the recorded fixtures of the AI-security lane's sources from raw feed bodies saved on 2026-11-24.

Usage: python3 -I scripts/radar/tools/build_ai_fixtures.py FEEDS_DIR OUT_DIR

FEEDS_DIR holds the raw responses (aiid, unit42, msft, etr, bleep, record, swkall, dark, krebs, each <name>.body);
they are not committed (full feeds). The committed fixtures are the output of this script:

- only the selected items: AI-security positives and today's hard negatives (sponsored posts, launches, deals, press
  releases, opinion, AI incidents that are not security);
- every description cut to at most 280 characters (WordPress footers and the AI Incident Database's citation link
  kept, because the parsers read them);
- personal names redacted with the radar's own rules (safety.redact_people) in every title, description and
  category; categories of feeds that tag people are dropped;
- author names replaced: Dark Reading's bylined items get "Dark Reading staff" (wire press releases have none),
  BleepingComputer's sponsored posts keep "Sponsored by <company>"; no other author field is written.
"""

import html
import os
import re
import sys
import xml.etree.ElementTree as ET

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from radarlib import safety  # noqa: E402

FEEDS, OUT = sys.argv[1], sys.argv[2]
os.makedirs(OUT, exist_ok=True)
LIMIT = 280
FOOTER = re.compile(r"\s*(The post\s.+?\sappeared first on\s[^.]+?\s?\.?)\s*(?:…)?\s*$", re.DOTALL)
CITE = re.compile(r"\s*(?:\.\.\.|…)?\s*(\((?:https://incidentdatabase\.ai/cite/\d+#\d+|report_number: \d+)\))\s*$")


def cut(text, limit=LIMIT):
    text = " ".join((text or "").split())
    if len(text) <= limit:
        return text
    text = text[: limit - 1]
    if " " in text[-40:]:
        text = text[: text.rfind(" ")]
    return text.rstrip(" ,;:") + "…"


def redact(text):
    return safety.redact_people(text or "")[0]


def local(tag):
    return tag.rsplit("}", 1)[-1]


def text_of(el):
    raw = "".join(el.itertext()) if len(el) else (el.text or "")
    return html.unescape(re.sub(r"<[^>]+>", " ", raw))


def items_of(name):
    root = ET.fromstring(open(os.path.join(FEEDS, f"{name}.body"), "rb").read())
    out = []
    for it in root.iter():
        if local(it.tag) != "item":
            continue
        d = {"cats": [], "creator": ""}
        for c in it:
            k = local(c.tag)
            if k == "title":
                d["title"] = " ".join(text_of(c).split())
            elif k == "link":
                d["link"] = (c.text or "").strip()
            elif k == "pubDate":
                d["pubDate"] = (c.text or "").strip()
            elif k == "description":
                d["description"] = text_of(c).strip()
            elif k == "guid":
                d["guid"] = (c.text or "").strip()
                d["guidPermalink"] = c.get("isPermaLink", "true")
            elif k == "category":
                d["cats"].append((c.text or "").strip())
            elif k == "creator":
                d["creator"] = (c.text or "").strip()
        out.append(d)
    return out


def pick(items, needles):
    chosen = []
    for needle in needles:
        for it in items:
            if needle in it.get("title", ""):
                chosen.append(it)
                break
        else:
            raise SystemExit(f"missing item {needle!r}")
    return chosen


def cdata(text):
    return "<![CDATA[" + text.replace("]]>", "]]]]><![CDATA[>") + "]]>"


def esc(text):
    return html.escape(text, quote=False)


HEAD = ('<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/" '
        'xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:atom="http://www.w3.org/2005/Atom">\n<channel>\n')


def description(it, keep_footer=False, keep_cite=False):
    desc = " ".join((it.get("description") or "").split())
    tail = ""
    if keep_cite:
        m = CITE.search(desc)
        if m:
            desc, tail = desc[: m.start()], " ... " + m.group(1)
    elif keep_footer:
        m = FOOTER.search(desc)
        if m:
            desc, tail = desc[: m.start()], " " + m.group(1)
    body = redact(cut(desc, LIMIT - len(tail)))
    return body + tail


def write(name, channel, link, items, *, style="cdata", keep_footer=False, keep_cite=False, creator=None,
          categories=True):
    parts = [HEAD, f"  <title>{esc(channel)}</title>\n  <link>{esc(link)}</link>\n",
             "  <description>Trimmed fixture (2026-11-24): selected items, excerpts of at most 280 characters, "
             "names redacted, no author names.</description>\n"]
    for it in items:
        title = redact(it["title"])
        desc = description(it, keep_footer, keep_cite)
        parts.append("  <item>\n")
        parts.append(f"    <title>{cdata(title) if style == 'cdata' else esc(title)}</title>\n")
        parts.append(f"    <link>{esc(it['link'])}</link>\n")
        if it.get("guid"):
            parts.append(f"    <guid isPermaLink=\"{it.get('guidPermalink', 'true')}\">{esc(it['guid'])}</guid>\n")
        parts.append(f"    <pubDate>{it['pubDate']}</pubDate>\n")
        byline = creator(it) if creator else None
        if byline:
            parts.append(f"    <dc:creator>{cdata(byline)}</dc:creator>\n")
        if categories:
            for cat in it["cats"][:4]:
                parts.append(f"    <category>{cdata(redact(cat))}</category>\n")
        parts.append(f"    <description>{cdata(desc) if style == 'cdata' else esc(desc)}</description>\n")
        parts.append("  </item>\n")
    parts.append("</channel>\n</rss>\n")
    with open(os.path.join(OUT, name), "w", encoding="utf-8") as fh:
        fh.write("".join(parts))


write("unit42-blog.xml", "Unit 42", "https://unit42.paloaltonetworks.com/", pick(items_of("unit42"), [
    "Recent Trends and Tactics of Agentic AI Attacks",
    "Dialing for Data",
    "Attackers Use Autonomous AI to Target Semiconductor",
    "Unit 42 Threat Intelligence Highlights",
]), keep_footer=True)
write("msft-security-blog.xml", "Microsoft Security Blog", "https://www.microsoft.com/en-us/security/blog/",
      pick(items_of("msft"), [
          "Microsoft named a Leader in the 2026 Gartner",
          "Security for the agentic era, powered by Microsoft Perception",
          "The risks of device code authentication for AI coding agents",
          "Trained to betray",
          "Detecting sleeper agents hiding in AI model neurons",
      ]), keep_footer=True)
write("embracethered-blog.xml", "Embrace The Red", "https://embracethered.com/blog/", pick(items_of("etr"), [
    "Visual Studio Copilot and SSMS Remote Code Execution",
    "Breaking Claude Code Opus 5 Auto Mode",
    "LLM Heist: Hijacking LiteLLM",
    "Escaping Linux Sandboxes via PipeWire",
]), style="plain")
write("bleepingcomputer.xml", "BleepingComputer", "https://www.bleepingcomputer.com/", pick(items_of("bleep"), [
    "From Vulnerability Noise to Resilience",
    "New Shirudo tool uses AI",
    "OpenRouter drops AI providers over leaked prompts and secrets",
    "Microsoft Azure flaw exploited",
    "AI Agents Are Creating a Shared Responsibility Gap",
    "Hackers compromise Check Point Servers",
]), creator=lambda it: it["creator"] if it["creator"].lower().startswith("sponsored by") else None)
write("therecord.xml", "The Record by Recorded Future", "https://therecord.media/", pick(items_of("record"), [
    "Carnegie Endowment for International Peace",
    "UK cyber agency seeing",
    "McDonald’s Japan discloses breach",
]), style="plain")
write("securityweek.xml", "SecurityWeek", "https://www.securityweek.com/", pick(items_of("swkall"), [
    "European Commission Uncovers Data Breach",
    "Check Point Security Management Servers Hacked in AI-Assisted Campaign",
    "Anthropic Expands Enterprise Safeguards",
    "OpenAI, Cisco Unveil Open Source Tool",
    "Azure Flaw Exploited to Target Secrets",
]), keep_footer=True)
write("darkreading.xml", "Dark Reading", "https://www.darkreading.com/", pick(items_of("dark"), [
    "CrowdStrike Makes AI Security Push",
    "AI Agents Zip From Flaw Discovery to Root Access",
    "Microsoft Debuts Offensive, Defensive Security Tools",
    "Navigating Vulnerability Hysteria in the AI Era",
    "Strike Graph Launches Integration AI",
    "Cursor Traces Malicious Claude Code Extensions",
    "Attackers in Binance Breach Targeted Known Weakness",
    "AI Coding Agents Leak Thousands of Secrets to GitHub",
]), creator=lambda it: "Dark Reading staff" if it["creator"] else None)
write("krebsonsecurity.xml", "Krebs on Security", "https://krebsonsecurity.com/", pick(items_of("krebs"), [
    "Indicted for Wire Fraud",
    "Attackers Used Optimizely",
    "Microsoft Fixes Nearly 1,100 Security Vulnerabilities",
]), categories=False)
write("aiid.xml", "AI Incident Database RSS Feed", "https://incidentdatabase.ai", pick(items_of("aiid"), [
    "Claude Code settings.local.json Secrets",
    "Coding Agents Copy Your Secrets to a Hidden File",
    "Claude Code’s ‘don’t ask again’ button",
    "Waymo pauses robotaxi service amid San Francisco storms",
    "123 Reg discloses",
    "United Airlines Is Banning AI Bots",
    "Weill Cornell patient data entered into AI tools",
    "Prosecutors indict 57 over AI-powered romance scam",
]), keep_cite=True, categories=False)
print("fixtures written to", OUT)
