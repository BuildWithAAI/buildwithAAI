"""Rebuild the recorded fixtures from raw payloads saved by a polite probe.

Usage: python3 -I scripts/radar/tools/build_fixtures.py PROBE_DIR OUT_DIR

PROBE_DIR holds raw responses saved on 2026-11-24 (r1/, r2/, r3/ as named below);
they are not committed (full feeds and pages). The committed fixtures are the
output of this script.
Keeps only selected items, cuts every description to <= 280 characters, drops
author/creator fields and images, and preserves each feed's structure
(namespaces, CDATA, escaped HTML, Atom xhtml content).
"""

import html
import json
import os
import re
import sys
import xml.etree.ElementTree as ET

PROBE, OUT = sys.argv[1], sys.argv[2]
os.makedirs(OUT, exist_ok=True)
LIMIT = 280


def cut(text, limit=LIMIT):
    text = " ".join((text or "").split())
    if len(text) <= limit:
        return text
    text = text[: limit - 1]
    if " " in text[-40:]:
        text = text[: text.rfind(" ")]
    return text.rstrip(" ,;:") + "…"


def local(tag):
    return tag.rsplit("}", 1)[-1]


def text_of(el):
    return html.unescape(re.sub(r"<[^>]+>", " ", "".join(el.itertext()) if len(el) else (el.text or "")))


def rss_items(path):
    root = ET.fromstring(open(path, "rb").read())
    out = []
    for it in root.iter():
        if local(it.tag) != "item":
            continue
        d = {"cats": []}
        for c in it:
            k = local(c.tag)
            if k == "title":
                d["title"] = (c.text or "").strip()
            elif k == "link":
                d["link"] = (c.text or "").strip()
            elif k == "pubDate":
                d["pubDate"] = (c.text or "").strip()
            elif k == "description":
                value = text_of(c).strip()
                if value:
                    d["description"] = value
            elif k == "guid":
                d["guid"] = (c.text or "").strip()
                d["guidPermalink"] = c.get("isPermaLink", "true")
            elif k == "category":
                d["cats"].append(((c.text or "").strip(), c.get("domain")))
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


def write(name, body):
    with open(os.path.join(OUT, name), "w", encoding="utf-8") as fh:
        fh.write(body)


RSS_HEAD = (
    '<?xml version="1.0" encoding="UTF-8"?>\n'
    '<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" '
    'xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:atom="http://www.w3.org/2005/Atom" '
    'xmlns:media="http://search.yahoo.com/mrss/">\n<channel>\n'
)


def rss(name, channel_title, link, items, style):
    """style: cdata | plain | html-desc | encoded"""
    parts = [RSS_HEAD, f"  <title>{esc(channel_title)}</title>\n  <link>{esc(link)}</link>\n",
             "  <description>Trimmed fixture: titles, links, dates and excerpts of at most 280 characters.</description>\n"]
    for it in items:
        desc = cut(it.get("description", ""))
        title = it["title"]
        parts.append("  <item>\n")
        parts.append(f"    <title>{cdata(title) if style == 'cdata' else esc(title)}</title>\n")
        parts.append(f"    <link>{esc(it['link'])}</link>\n")
        if it.get("guid"):
            parts.append(f"    <guid isPermaLink=\"{it.get('guidPermalink', 'true')}\">{esc(it['guid'])}</guid>\n")
        parts.append(f"    <pubDate>{it['pubDate']}</pubDate>\n")
        for cat, domain in it["cats"][:4]:
            dom = f' domain="{esc(domain)}"' if domain else ""
            parts.append(f"    <category{dom}>{cdata(cat) if style == 'cdata' else esc(cat)}</category>\n")
        if style == "html-desc":
            parts.append(f"    <description>{esc('<p>' + esc(desc) + '</p>')}</description>\n")
        elif style == "cdata":
            parts.append(f"    <description>{cdata('<p>' + esc(desc) + '</p>')}</description>\n")
        elif style == "encoded":
            parts.append(f"    <description>{esc(desc)}</description>\n")
            parts.append(f"    <content:encoded>{cdata('<p>' + esc(desc) + '</p>')}</content:encoded>\n")
        else:
            parts.append(f"    <description>{esc(desc)}</description>\n")
        parts.append("  </item>\n")
    parts.append("</channel>\n</rss>\n")
    write(name, "".join(parts))


P1, P2, P3 = (os.path.join(PROBE, d) for d in ("r1", "r2", "r3"))

rss("coindesk.xml", "CoinDesk", "https://www.coindesk.com/", pick(rss_items(f"{P1}/01-www.coindesk.com.body"), [
    "Binance hackers push $247 million",
    "Crypto thieves are using online ads",
    "Bitcoin sold for $17,000 on Kraken",
    "U.S. CFTC sets policies on event contract data",
]), "cdata")
rss("decrypt.xml", "Decrypt", "https://decrypt.co/feed", pick(rss_items(f"{P1}/02-decrypt.co.body"), [
    "North Korea Moves $247 Million of Binance Hack Loot",
    "Wrapped Monero Token Collapses 99%",
    "Citi Says Customers Are Responsible When AI Banking Agents",
]), "plain")
rss("cointelegraph.xml", "Cointelegraph.com News", "https://cointelegraph.com", pick(rss_items(f"{P1}/03-cointelegraph.com.body"), [
    "Chainflip confirms $12M hack",
    "South Korean exchanges halt CYBER transfers",
    "US seeks to recover $1.1B in crypto stolen",
    "MoldyRoost",
]), "html-desc")
rss("theblock.xml", "The Block", "https://www.theblock.co", pick(rss_items(f"{P1}/04-www.theblock.co.body"), [
    "DOJ seeks $1.17 billion in USDC tied to Binance hack",
    "Pump.fun draws criticism over private key imports",
    "Kalshi halts operations in Utah",
]), "plain")
rss("thedefiant.xml", "The Defiant", "https://thedefiant.io", pick(rss_items(f"{P1}/05-thedefiant.io.body"), [
    "Chainflip Suspects Key Theft",
    "Cyber Bridge Hack Followed",
    "Reuters: Circle, World Liberty Ordered",
    "Stake DAO Warns of Forum Breach",
    "Wiz Says Attacker Mined AI Coding Histories",
]), "encoded")
rss("chainalysis-blog.xml", "Blog - Chainalysis", "https://www.chainalysis.com/blog/", pick(rss_items(f"{P1}/06-www.chainalysis.com.body"), [
    "DPRK Hackers Perfected Their Fake Interview Playbook",
    "The $6.4 Billion Binance Hack",
    "How Chain, Our AI Workspace",
]), "cdata")
rss("dlnews.xml", "DL News", "https://www.dlnews.com", pick(rss_items(f"{P2}/06-www.dlnews.com_arc_outboundfeeds_rss_"), [
    "Binance obtains $6.5 billion freezing order",
    "Drift to issue",
]), "plain")
rss("cryptonews.xml", "crypto.news", "https://crypto.news", pick(rss_items(f"{P2}/10-crypto.news_feed_"), [
    "Trezor and Exodus wallets lose $600K",
    "Bitcoin price struggles near $60K",
]), "plain")
rss("coinedition.xml", "Coin Edition", "https://coinedition.com", pick(rss_items(f"{P2}/11-coinedition.com_feed_"), [
    "DOJ Targets $1B in USDC",
    "Chainflip Loses $12.6M",
]), "html-desc")

# ---- Atom (web3isgoinggreat)
ns = {"a": "http://www.w3.org/2005/Atom"}
root = ET.fromstring(open(f"{P1}/07-www.web3isgoinggreat.com.body", "rb").read())
want = ["Fusionist exploited", "Cyber bridge exploited", "Chainflip loses $12 million",
        "Lighter user(s) exploited", "Initia suffers $2.7 million loss", "Mercado Bitcoin halts withdrawals"]
entries = []
for needle in want:
    for e in root.findall("a:entry", ns):
        if needle in e.find("a:title", ns).text:
            entries.append(e)
            break
    else:
        raise SystemExit(f"missing entry {needle}")
parts = ['<?xml version="1.0" encoding="utf-8" ?>\n<feed xmlns="http://www.w3.org/2005/Atom">\n',
         '  <id>https://web3isgoinggreat.com/feed.xml</id>\n  <title type="html">Web3 is Going Just Great</title>\n',
         '  <link rel="self" href="https://web3isgoinggreat.com/feed.xml" />\n  <rights type="html">CC-BY-SA 3.0</rights>\n',
         '  <updated>2026-11-22T23:07:42.834Z</updated>\n']
for e in entries:
    title = e.find("a:title", ns).text
    link = e.find("a:link", ns).get("href")
    content = " ".join("".join(e.find("a:content", ns).itertext()).split())
    parts.append("  <entry>\n")
    parts.append(f'    <title type="html">{esc(title)}</title>\n')
    parts.append(f'    <published>{e.find("a:published", ns).text}</published>\n')
    parts.append(f'    <updated>{e.find("a:updated", ns).text}</updated>\n')
    parts.append(f'    <link href="{esc(link)}" />\n    <id>{esc(link)}</id>\n')
    parts.append('    <content type="xhtml">\n      <div xmlns="http://www.w3.org/1999/xhtml"><p>'
                 + esc(cut(content)) + "</p></div>\n    </content>\n")
    parts.append("  </entry>\n")
parts.append("</feed>\n")
write("web3isgoinggreat.xml", "".join(parts))

# ---- DefiLlama JSON
data = json.load(open(f"{P1}/00-api.llama.fi.body"))
names = [("Binance CEX", None), ("Chainflip AMM", 1795219200), ("CyberConnect", None), ("Endurance Bridge", None),
         ("Lighter Perps", None), ("Kava Lend", None), ("Initia", None), ("Wagyu (XMR1)", None),
         ("Fluidkey", None), ("K3 Capital", None), ("Peapods Finance", None), ("LUKSO", None),
         ("Gonka AI", None), ("Mercado Bitcoin", None)]
records = []
for name, date in names:
    for rec in data:
        if rec["name"] == name and (date is None or rec["date"] == date) and rec["date"] >= 1790000000:
            r = dict(rec)
            r["description"] = cut(r.get("description") or "")
            records.append(r)
old = [r for r in data if r["date"] < 1500000000][:1]
for r in old:
    r = dict(r)
    r["description"] = cut(r.get("description") or "")
    records.append(r)
records.append({"name": None, "date": 1795219200, "amount": 5})
records.append({"name": "Broken Date", "date": "2026-11-20", "amount": 5})
with open(os.path.join(OUT, "defillama-hacks.json"), "w", encoding="utf-8") as fh:
    json.dump(records, fh, indent=1, ensure_ascii=False)
    fh.write("\n")

# ---- SlowMist HTML
page = open(f"{P1}/09-hacked.slowmist.io.body", encoding="utf-8").read()
lis = re.findall(r"<li>\s*<span class=\"time\">.*?</li>", page, re.S)
keep = []
for li in lis:
    target = re.search(r"Hacked target: </em>(.*?)</h3>", li).group(1)
    if target in ("Endurance Bridge", "Chainflip", "Cyber Bridge", "Wagyu (XMR1)", "Lighter", "Kava Lend"):
        desc = re.search(r"Description of the event: </em>(.*?)</p>", li, re.S)
        trimmed = esc(cut(html.unescape(desc.group(1))))
        li = li[: desc.start(1)] + trimmed + li[desc.end(1):]
        keep.append(li)
slowmist = ("<!DOCTYPE html>\n<html>\n<head>\n<meta charset=\"utf-8\">\n<title>SlowMist Hacked - SlowMist Zone</title>\n"
            "<script>var trimmed = 'fixture';</script>\n</head>\n<body>\n<div class=\"case-box\">\n"
            "<div class=\"case-content\">\n<ul>\n" + "\n".join(keep) + "\n</ul>\n</div>\n"
            "<ul class=\"pagination\"><li class=\"disabled\"><a href=\"javascript:;\">Page 1 of 120</a></li></ul>\n"
            "</div>\n<div class=\"footer\"><p>Copyright SlowMist Hacked All Rights Reserved.</p></div>\n</body>\n</html>\n")
write("slowmist-hacked.html", slowmist)

# ---- rekt.news HTML
page = open(f"{P1}/08-rekt.news.body", encoding="utf-8").read()
arts = re.findall(r"<article class=\"post[^\"]*\">.*?</article>", page, re.S)
keep = []
for art in arts:
    if any(k in art for k in ("/lighter-rekt", "/kava-lend-rekt", "/mercado-rekt", "/binance-rekt", "/is-the-internet-rekt")):
        m = re.search(r"<section class=\"post-excerpt\"><p>(.*?)</p>", art, re.S)
        art = art[: m.start(1)] + esc(cut(html.unescape(m.group(1)))) + art[m.end(1):]
        keep.append(art)
rekt = ("<!DOCTYPE html><html lang=\"en\"><head><title>Rekt - Home</title><meta charSet=\"utf-8\"/></head><body>"
        "<div class=\"site-wrapper\"><main>" + "".join(keep) + "</main></div>"
        "<script id=\"__NEXT_DATA__\" type=\"application/json\">{\"props\":{}}</script></body></html>\n")
write("rekt-news.html", rekt)


# ---- blog cards (CertiK, TRM)
def cards(path, prefix, wanted):
    page = open(path, encoding="utf-8").read()
    out = []
    for needle in wanted:
        idx = page.find(f'href="{prefix}{needle}')
        if idx < 0:
            raise SystemExit(f"missing card {needle}")
        start = page.rfind("<a ", 0, idx)
        end = page.find("</a>", idx) + 4
        block = re.sub(r"<img[^>]*>", "", page[start:end])
        block = re.sub(r"\s(?:srcSet|sizes|style|data-reveal|aria-labelledby)=\"[^\"]*\"", "", block)
        out.append("<li>" + block + "</li>")
    return out


certik = cards(f"{P3}/01-www.certik.com_blog", "/blog/", [
    "arcus-incident-analysis", "certik-uncovers-polinrider-linked-malware", "how-a-regulated-rwa-platform"])
write("certik-blog.html", "<!DOCTYPE html><html><head><meta charset=\"utf-8\"><title>Blog | CertiK</title></head><body>"
      "<nav><a href=\"/blog/all\">All</a><a href=\"/blog/research\">Research</a></nav><ul>"
      + "".join(certik) + "</ul></body></html>\n")
trm = cards(f"{P3}/00-www.trmlabs.com_resources_blog", "/resources/blog/", [
    "trm-labs-threat-disruption-center", "leaked-documents-shed-light"])
write("trm-blog.html", "<!DOCTYPE html><html><head><meta charset=\"utf-8\"><title>Blog | TRM Labs</title></head><body><ul>"
      + "".join(f"<article>{c}</article>" for c in trm) + "</ul></body></html>\n")
print("fixtures written to", OUT)
