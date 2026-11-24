"""Text helpers: HTML to plain text, whitespace, excerpts, dates and money.

Nothing here evaluates or executes feed content: HTML is reduced to text with
html.parser, entities are decoded with html.unescape, and the results are plain
strings.
"""

import datetime as dt
import email.utils
import html
import math
import re
import unicodedata
from html.parser import HTMLParser

EXCERPT_MAX = 280
ELLIPSIS = "…"

_ZERO_WIDTH = dict.fromkeys(map(ord, "​‌‍⁠﻿­"), None)
_WS = re.compile(r"\s+")


def clean_ws(text):
    """NFC-normalise, drop zero-width characters and collapse whitespace."""
    if not text:
        return ""
    text = unicodedata.normalize("NFC", str(text)).translate(_ZERO_WIDTH)
    text = text.replace(" ", " ")
    return _WS.sub(" ", text).strip()


class _TextExtractor(HTMLParser):
    SKIP = {"script", "style", "noscript", "template", "svg", "iframe", "object", "head"}
    BLOCK = {
        "p", "div", "br", "li", "ul", "ol", "h1", "h2", "h3", "h4", "h5", "h6", "tr", "td",
        "th", "section", "article", "header", "footer", "blockquote", "figure", "figcaption",
        "table", "hr", "dd", "dt",
    }

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts = []
        self.skip = 0

    def handle_starttag(self, tag, attrs):
        if tag in self.SKIP:
            self.skip += 1
        elif tag in self.BLOCK:
            self.parts.append(" ")

    def handle_startendtag(self, tag, attrs):
        if tag in self.BLOCK:
            self.parts.append(" ")

    def handle_endtag(self, tag):
        if tag in self.SKIP:
            if self.skip:
                self.skip -= 1
        elif tag in self.BLOCK:
            self.parts.append(" ")

    def handle_data(self, data):
        if not self.skip:
            self.parts.append(data)


def html_to_text(fragment):
    """Plain text from an HTML fragment (or from already-plain text)."""
    if not fragment:
        return ""
    fragment = str(fragment)
    if "<" not in fragment:
        return clean_ws(html.unescape(fragment))
    parser = _TextExtractor()
    try:
        parser.feed(fragment)
        parser.close()
    except Exception:  # html.parser is lenient; this is a last-resort guard
        return clean_ws(re.sub(r"<[^>]*>", " ", fragment))
    return clean_ws("".join(parser.parts))


def truncate(text, limit=EXCERPT_MAX):
    """Cut at a word boundary so the result (ellipsis included) is <= limit chars."""
    text = clean_ws(text)
    if len(text) <= limit:
        return text
    cut = text[: limit - 1]
    space = cut.rfind(" ")
    if space >= limit - 60:
        cut = cut[:space]
    return cut.rstrip(" ,;:-–—") + ELLIPSIS


# ---------------------------------------------------------------- dates

def to_utc(value):
    if value.tzinfo is None:
        return value.replace(tzinfo=dt.timezone.utc)
    return value.astimezone(dt.timezone.utc)


def parse_rfc822(text):
    """RSS pubDate -> aware UTC datetime, or None."""
    if not text:
        return None
    try:
        parsed = email.utils.parsedate_to_datetime(text.strip())
    except (TypeError, ValueError, IndexError):
        return None
    if parsed is None:
        return None
    return to_utc(parsed)


def parse_iso(text):
    """ISO 8601 (Atom, <time datetime>) -> aware UTC datetime, or None."""
    if not text:
        return None
    text = text.strip()
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", text):
        text += "T00:00:00+00:00"
    # Python < 3.11 compatibility is not needed (3.13 here) but keep "Z" explicit.
    text = re.sub(r"Z$", "+00:00", text)
    # "2026-11-20T08:55-05:00" (no seconds) is valid for fromisoformat on 3.11+.
    try:
        return to_utc(dt.datetime.fromisoformat(text))
    except ValueError:
        return None


def parse_any_date(text):
    return parse_iso(text) or parse_rfc822(text)


def iso_z(value):
    """Aware datetime -> '2026-11-24T05:24:47Z' (None passes through)."""
    if value is None:
        return None
    return to_utc(value).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def day_start(day):
    return dt.datetime(day.year, day.month, day.day, tzinfo=dt.timezone.utc)


MONTHS = {
    "january": 1, "jan": 1, "february": 2, "feb": 2, "march": 3, "mar": 3, "april": 4,
    "apr": 4, "may": 5, "june": 6, "jun": 6, "july": 7, "jul": 7, "august": 8, "aug": 8,
    "september": 9, "sept": 9, "sep": 9, "october": 10, "oct": 10, "november": 11, "nov": 11,
    "december": 12, "dec": 12,
}
_DATE_IN_TEXT = re.compile(
    r"\b(January|February|March|April|May|June|July|August|September|October|November|December|"
    r"Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sept|Sep|Oct|Nov|Dec)\.?\s+(\d{1,2})(?:st|nd|rd|th)?"
    r"(?:\s*[–—-]\s*\d{1,2})?(?:,?\s+(\d{4}))?\b"
)


def dates_in_text(text, ref_date, max_back_days=400, with_spans=False):
    """Calendar dates mentioned in text, years inferred so they are <= ref_date.

    Returns a list of datetime.date. A date without a year takes the latest year
    that keeps it on or before ref_date, and only if that lands within 200 days
    (otherwise it is more likely an upcoming date, such as "a Dec. 1 hearing").
    Dates after ref_date or more than max_back_days before it are dropped (they
    are previews or history, not the event). "May" alone is ambiguous, so the
    regex requires a day number.
    """
    found = []
    for match in _DATE_IN_TEXT.finditer(text or ""):
        month = MONTHS[match.group(1).lower().rstrip(".")]
        day = int(match.group(2))
        year = int(match.group(3)) if match.group(3) else None
        candidates = [year] if year else [ref_date.year, ref_date.year - 1]
        limit = max_back_days if year else min(max_back_days, 200)
        for y in candidates:
            try:
                value = dt.date(y, month, day)
            except ValueError:
                continue
            if value <= ref_date:
                if (ref_date - value).days <= limit:
                    found.append((value, match.start(), match.end()) if with_spans else value)
                break
    return found


# ---------------------------------------------------------------- money

_MULT = {
    "trillion": 1e12, "tn": 1e12, "billion": 1e9, "bn": 1e9, "b": 1e9, "million": 1e6,
    "mn": 1e6, "mln": 1e6, "m": 1e6, "thousand": 1e3, "k": 1e3,
}
MONEY_RE = re.compile(
    r"(?:US\$|USD\s?\$?|\$)\s?(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)"
    r"(?:\s?(trillion|billion|million|thousand|bn|tn|mln|mn|b|m|k)\b)?",
    re.IGNORECASE,
)


def money_value(match):
    number = float(match.group(1).replace(",", ""))
    unit = (match.group(2) or "").lower()
    return number * _MULT.get(unit, 1.0)


def format_usd(amount):
    """Compact, exact-enough display: $11.96M, $968K, $6.36B, $26.9K, $750."""
    if amount is None:
        return "n/a"
    amount = float(amount)
    for div, suffix in ((1e9, "B"), (1e6, "M"), (1e3, "K")):
        if amount >= div:
            value = amount / div
            text = f"{value:.2f}".rstrip("0").rstrip(".") if value < 100 else f"{value:.1f}".rstrip("0").rstrip(".")
            return f"${text}{suffix}"
    return f"${amount:,.0f}"


def format_usd_exact(amount):
    """Thousands separators, no rounding beyond cents: $11,960,000."""
    if amount is None:
        return "n/a"
    if float(amount).is_integer():
        return f"${int(amount):,}"
    return f"${amount:,.2f}"


def log_scale(amount, low=1e4, high=1e9):
    """0 at `low` USD, 1 at `high` USD, log10 in between (clamped)."""
    if not amount or amount <= 0:
        return 0.0
    value = (math.log10(amount) - math.log10(low)) / (math.log10(high) - math.log10(low))
    return max(0.0, min(1.0, value))


# ---------------------------------------------------------------- names

_GENERIC_SUFFIX = {
    "cex", "dex", "amm", "perps", "perp", "lend", "lending", "finance", "protocol", "network",
    "labs", "dao", "exchange", "markets", "market", "bridge", "swap", "international", "wallet",
    "wallets", "token", "vault", "vaults", "pool", "pools", "app", "platform", "foundation", "v1",
    "v2", "v3", "v4", "chain", "official", "io", "xyz", "fi",
}


def norm_name(name):
    """Lower-case ASCII-folded name with punctuation flattened to single spaces."""
    text = unicodedata.normalize("NFKD", name or "")
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    text = text.lower().replace("’", "'").replace("'s ", " ")
    text = re.sub(r"[^a-z0-9.]+", " ", text)
    text = re.sub(r"(?<![a-z0-9])\.|\.(?![a-z0-9])", " ", text)
    return _WS.sub(" ", text).strip()


def core_name(name):
    """Name without parentheticals and generic trailing words: 'Chainflip AMM' -> 'chainflip'."""
    base = re.sub(r"\([^)]*\)", " ", name or "")
    tokens = norm_name(base).split()
    while len(tokens) > 1 and tokens[-1] in _GENERIC_SUFFIX:
        tokens.pop()
    while len(tokens) > 1 and tokens[0] in {"the"}:
        tokens.pop(0)
    return " ".join(tokens)


def slugify(name, limit=48):
    text = norm_name(name).replace(".", "-")
    text = re.sub(r"[^a-z0-9]+", "-", text).strip("-")
    return (text[:limit].rstrip("-")) or "unknown"
