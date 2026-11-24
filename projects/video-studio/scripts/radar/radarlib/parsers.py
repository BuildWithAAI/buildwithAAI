"""Source parsers. Each takes (body: bytes, source: dict, ctx: dict) and returns
(items, warnings). Items are plain dicts holding only a title, a URL, dates, an
excerpt of at most 280 characters and a few structured fields. Parsers raise
ParseError when the page or feed has no recognisable structure; the caller then
skips the source with a warning, so a bad page never crashes a run.

Feed safety: XML is parsed with xml.etree.ElementTree (expat: no external entity
or network resolution). Before that, a structural pre-scan with expat itself refuses
any document with an internal DTD subset or an entity declaration, wherever it
appears and in any encoding (a long comment before the DOCTYPE or a UTF-16 body
cannot hide one). Feed text is only ever treated as data.

Caveats about the mechanism ("the exact mechanism remains under investigation",
"suspected compromise") are often past the first 280 characters, so each parser
reads them from the FULL text and stores the qualifying sentence (280 characters at
most) as its own field, with the mechanism status.
"""

import datetime as dt
import json
import re
import urllib.parse
import xml.etree.ElementTree as ET
from xml.parsers import expat

from .classify import mechanism_qualifier, origin_of
from .htmldom import parse_html
from .textutil import (
    EXCERPT_MAX, MONEY_RE, clean_ws, format_usd_exact, html_to_text, iso_z, money_value,
    parse_any_date, parse_iso, parse_rfc822, truncate,
)

PARSER_VERSION = "2026-11-24.3"
MAX_ITEMS = 200


class ParseError(Exception):
    pass


def first_sentence(text, limit=200):
    text = clean_ws(text)
    match = re.search(r"(?<=[.!?])\s+(?=[A-Z0-9“\"(])", text)
    sentence = text[: match.start()] if match else text
    return truncate(sentence, limit)


def _qualify(item, full_text, publisher=""):
    """Adds the mechanism status and qualifying sentence read from the full text, and the organisation the item
    relays (its origin), to a parsed item."""
    status, sentence = mechanism_qualifier(full_text)
    if status:
        item["mechanismStatus"] = status
        item["qualifier"] = truncate(sentence, EXCERPT_MAX)
    origin = origin_of(full_text, publisher)
    if origin:
        item["origin"] = origin
    return item


def clean_url(url, base=None):
    if not url:
        return None
    url = url.strip()
    if base:
        url = urllib.parse.urljoin(base, url)
    parts = urllib.parse.urlsplit(url)
    if parts.scheme not in ("http", "https"):
        return None
    query = [(k, v) for k, v in urllib.parse.parse_qsl(parts.query, keep_blank_values=True)
             if not k.lower().startswith("utm_")]
    return urllib.parse.urlunsplit((parts.scheme, parts.netloc, parts.path, urllib.parse.urlencode(query), ""))


# ------------------------------------------------------------------ DefiLlama

DEFILLAMA_FIELDS = {
    # field: (expected types, meaning) -- verified against the live API on 2026-11-24
    "date": "int: Unix seconds at 00:00 UTC of the incident day",
    "name": "str: protocol / target name, sometimes with a parenthetical (e.g. 'Wagyu (XMR1)')",
    "classification": "str|null: one of 13 classes (Access Control, Protocol Logic, Key Compromise, ...)",
    "technique": "str|null: one of ~80 techniques (Private Key Compromised, DNS Hijack, Phishing, ...)",
    "amount": "int|float|null: USD loss as recorded by DefiLlama",
    "chain": "list[str]|null: affected chains",
    "bridgeHack": "bool",
    "targetType": "str: DeFi Protocol, CEX, Wallet, Token, Chain, ...",
    "source": "str: reference URL; empty for every record on 2026-11-24",
    "returnedFunds": "int|float|null: USD returned",
    "defillamaId": "str|null: DefiLlama protocol id or 'chain#<slug>'",
    "parentProtocolId": "str|null (optional key): 'parent#<slug>'",
    "language": "str|null: contract language (Solidity, Rust, ...)",
    "description": "str|null: free-text summary (stored truncated to 280 chars)",
}


def _num(value):
    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value) if value == value else None
    return None


def parse_defillama_hacks(body, source, ctx):
    try:
        data = json.loads(body.decode("utf-8") if isinstance(body, bytes) else body)
    except (ValueError, UnicodeDecodeError) as err:
        raise ParseError(f"not JSON: {err}") from None
    if not isinstance(data, list):
        raise ParseError("expected a JSON array of hack records")
    run_date = ctx["runDate"]
    max_age = int(ctx.get("maxAgeDays", 120))
    items, warnings, bad = [], [], 0
    api_url = source["url"]
    for record in data:
        try:
            if not isinstance(record, dict) or not isinstance(record.get("name"), str):
                raise ValueError("missing name")
            stamp = record.get("date")
            if isinstance(stamp, bool) or not isinstance(stamp, (int, float)):
                raise ValueError("missing date")
            day = dt.datetime.fromtimestamp(int(stamp), dt.timezone.utc).date()
        except (ValueError, OverflowError, OSError):
            bad += 1
            continue
        if day > run_date + dt.timedelta(days=1) or (run_date - day).days > max_age:
            continue
        name = clean_ws(record["name"])
        chains = record.get("chain") if isinstance(record.get("chain"), list) else []
        chains = [clean_ws(c) for c in chains if isinstance(c, str) and c.strip()]
        amount = _num(record.get("amount"))
        returned = _num(record.get("returnedFunds"))
        classification = clean_ws(record.get("classification") or "") or None
        technique = clean_ws(record.get("technique") or "") or None
        target = clean_ws(record.get("targetType") or "") or None
        description = clean_ws(record.get("description") or "")
        head = [name, day.isoformat()]
        head.append(f"reported loss {format_usd_exact(amount)}" if amount else "loss not stated")
        if returned:
            head.append(f"returned {format_usd_exact(returned)}")
        if classification or technique:
            head.append(f"{classification or 'Unclassified'} / {technique or 'Unknown'}")
        if target:
            head.append(f"target: {target}")
        if chains:
            head.append("chains: " + ", ".join(chains))
        if record.get("bridgeHack") is True:
            head.append("bridge hack: yes")
        excerpt = truncate(" · ".join(head) + (" · " + description if description else ""), EXCERPT_MAX)
        reference = record.get("source") if isinstance(record.get("source"), str) else ""
        qualified = {}
        _qualify(qualified, description)
        if technique == "Unknown" and "mechanismStatus" not in qualified:
            qualified.update(mechanismStatus="unknown", qualifier=f"{classification or 'Unclassified'} / Unknown")
        items.append({**qualified,
            "kind": "structured",
            "key": f"defillama:{name}@{day.isoformat()}",
            "title": f"DefiLlama hacks: {name} ({day.isoformat()})",
            "url": api_url + "#" + urllib.parse.quote(f"{name}@{day.isoformat()}"),
            "publishedUtc": None,
            "eventDate": day.isoformat(),
            "excerpt": excerpt,
            "lead": first_sentence(description) if description else "",
            "categories": [c for c in (classification, technique) if c],
            "referenceUrl": clean_url(reference) if reference else None,
            "record": {
                "name": name,
                "classification": classification,
                "technique": technique,
                "amount": amount,
                "returnedFunds": returned,
                "chains": chains,
                "bridgeHack": record.get("bridgeHack") is True,
                "targetType": target,
                "defillamaId": record.get("defillamaId") if isinstance(record.get("defillamaId"), str) else None,
                "parentProtocolId": record.get("parentProtocolId") if isinstance(record.get("parentProtocolId"), str) else None,
            },
        })
    if bad:
        warnings.append(f"{bad} malformed DefiLlama record(s) skipped")
    if not items and data and not bad:
        warnings.append(f"no DefiLlama records within {max_age} days of {run_date}")
    return items, warnings


# ------------------------------------------------------------------ RSS / Atom

def _refuse_dtd(body):
    """Structural pre-scan with expat: refuse an internal DTD subset or any entity declaration, wherever it is and in
    any encoding. External DTDs are never fetched (parameter entity parsing is off)."""
    scanner = expat.ParserCreate()
    scanner.SetParamEntityParsing(expat.XML_PARAM_ENTITY_PARSING_NEVER)

    def doctype(_name, _sysid, _pubid, has_internal_subset):
        if has_internal_subset:
            raise ParseError("feed declares an internal DTD subset (entities); refused")

    def entity(*_args):
        raise ParseError("feed declares XML entities; refused")

    scanner.StartDoctypeDeclHandler = doctype
    scanner.EntityDeclHandler = entity
    scanner.UnparsedEntityDeclHandler = entity
    try:
        scanner.Parse(body, True)
    except expat.ExpatError as err:
        raise ParseError(f"XML parse error: {err}") from None


def _local(tag):
    return tag.rsplit("}", 1)[-1] if isinstance(tag, str) else ""


def _child(elem, *names):
    for child in elem:
        if _local(child.tag) in names:
            return child
    return None


def _children(elem, *names):
    return [child for child in elem if _local(child.tag) in names]


def _elem_text(elem):
    if elem is None:
        return ""
    kind = (elem.get("type") or "").lower()
    if kind == "xhtml" or len(elem):
        return clean_ws(" ".join(elem.itertext()))
    return elem.text or ""


# "Sponsored by RapidFort" in an item's author line (BleepingComputer): only this flag is kept, never the name
_SPONSORED_BYLINE = re.compile(r"\b(?:sponsored|partner content|brought to you by|paid (?:post|content)|advertorial)\b", re.IGNORECASE)
# WordPress feeds end every summary with "The post <title> appeared first on <site>." (opt-in per source: stripFeedFooter)
_FEED_FOOTER = re.compile(r"\s*The post\s.{1,400}?\sappeared first on\s[^.]{1,80}?\s?\.?\s*(?:…)?\s*$", re.DOTALL)
# a byline check is skipped when most of a feed has no author line at all (the feed changed, not every post is a release)
BYLINE_MIN_SHARE = 0.2


def _byline_text(entry):
    """The author line of an entry (dc:creator, RSS author, Atom author/name), for flags only: never stored."""
    parts = []
    for el in _children(entry, "creator", "author"):
        parts.append(clean_ws(" ".join(el.itertext())))
    return " ".join(p for p in parts if p)


def parse_feed(body, source, ctx, on_summary=None):
    """RSS/Atom items. on_summary(summary) -> (summary, extra fields) lets a source-specific parser read the FULL
    summary before it is cut to an excerpt (the AI Incident Database's citation link sits at its very end)."""
    if isinstance(body, str):
        body = body.encode("utf-8")
    _refuse_dtd(body)
    try:
        root = ET.fromstring(body)
    except ET.ParseError as err:
        raise ParseError(f"XML parse error: {err}") from None
    root_name = _local(root.tag)
    if root_name not in ("rss", "feed", "RDF"):
        raise ParseError(f"not an RSS/Atom document (root <{root_name}>)")
    entries = [e for e in root.iter() if _local(e.tag) in ("item", "entry")]
    if not entries and root_name != "feed" and _child(root, "channel") is None:
        raise ParseError("no channel or entries")
    items, warnings, skipped = [], [], 0
    base = source.get("siteUrl") or source["url"]
    for entry in entries[:MAX_ITEMS]:
        try:
            title = html_to_text(_elem_text(_child(entry, "title")))
            link = None
            for link_el in _children(entry, "link"):
                href = link_el.get("href")
                rel = (link_el.get("rel") or "alternate").lower()
                if href and rel == "alternate":
                    link = href
                    break
                if not href and (link_el.text or "").strip():
                    link = link_el.text.strip()
                    break
            if not link:
                guid = _child(entry, "guid", "id")
                if guid is not None and (guid.text or "").startswith("http") and guid.get("isPermaLink", "true") != "false":
                    link = guid.text.strip()
            url = clean_url(link, base)
            if not title or not url:
                skipped += 1
                continue
            published = None
            for name in ("pubDate", "published", "date", "issued", "updated"):
                el = _child(entry, name)
                if el is not None and (el.text or "").strip():
                    published = parse_rfc822(el.text) if name == "pubDate" else parse_any_date(el.text)
                    if published:
                        break
            summary_el = _child(entry, "description", "summary")
            summary = html_to_text(_elem_text(summary_el))
            if not summary:
                content_el = _child(entry, "encoded", "content")
                summary = html_to_text(_elem_text(content_el))
            if source.get("stripFeedFooter"):
                summary = _FEED_FOOTER.sub("", summary).strip()
            extra = {}
            if on_summary is not None:
                summary, extra = on_summary(summary)
            categories = []
            if not source.get("dropCategories"):  # a feed whose tags name people keeps none (nothing to cache)
                for cat in _children(entry, "category", "subject"):
                    label = clean_ws(cat.get("term") or cat.text or "")
                    if label and label not in categories:
                        categories.append(label)
            item = _qualify({
                "kind": "news",
                "key": f"{source['id']}:{url}",
                "title": truncate(title, 300),
                "url": url,
                "publishedUtc": iso_z(published),
                "eventDate": None,
                "excerpt": truncate(summary, EXCERPT_MAX),
                "lead": first_sentence(summary) if summary else "",
                "categories": categories[:12],
            }, f"{title}. {summary}", source.get("publisher") or source.get("name") or "")
            byline = _byline_text(entry)
            if byline and _SPONSORED_BYLINE.search(byline):
                item["sponsored"] = True
            if source.get("bylineRequired"):
                item["byline"] = bool(byline)
            item.update(extra)
            items.append(item)
        except Exception as err:  # one bad entry must not lose the feed
            skipped += 1
            warnings.append(f"entry skipped: {type(err).__name__}")
    if skipped:
        warnings.append(f"{skipped} entr(y/ies) without title or link skipped")
    if source.get("bylineRequired") and items:
        with_byline = sum(1 for it in items if it.get("byline"))
        if with_byline < BYLINE_MIN_SHARE * len(items):
            # most items have no author line: the feed changed, so the press-release check would drop everything
            for it in items:
                it.pop("byline", None)
            warnings.append(f"byline check skipped: only {with_byline} of {len(items)} items have an author line")
    return items, warnings


# ------------------------------------------------------------------ AI Incident Database (RSS)

# every report's description ends with " ... (https://incidentdatabase.ai/cite/<incident>#<report>)", or with
# "(report_number: <n>)" while the report is not yet attached to an incident
_AIID_CITE = re.compile(r"\s*(?:\.\.\.|…)?\s*\((https://incidentdatabase\.ai/cite/(\d{1,7})(?:#\d{1,9})?)\)\s*$")
_AIID_REPORT_NO = re.compile(r"\s*(?:\.\.\.|…)?\s*\(report_number:\s*\d{1,9}\)\s*$")


def parse_aiid_feed(body, source, ctx):
    """The AI Incident Database's feed: every item is a report from ANOTHER outlet (its link is that original article).
    The citation link at the end of the description becomes the item's incident reference ("aiid:<n>": reports of one
    incident share it) and its trackerUrl; it is never fetched. Discovery only: facts come from the original report."""

    def on_summary(summary):
        extra = {}
        match = _AIID_CITE.search(summary)
        if match:
            extra = {"trackerUrl": match.group(1), "incidentRef": f"aiid:{int(match.group(2))}"}
        else:
            match = _AIID_REPORT_NO.search(summary)
        if match:
            cut = match.group(0)
            summary = summary[: match.start()].rstrip()
            if re.match(r"\s*(?:\.\.\.|…)", cut):
                summary += "…"  # the database cut the report's text: keep the sign that it is cut
        return summary, extra

    items, warnings = parse_feed(body, source, ctx, on_summary=on_summary)
    for item in items:
        item["listedReport"] = True  # the title and excerpt are the original outlet's, listed by the database
    return items, warnings


# ------------------------------------------------------------------ rekt.news

_REKT_SUFFIX = re.compile(r"\s*-\s*rekt\s*$", re.IGNORECASE)


def parse_rekt(body, source, ctx):
    text = body.decode("utf-8", errors="replace") if isinstance(body, bytes) else body
    root = parse_html(text)
    articles = root.find_all("article")
    if not articles:
        raise ParseError("no <article> elements (page layout changed?)")
    base = source.get("siteUrl") or source["url"]
    items, warnings, skipped = [], [], 0
    for article in articles[:MAX_ITEMS]:
        heading = article.find(pred=lambda n: n.tag in ("h1", "h2", "h3", "h4", "h5", "h6") and n.class_contains("title"))
        heading = heading or article.find(pred=lambda n: n.tag in ("h1", "h2", "h3", "h4", "h5", "h6"))
        anchor = heading.find("a") if heading is not None else None
        if anchor is None or not anchor.get("href"):
            skipped += 1
            continue
        title = clean_ws(anchor.text())
        url = clean_url(anchor.get("href"), base)
        time_el = article.find("time")
        published = None
        if time_el is not None:
            published = parse_iso(time_el.get("datetime") or "") or _parse_long_date(time_el.text())
        excerpt_el = article.find(pred=lambda n: n.tag in ("section", "div") and n.class_contains("excerpt"))
        excerpt = ""
        if excerpt_el is not None:
            paragraphs = [p for p in excerpt_el.find_all("p") if not p.class_contains("more")]
            excerpt = paragraphs[0].text() if paragraphs else excerpt_el.text()
        tags = []
        for a in article.find_all("a"):
            href = a.get("href") or ""
            if "?tag=" in href:
                label = clean_ws(a.text())
                if label and label not in tags:
                    tags.append(label)
        if not title or not url:
            skipped += 1
            continue
        subject = _REKT_SUFFIX.sub("", title) if _REKT_SUFFIX.search(title) else None
        items.append(_qualify({
            "kind": "postmortem",
            "key": f"{source['id']}:{url}",
            "title": title,
            "url": url,
            "publishedUtc": iso_z(published),
            "eventDate": None,
            "excerpt": truncate(excerpt, EXCERPT_MAX),
            "lead": first_sentence(excerpt) if excerpt else "",
            "categories": tags[:8],
            "subject": clean_ws(subject) if subject else None,
        }, excerpt))
    if not items:
        raise ParseError("articles found but none had a title link")
    if skipped:
        warnings.append(f"{skipped} article(s) without a title link skipped")
    return items, warnings


def _parse_long_date(text):
    text = clean_ws(text)
    for fmt in ("%A, %B %d, %Y", "%B %d, %Y", "%b %d, %Y", "%d %B %Y", "%Y-%m-%d"):
        try:
            return dt.datetime.strptime(text, fmt).replace(tzinfo=dt.timezone.utc)
        except ValueError:
            continue
    return None


# ------------------------------------------------------------------ SlowMist Hacked

def parse_slowmist(body, source, ctx):
    text = body.decode("utf-8", errors="replace") if isinstance(body, bytes) else body
    root = parse_html(text)
    container = root.find("div", pred=lambda n: n.has_class("case-content"))
    if container is None:
        raise ParseError("no div.case-content (page layout changed?)")
    cases = container.find_all("li")
    if not cases:
        raise ParseError("case list is empty")
    base = source.get("siteUrl") or source["url"]
    items, warnings, skipped = [], [], 0
    for case in cases[:MAX_ITEMS]:
        fields = {}
        for em in case.find_all("em"):
            label = clean_ws(em.text()).rstrip(":").strip().lower()
            parent = em.parent
            if parent is None or not label:
                continue
            value = parent.text()
            em_text = em.text()
            if value.startswith(em_text):
                value = value[len(em_text):]
            fields[label] = clean_ws(value)
        time_el = case.find("span", pred=lambda n: n.has_class("time"))
        day = parse_iso(time_el.text()) if time_el is not None else None
        target = fields.get("hacked target")
        if not target or day is None:
            skipped += 1
            continue
        description = fields.get("description of the event", "")
        amount = None
        loss_text = fields.get("amount of loss", "")
        money = MONEY_RE.search(loss_text)
        if money:
            amount = money_value(money)
        method = fields.get("attack method") or None
        ref = case.find("a", pred=lambda n: (n.parent is not None and n.parent.class_contains("reference")))
        reference = clean_url(ref.get("href"), base) if ref is not None else None
        head = [target, day.date().isoformat()]
        head.append(f"reported loss {format_usd_exact(amount)}" if amount else "loss not stated")
        if method:
            head.append(f"attack method: {method}")
        excerpt = truncate(" · ".join(head) + (" · " + description if description else ""), EXCERPT_MAX)
        items.append({
            **_qualify({}, description),
            "kind": "structured",
            "key": f"slowmist:{target}@{day.date().isoformat()}",
            "title": f"SlowMist Hacked: {target} ({day.date().isoformat()})",
            "url": source["url"] + "#" + urllib.parse.quote(f"{target}@{day.date().isoformat()}"),
            "publishedUtc": None,
            "eventDate": day.date().isoformat(),
            "excerpt": excerpt,
            "lead": first_sentence(description) if description else "",
            "categories": [method] if method else [],
            "referenceUrl": reference,
            "record": {"name": target, "amount": amount, "method": method},
        })
    if not items:
        raise ParseError("no case had a target and a date")
    if skipped:
        warnings.append(f"{skipped} case(s) without target/date skipped")
    return items, warnings


# ------------------------------------------------------------------ blog index cards (CertiK, TRM Labs)

def parse_blog_cards(body, source, ctx):
    text = body.decode("utf-8", errors="replace") if isinstance(body, bytes) else body
    root = parse_html(text)
    prefix = source.get("cardPathPrefix") or "/blog/"
    base = source.get("siteUrl") or source["url"]
    host = urllib.parse.urlsplit(base).netloc
    items, seen = [], set()
    for anchor in root.find_all("a"):
        href = anchor.get("href") or ""
        parts = urllib.parse.urlsplit(urllib.parse.urljoin(base, href))
        if parts.netloc != host or not parts.path.startswith(prefix) or parts.path.rstrip("/") == prefix.rstrip("/"):
            continue
        time_el = anchor.find("time")
        if time_el is None:
            continue  # category or navigation link, not a dated card
        url = clean_url(parts.geturl())
        if url in seen:
            continue
        heading = anchor.find(pred=lambda n: n.tag in ("h1", "h2", "h3", "h4") or n.class_contains("heading"))
        if heading is None:
            continue
        title = heading.text()
        published = parse_iso(time_el.get("datetime") or "") or _parse_long_date(time_el.text())
        desc_el = anchor.find(pred=lambda n: n is not heading and n.class_contains("line-clamp"))
        description = desc_el.text() if desc_el is not None else ""
        category = ""
        if time_el.parent is not None:
            category = time_el.parent.text().replace(time_el.text(), "")
            category = clean_ws(category.replace("·", " ")).strip(" -|")
        if not title:
            continue
        seen.add(url)
        items.append(_qualify({
            "kind": "blog",
            "key": f"{source['id']}:{url}",
            "title": truncate(title, 300),
            "url": url,
            "publishedUtc": iso_z(published),
            "eventDate": None,
            "excerpt": truncate(description, EXCERPT_MAX),
            "lead": first_sentence(description) if description else "",
            "categories": [category] if category else [],
        }, description))
        if len(items) >= MAX_ITEMS:
            break
    if not items:
        raise ParseError(f"no dated cards linking under {prefix} (page layout changed?)")
    return items, []


PARSERS = {
    "defillama_hacks": parse_defillama_hacks,
    "rss": parse_feed,
    "atom": parse_feed,
    "aiid_rss": parse_aiid_feed,
    "rekt_news": parse_rekt,
    "slowmist_hacked": parse_slowmist,
    "blog_cards": parse_blog_cards,
}
