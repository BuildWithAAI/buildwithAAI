"""Shared number parsing and the token engine for space-separated languages (en, es, pt-br, it, hi).

Each language subclasses SpacedNormalizer and supplies its number words. The engine turns ONE display
token into ONE spoken string (so captions keep the written form and word timing maps back exactly),
except for a few multi-token patterns (dates, "68,67 %", "40.000 €", "$1.5 million") that still emit
one spoken string per display token.

Written-number conventions (parse_num):
  * en, hi, zh: '.' is the decimal separator, ',' groups thousands (Indian "1,00,000" too).
  * es, it, pt-br: ',' is the decimal separator, '.' groups thousands. Two lenient readings, because
    crypto copy is often written English-style: "68.67" (a '.' followed by other than three digits)
    is a decimal, and "40,000" (a ',' followed by three digits ending in 0, after a non-zero integer
    of at most three digits) is forty thousand. "1,234" stays 1.234 there. Use {display|spoken}
    markup whenever a number could be read two ways.
"""

import re
import unicodedata

NUM = r"\d+(?:[.,]\d+)*"
SIGN = r"[+\-−±]"  # + - − ±
# Currency prefixes, multi-character ones first (US$40,000, R$ 40 mil, A$5, C$10, MX$200). Every language's
# `currencies` table carries all of them (2026-11-24, VCD fix: "R$ 40 mil" was read "real dólar quarenta mil").
CUR = r"(?:US\$|R\$|A\$|C\$|MX\$|[$€£¥₹])"
SCALE_CUR = r"(?:bn|BN|[kKmMbBtT])"  # after a currency amount 'm' means million ($5m)
SCALE_BARE = r"(?:bn|[kKMBT])"  # a bare "5m" stays (minutes? metres?)

_PRE = "([\"'“‘«(\\[¿¡]*)"
_POST = "([\"'”’»)\\].,;:!?…]*)"
_TOKEN = re.compile(rf"^{_PRE}(.*?){_POST}$", re.S)
_PUNCT_ONLY = re.compile(r"^[\W_]+$", re.U)

DEVANAGARI_DIGITS = str.maketrans("०१२३४५६७८९", "0123456789")
FULLWIDTH_DIGITS = str.maketrans("０１２３４５６７８９", "0123456789")


def parse_num(s: str, decimal_sep: str) -> tuple[str, str | None]:
    """Split a written number into (integer digits, fraction digits or None). Raises ValueError for
    shapes that are not one number (version strings like "1.2.3")."""
    if not re.fullmatch(NUM, s):
        raise ValueError(f"not a number: {s!r}")
    seps = [c for c in s if c in ".,"]
    if not seps:
        return s, None
    if len(set(seps)) == 2:
        last = max(s.rfind("."), s.rfind(","))
        head, frac = s[:last], s[last + 1 :]
        groups = re.split(r"[.,]", head)
        if any(len(g) not in (2, 3) for g in groups[1:]):
            raise ValueError(f"bad digit grouping: {s!r}")
        return "".join(groups), frac
    sep = seps[0]
    parts = s.split(sep)
    if len(parts) > 2:
        if parts[-1] and len(parts[-1]) == 3 and all(len(p) in (2, 3) for p in parts[1:]):
            return "".join(parts), None
        raise ValueError(f"bad digit grouping: {s!r}")
    a, b = parts
    if sep == decimal_sep:
        if decimal_sep == "," and len(b) == 3 and 1 <= len(a) <= 3 and not a.startswith("0") and b.endswith("0"):
            return a + b, None  # "40,000" written English-style in a comma-decimal language
        return a, b
    if len(b) == 3 and 1 <= len(a) <= 3 and not a.startswith("0"):
        return a + b, None
    return a, b  # "68.67" in Spanish text, "0,25" in English text: a decimal


def split_punct(token: str) -> tuple[str, str, str]:
    """'($40,000),' -> ('(', '$40,000', '),')."""
    m = _TOKEN.match(token)
    if not m:
        return "", token, ""
    pre, core, post = m.groups()
    return pre, core, post


def is_punct_only(token: str) -> bool:
    return bool(_PUNCT_ONLY.match(token)) and not any(c.isalnum() for c in token)


def nfc(text: str) -> str:
    return unicodedata.normalize("NFC", text)


class SpacedNormalizer:
    """Token engine. Subclasses fill in the number words; see en.py for the reference set."""

    lang = ""
    decimal_sep = "."
    decimal_word = "point"
    percent_word = "percent"
    plus_word = "plus"
    minus_word = "minus"
    plusminus_word = "plus or minus"
    about_word = "about"
    range_word = "to"
    times_word = "x"  # multiplier suffix: "10x"
    # currency symbol -> (singular, plural, cent singular, cent plural); cents only where they are spoken
    currencies: dict[str, tuple[str, str, str | None, str | None]] = {}
    # scale suffix -> (singular, plural): 'k' thousand, 'm' million, 'b' billion, 't' trillion
    scales: dict[str, tuple[str, str]] = {}
    # written scale WORDS that may follow "$1.5" (multi-token): lowercase -> True
    scale_words: frozenset[str] = frozenset()
    connector_after_scale = ""  # es "de", pt "de", it "di": "dos millones DE dólares"
    big_scale_words: frozenset[str] = frozenset()  # words after which the connector is needed
    tickers: dict[str, str] = {}
    symbols: dict[str, str] = {}
    lexicon: dict[str, str] = {}  # lexicon.PRONUNCIATIONS[lang]: written token (lower case) -> what Kokoro says
    number_word = "number"  # "#1" -> "number one"
    months: list[str] = []  # spoken, January..December
    month_lookup: dict[str, int] = {}  # written forms (lowercase, abbreviations too) -> 1..12

    # ---- number words (override) ----
    def cardinal(self, n: int) -> str:
        raise NotImplementedError

    def cardinal_noun(self, n: int) -> str:
        """The cardinal used directly before a noun (es 'un dólar', 'veintiún'). Default: cardinal."""
        return self.cardinal(n)

    def ordinal(self, n: int) -> str:
        return self.cardinal(n)

    def year(self, n: int) -> str:
        return self.cardinal(n)

    def digits(self, frac: str) -> str:
        return " ".join(self.cardinal(int(c)) for c in frac)

    def fraction(self, frac: str) -> str:
        """How the digits after the decimal separator are read. Default: one by one."""
        return self.digits(frac)

    def decimal(self, i: str, f: str | None) -> str:
        whole = self.cardinal(int(i))
        if f is None or f == "":
            return whole
        return f"{whole} {self.decimal_word} {self.fraction(f)}"

    def number(self, s: str) -> str:
        i, f = parse_num(s, self.decimal_sep)
        return self.decimal(i, f)

    def signed(self, sign: str | None, words: str) -> str:
        if not sign:
            return words
        if sign == "+":
            return f"{self.plus_word} {words}"
        if sign in "-−":
            return f"{self.minus_word} {words}"
        if sign == "±":
            return f"{self.plusminus_word} {words}"
        return words

    def percent(self, sign: str | None, num: str) -> str:
        return self.signed(sign, f"{self.number(num)} {self.percent_word}")

    def is_singular(self, value: float) -> bool:
        """Whether a count takes the singular noun (pt-br: below 2, "1,5 milhão")."""
        return value == 1

    def scale_name(self, key: str, value: float) -> str:
        key = key.lower()
        if key == "bn":
            key = "b"
        singular, plural = self.scales[key]
        return singular if self.is_singular(value) else plural

    def scaled(self, num: str, scale: str) -> str:
        i, f = parse_num(num, self.decimal_sep)
        value = float(f"{i}.{f or 0}")
        head = self.decimal(i, f) if f else self.cardinal_noun(int(i))
        return f"{head} {self.scale_name(scale, value)}"

    def needs_connector(self, words: str) -> bool:
        return bool(self.connector_after_scale) and words.split()[-1] in self.big_scale_words

    def money(self, sym: str, num: str, scale: str | None = None) -> str:
        singular, plural, cent1, centn = self.currencies[sym]
        i, f = parse_num(num, self.decimal_sep)
        if scale:
            return self._join_money(self.scaled(num, scale), plural)  # "one million dollars"
        if f is not None and set(f) == {"0"}:
            f = None
        if f is not None and len(f) == 2 and cent1:
            cents = int(f)
            if int(i) == 0:
                return f"{self.cardinal_noun(cents)} {cent1 if cents == 1 else centn}"
            whole = f"{self.cardinal_noun(int(i))} {singular if int(i) == 1 else plural}"
            return f"{whole} {self.cents_joiner()} {self.cardinal_noun(cents)} {cent1 if cents == 1 else centn}"
        if f is None:
            n = int(i)
            amount = self.cardinal_noun(n)
            return self._join_money(amount, singular if n == 1 else plural)
        return self._join_money(self.decimal(i, f), plural)

    def cents_joiner(self) -> str:
        return "and"

    def _join_money(self, amount: str, noun: str) -> str:
        if self.needs_connector(amount):
            return f"{amount} {self.connector_after_scale} {noun}"
        return f"{amount} {noun}"

    def date(self, y: int | None, m: int, d: int) -> str:
        raise NotImplementedError

    def time(self, h: int, mi: int) -> str:
        return f"{self.cardinal(h)} {self.cardinal(mi)}" if mi else self.cardinal(h)

    def multiplier(self, num: str) -> str:
        return f"{self.number(num)} {self.times_word}"

    def percent_range(self, a: str, b: str) -> str:
        """"5-10%" -> "five to ten percent" (never "five minus ten")."""
        return f"{self.number(a)} {self.range_word} {self.number(b)} {self.percent_word}"

    def hours(self, h: int, mi: int | None) -> str | None:
        """"10h30" / "10h" (es, pt-br, it). None: not read as a time in this language."""
        return None

    def fraction_words(self, n: int, d: int) -> str | None:
        """"1/3" -> "one third" (1 <= n < d <= 10). None: read the two numbers."""
        return None

    def range(self, a: str, b: str) -> str:
        def side(x: str) -> str:
            if re.fullmatch(r"\d{4}", x) and self.is_year(int(x)):
                return self.year(int(x))
            return self.number(x)
        return f"{side(a)} {self.range_word} {side(b)}"

    def ordinal_token(self, core: str) -> str | None:
        return None

    def decade(self, core: str) -> str | None:
        return None

    def preprocess(self, token: str) -> str:
        return token

    # ---- engine ----
    def normalize_tokens(self, tokens: list[str]) -> list[str]:
        out: list[str] = []
        i = 0
        while i < len(tokens):
            hit = self.multi(tokens, i)
            if hit:
                k, spoken = hit
                assert len(spoken) == k, (tokens[i : i + k], spoken)
                out.extend(spoken)
                i += k
                continue
            out.append(self.token(tokens[i]))
            i += 1
        return out

    def normalize_text(self, text: str) -> str:
        """Convenience: normalize a whole string (whitespace-separated)."""
        return " ".join(self.normalize_tokens(text.split()))

    def multi(self, tokens: list[str], i: int) -> tuple[int, list[str]] | None:
        """Multi-token patterns. Returns (tokens consumed, one spoken string per token)."""
        hit = self.multi_date(tokens, i)
        if hit:
            return hit
        if i + 1 < len(tokens):
            pre, core, post = split_punct(tokens[i])
            npre, ncore, npost = split_punct(tokens[i + 1])
            # "R$ 40 mil", "€ 200", "US$ 1,5 milhão": a currency sign on its own, then the amount
            if core in self.currencies and not post and not npre:
                m = re.fullmatch(rf"({SIGN})?({NUM})({SCALE_CUR})?", ncore)
                if m:
                    sign, num, scale = m.group(1), m.group(2), m.group(3)
                    try:
                        if not scale and not npost and i + 2 < len(tokens):
                            p3, c3, post3 = split_punct(tokens[i + 2])
                            if not p3 and c3.lower() in self.scale_words:
                                plural = self.currencies[core][1]
                                big = self.connector_after_scale and c3.lower() in self.big_scale_words
                                noun = f"{c3} {self.connector_after_scale} {plural}" if big else f"{c3} {plural}"
                                return 3, [pre, self.signed(sign, self.number(num)), noun + post3]
                        return 2, [pre, self.signed(sign, self.money(core, num, scale)) + npost]
                    except ValueError:
                        return None
            # "5-10 %"
            if ncore == "%" and not npre:
                m = re.fullmatch(rf"({NUM})%?\s?[-–]\s?({NUM})", core)
                if m:
                    try:
                        words = self.percent_range(m.group(1), m.group(2))
                    except ValueError:
                        return None
                    head, _, tail = words.rpartition(f" {self.percent_word}")
                    return 2, [pre + head, f"{self.percent_word}{npost}"]
            # "68,67 %"
            if ncore == "%" and not npre and re.fullmatch(rf"({SIGN})?({NUM})", core):
                m = re.fullmatch(rf"({SIGN})?({NUM})", core)
                try:
                    words = self.number(m.group(2))
                except ValueError:
                    return None
                return 2, [pre + self.signed(m.group(1), words), f"{self.percent_word}{npost}"]
            # "40.000 €"
            if ncore in self.currencies and not npre and re.fullmatch(NUM, core):
                try:
                    spoken = self.money(ncore, core)
                except ValueError:
                    return None
                amount, noun = self._split_money(spoken)
                return 2, [pre + amount, noun + npost]
            # "$1.5 million"
            m = re.fullmatch(rf"({SIGN})?({CUR})({NUM})", core)
            if m and ncore.lower() in self.scale_words and not npre:
                try:
                    amount = self.number(m.group(3))
                except ValueError:
                    return None
                singular, plural, _, _ = self.currencies[m.group(2)]
                noun = f"{ncore} {self.connector_after_scale} {plural}" if self.connector_after_scale and ncore.lower() in self.big_scale_words else f"{ncore} {plural}"
                return 2, [pre + self.signed(m.group(1), amount), noun + npost]
        return None

    def _split_money(self, spoken: str) -> tuple[str, str]:
        """'forty thousand dollars' -> ('forty thousand', 'dollars') for two-token display."""
        words = spoken.split()
        if self.connector_after_scale and len(words) >= 3 and words[-2] == self.connector_after_scale:
            return " ".join(words[:-2]), " ".join(words[-2:])
        return " ".join(words[:-1]), words[-1]

    def multi_date(self, tokens: list[str], i: int) -> tuple[int, list[str]] | None:
        return None

    def token(self, token: str) -> str:
        token = self.preprocess(token)
        if is_punct_only(token):
            return self.punct(token)
        pre, core, post = split_punct(token)
        if not core:
            return token
        said = self.lexicon.get(core.lower())
        if said is not None:
            from ..lexicon import match_case

            return f"{pre}{match_case(core, said)}{post}"
        try:
            spoken = self.core(core)
        except ValueError:
            spoken = None
        if spoken is None:
            return token
        return f"{pre}{spoken}{post}"

    def punct(self, token: str) -> str:
        if token in self.symbols:
            return self.symbols[token]
        if token in ("-", "–", "--"):
            return "—"  # a spaced dash is a pause, as an em dash is
        return token

    def core(self, core: str) -> str | None:
        """Spoken form of a token without its surrounding punctuation, or None to keep it."""
        if core in self.tickers:
            return self.tickers[core]
        if core in self.symbols:
            return self.symbols[core]
        m = re.fullmatch(r"(?:#|[nN]\.?[º°])(\d+)", core)  # "#1", "nº 1" -> "number one" (not "hash one")
        if m:
            return f"{self.number_word} {self.cardinal(int(m.group(1)))}"
        m = re.fullmatch(r"(\d{1,2})[hH](\d{2})?", core)  # "10h30" (es, pt-br, it)
        if m and int(m.group(1)) <= 24 and (m.group(2) is None or int(m.group(2)) < 60):
            said = self.hours(int(m.group(1)), int(m.group(2)) if m.group(2) else None)
            if said is not None:
                return said
        m = re.fullmatch(r"\$([A-Z]{2,6})", core)  # cashtag
        if m:
            return self.tickers.get(m.group(1), " ".join(m.group(1)))
        m = re.fullmatch(r"[~≈]\s*(.+)", core)
        if m:
            inner = self.core(m.group(1))
            return f"{self.about_word} {inner if inner is not None else m.group(1)}"
        if not any(c.isdigit() for c in core):
            return None
        m = re.fullmatch(r"(\d{4})-(\d{2})-(\d{2})", core)
        if m:
            y, mo, d = (int(x) for x in m.groups())
            if 1 <= mo <= 12 and 1 <= d <= 31:
                return self.date(y, mo, d)
        m = re.fullmatch(r"(\d{1,2})/(\d{1,2})/(\d{4})", core)
        if m:
            a, b, y = (int(x) for x in m.groups())
            mo, d = self.slash_date_order(a, b)
            if 1 <= mo <= 12 and 1 <= d <= 31:
                return self.date(y, mo, d)
        m = re.fullmatch(r"(\d{1,2}):(\d{2})", core)
        if m and int(m.group(1)) <= 24 and int(m.group(2)) < 60:
            return self.time(int(m.group(1)), int(m.group(2)))
        m = re.fullmatch(rf"({SIGN})?({CUR})({NUM})({SCALE_CUR})?", core) or re.fullmatch(
            rf"({SIGN})?()({NUM})({SCALE_CUR})?({CUR})", core
        )
        if m:
            sign, sym, num, scale = m.group(1), m.group(2), m.group(3), m.group(4)
            if not sym:
                sym = m.group(5)
            return self.signed(sign, self.money(sym, num, scale))
        m = re.fullmatch(rf"({NUM})%?\s?[-–]\s?({NUM})\s?%", core)  # "5-10%", "5%-10%": a range, never "minus"
        if m:
            return self.percent_range(m.group(1), m.group(2))
        m = re.fullmatch(rf"({SIGN})?({NUM})\s?%", core)
        if m:
            return self.percent(m.group(1), m.group(2))
        m = re.fullmatch(rf"({NUM})[xX×]", core)
        if m:
            return self.multiplier(m.group(1))
        m = re.fullmatch(rf"({SIGN})?({NUM})({SCALE_BARE})", core)
        if m:
            return self.signed(m.group(1), self.scaled(m.group(2), m.group(3)))
        hit = self.ordinal_token(core)
        if hit is not None:
            return hit
        hit = self.decade(core)
        if hit is not None:
            return hit
        m = re.fullmatch(rf"({NUM})[-–]({NUM})", core)
        if m:
            return self.range(m.group(1), m.group(2))
        m = re.fullmatch(r"(\d+)/(\d+)", core)
        if m:
            n, d = int(m.group(1)), int(m.group(2))
            said = self.fraction_words(n, d) if 1 <= n < d <= 10 else None
            return said if said is not None else f"{self.cardinal(n)} {self.cardinal(d)}"
        m = re.fullmatch(rf"({SIGN})?({NUM})", core)
        if m:
            sign, num = m.group(1), m.group(2)
            if not sign and re.fullmatch(r"\d{4}", num) and self.is_year(int(num)):
                return self.year(int(num))
            return self.signed(sign, self.number(num))
        # letters and digits mixed ("Web3", "5-year", "x402"): read each digit run as a number
        if any(c.isalpha() for c in core):
            def repl(mm: re.Match) -> str:
                return f" {self.number(mm.group(0))} "
            spoken = re.sub(NUM, repl, core)
            spoken = re.sub(r"\s*-\s*", " ", spoken)
            return re.sub(r"\s{2,}", " ", spoken).strip()
        return None

    def slash_date_order(self, a: int, b: int) -> tuple[int, int]:
        """(month, day) for 'a/b/yyyy'. Day-first outside en."""
        return b, a

    def is_year(self, n: int) -> bool:
        return False


# What may not reach espeak: a digit or a symbol it reads wrongly ("$40,000" -> "dollar forty thousand",
# "5-10%" -> "five minus ten", "#1" -> "hash one"). pipeline.py warns about every spoken token still holding one.
UNSPOKEN = re.compile(r"[0-9$%#€£¥₹/]")


def unspoken(spoken: str) -> list[str]:
    """Tokens of a normalized spoken string that still hold a digit or one of $ % # € £ ¥ ₹ /."""
    return [t for t in spoken.split() if UNSPOKEN.search(t)]
