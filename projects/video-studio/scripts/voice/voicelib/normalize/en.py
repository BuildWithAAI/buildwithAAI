"""English (US) number words. No hyphens in the spoken output ("twenty six"): espeak treats a hyphen
as a word break anyway, and plain spaces keep one spoken word per phoneme word for alignment.
US style: no "and" inside numbers ("four hundred two"), years in pairs ("twenty twenty six").
"""

import re

from ..lexicon import PRONUNCIATIONS
from .common import SpacedNormalizer

ONES = [
    "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
    "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen",
]
TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"]
SCALES = [(10**15, "quadrillion"), (10**12, "trillion"), (10**9, "billion"), (10**6, "million"), (1000, "thousand")]
ORD_IRREGULAR = {
    "one": "first", "two": "second", "three": "third", "five": "fifth", "eight": "eighth",
    "nine": "ninth", "twelve": "twelfth",
}
MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]


def under_1000(n: int) -> str:
    h, r = divmod(n, 100)
    parts = []
    if h:
        parts.append(f"{ONES[h]} hundred")
    if r:
        if r < 20:
            parts.append(ONES[r])
        else:
            t, u = divmod(r, 10)
            parts.append(TENS[t] + (f" {ONES[u]}" if u else ""))
    return " ".join(parts)


def cardinal(n: int) -> str:
    if n < 0:
        return f"minus {cardinal(-n)}"
    if n == 0:
        return "zero"
    parts = []
    for value, name in SCALES:
        q, n = divmod(n, value)
        if q:
            parts.append(f"{cardinal(q)} {name}")
    if n:
        parts.append(under_1000(n))
    return " ".join(parts)


def ordinal(n: int) -> str:
    words = cardinal(n).split()
    last = words[-1]
    if last in ORD_IRREGULAR:
        words[-1] = ORD_IRREGULAR[last]
    elif last.endswith("y"):
        words[-1] = last[:-1] + "ieth"
    else:
        words[-1] = last + "th"
    return " ".join(words)


def year(n: int) -> str:
    if 2000 <= n <= 2009:
        return cardinal(n)
    hi, lo = divmod(n, 100)
    if lo == 0:
        return f"{cardinal(hi)} hundred"
    if lo < 10:
        return f"{cardinal(hi)} oh {ONES[lo]}"
    return f"{cardinal(hi)} {cardinal(lo)}"


class English(SpacedNormalizer):
    lang = "en"
    decimal_sep = "."
    currencies = {
        "$": ("dollar", "dollars", "cent", "cents"),
        "€": ("euro", "euros", "cent", "cents"),
        "£": ("pound", "pounds", "penny", "pence"),
        "¥": ("yen", "yen", None, None),
        "₹": ("rupee", "rupees", None, None),
        "US$": ("U S dollar", "U S dollars", "cent", "cents"),
        "R$": ("Brazilian real", "Brazilian reals", "centavo", "centavos"),
        "A$": ("Australian dollar", "Australian dollars", "cent", "cents"),
        "C$": ("Canadian dollar", "Canadian dollars", "cent", "cents"),
        "MX$": ("Mexican peso", "Mexican pesos", "centavo", "centavos"),
    }
    scales = {"k": ("thousand", "thousand"), "m": ("million", "million"), "b": ("billion", "billion"), "t": ("trillion", "trillion")}
    scale_words = frozenset({"thousand", "million", "billion", "trillion"})
    tickers = {"BTC": "bitcoin", "ETH": "ether", "SOL": "sol", "USDC": "U S D C", "USDT": "U S D T"}
    symbols = {"&": "and", "+": "plus", "=": "equals", "@": "at", "%": "percent", "#": "number", "~": "about", "×": "times"}
    months = MONTHS
    month_lookup = {**{m.lower(): i + 1 for i, m in enumerate(MONTHS)}, **{m[:3].lower(): i + 1 for i, m in enumerate(MONTHS)}, "sept": 9}
    lexicon = PRONUNCIATIONS["en"]
    number_word = "number"

    def cardinal(self, n: int) -> str:
        return cardinal(n)

    def ordinal(self, n: int) -> str:
        return ordinal(n)

    def year(self, n: int) -> str:
        return year(n)

    def is_year(self, n: int) -> bool:
        return 1100 <= n <= 2099

    def date(self, y: int | None, m: int, d: int) -> str:
        head = f"{MONTHS[m - 1]} {ordinal(d)}"
        return f"{head}, {year(y)}" if y else head

    def slash_date_order(self, a: int, b: int) -> tuple[int, int]:
        return a, b  # US: month/day/year

    def time(self, h: int, mi: int) -> str:
        if mi == 0:
            return f"{cardinal(h)} o'clock"
        if mi < 10:
            return f"{cardinal(h)} oh {ONES[mi]}"
        return f"{cardinal(h)} {cardinal(mi)}"

    def fraction_words(self, n: int, d: int) -> str | None:
        if d == 2:
            return "one half" if n == 1 else None
        if d == 4:
            return f"{cardinal(n)} quarter{'s' if n > 1 else ''}"
        return f"{cardinal(n)} {ordinal(d)}{'s' if n > 1 else ''}"

    def ordinal_token(self, core: str) -> str | None:
        m = re.fullmatch(r"(\d+)(st|nd|rd|th)", core, re.I)
        return ordinal(int(m.group(1))) if m else None

    def decade(self, core: str) -> str | None:
        m = re.fullmatch(r"(\d{2,3})0s", core)
        if m and len(core) == 5:  # 1990s
            words = year(int(core[:4])).split()
            words[-1] = ordinal_plural(words[-1])
            return " ".join(words)
        m = re.fullmatch(r"'?([2-9])0s", core)
        if m:
            return ordinal_plural(TENS[int(m.group(1))])
        return None

    def multi_date(self, tokens: list[str], i: int) -> tuple[int, list[str]] | None:
        from .common import split_punct

        def month_of(tok: str) -> tuple[int, str] | None:
            pre, core, post = split_punct(tok)
            key = core.lower().rstrip(".")
            if not pre and key in self.month_lookup and core[:1].isupper():
                if key != MONTHS[self.month_lookup[key] - 1].lower() and post.startswith("."):
                    post = post[1:]  # "Nov." is an abbreviation, not a full stop
                return self.month_lookup[key], post
            return None

        def day_of(tok: str) -> tuple[int, str] | None:
            pre, core, post = split_punct(tok)
            m = re.fullmatch(r"(\d{1,2})(st|nd|rd|th)?", core, re.I)
            if not pre and m and 1 <= int(m.group(1)) <= 31:
                return int(m.group(1)), post
            return None

        def year_of(tok: str) -> tuple[int, str] | None:
            pre, core, post = split_punct(tok)
            if not pre and re.fullmatch(r"\d{4}", core) and self.is_year(int(core)):
                return int(core), post
            return None

        if i + 1 >= len(tokens):
            return None
        mo, d = month_of(tokens[i]), day_of(tokens[i + 1])
        if mo and d:  # November 24, 2026
            out = [MONTHS[mo[0] - 1] + mo[1], ordinal(d[0]) + d[1]]
            y = year_of(tokens[i + 2]) if i + 2 < len(tokens) and d[1] in ("", ",") else None
            if y:
                out.append(year(y[0]) + y[1])
            return len(out), out
        d, mo = day_of(tokens[i]), month_of(tokens[i + 1])
        if d and mo and d[1] == "":  # 24 November 2026
            out = [ordinal(d[0]), MONTHS[mo[0] - 1] + mo[1]]
            y = year_of(tokens[i + 2]) if i + 2 < len(tokens) and mo[1] in ("", ",") else None
            if y:
                out.append(year(y[0]) + y[1])
            return len(out), out
        return None


def ordinal_plural(word: str) -> str:
    """'ninety' -> 'nineties', 'hundred' -> 'hundreds' (decades)."""
    if word.endswith("y"):
        return word[:-1] + "ies"
    return word + "s"
