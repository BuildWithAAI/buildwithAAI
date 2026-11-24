"""Italian number words (decimal "virgola"). Compounds are one word below a million
("duemilaventisei", "quarantamila"); tens drop their vowel before uno/otto ("ventuno", "trentotto");
a final "tre" in a compound takes the accent ("ventitré", "centotré"); "un milione", "due milioni".
"""

import re

from ..lexicon import PRONUNCIATIONS
from .common import SpacedNormalizer, split_punct

UNITS = [
    "zero", "uno", "due", "tre", "quattro", "cinque", "sei", "sette", "otto", "nove", "dieci",
    "undici", "dodici", "tredici", "quattordici", "quindici", "sedici", "diciassette", "diciotto", "diciannove",
]
TENS = {2: "venti", 3: "trenta", 4: "quaranta", 5: "cinquanta", 6: "sessanta", 7: "settanta", 8: "ottanta", 9: "novanta"}
ORDINALS = ["", "primo", "secondo", "terzo", "quarto", "quinto", "sesto", "settimo", "ottavo", "nono", "decimo"]
MONTHS = ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"]


def under_100(n: int) -> str:
    if n < 20:
        return UNITS[n]
    t, u = divmod(n, 10)
    tens = TENS[t]
    if u == 0:
        return tens
    if u in (1, 8):
        tens = tens[:-1]
    return tens + UNITS[u]


def under_1000(n: int) -> str:
    h, r = divmod(n, 100)
    if not h:
        return under_100(r)
    head = "cento" if h == 1 else UNITS[h] + "cento"
    if not r:
        return head
    if r // 10 == 8:
        head = head[:-1]  # centottanta
    return head + under_100(r)


def _accent(words: str) -> str:
    return words[:-3] + "tré" if words.endswith("tre") and words != "tre" and not words.endswith(" tre") else words


def cardinal(n: int) -> str:
    if n < 0:
        return f"meno {cardinal(-n)}"
    if n < 1000:
        return _accent(under_1000(n))
    if n < 10**6:
        th, r = divmod(n, 1000)
        head = "mille" if th == 1 else under_1000(th) + "mila"
        return _accent(head + (under_1000(r) if r else ""))
    if n < 10**9:
        mi, r = divmod(n, 10**6)
        head = "un milione" if mi == 1 else f"{cardinal(mi)} milioni"
        return head + (f" {cardinal(r)}" if r else "")
    bi, r = divmod(n, 10**9)
    head = "un miliardo" if bi == 1 else f"{cardinal(bi)} miliardi"
    return head + (f" {cardinal(r)}" if r else "")


class Italian(SpacedNormalizer):
    lang = "it"
    decimal_sep = ","
    decimal_word = "virgola"
    percent_word = "per cento"
    plus_word = "più"
    minus_word = "meno"
    plusminus_word = "più o meno"
    about_word = "circa"
    range_word = "a"
    times_word = "volte"
    currencies = {
        "$": ("dollaro", "dollari", "centesimo", "centesimi"),
        "€": ("euro", "euro", "centesimo", "centesimi"),
        "£": ("sterlina", "sterline", None, None),
        "¥": ("yen", "yen", None, None),
        "₹": ("rupia", "rupie", None, None),
        "US$": ("dollaro", "dollari", "centesimo", "centesimi"),
        "R$": ("real brasiliano", "real brasiliani", "centavo", "centavos"),
        "A$": ("dollaro australiano", "dollari australiani", "centesimo", "centesimi"),
        "C$": ("dollaro canadese", "dollari canadesi", "centesimo", "centesimi"),
        "MX$": ("peso messicano", "pesos messicani", "centavo", "centavos"),
    }
    scales = {"k": ("mila", "mila"), "m": ("milione", "milioni"), "b": ("miliardo", "miliardi"), "t": ("bilione", "bilioni")}
    scale_words = frozenset({"mila", "mille", "milione", "milioni", "miliardo", "miliardi"})
    connector_after_scale = "di"
    big_scale_words = frozenset({"milione", "milioni", "miliardo", "miliardi", "bilione", "bilioni"})
    tickers = {"BTC": "bitcoin", "ETH": "ether", "SOL": "sol", "USDC": "U S D C", "USDT": "U S D T"}
    symbols = {"&": "e", "+": "più", "=": "uguale a", "@": "chiocciola", "%": "per cento", "~": "circa", "×": "per", "#": "numero", "nº": "numero", "n°": "numero", "N°": "numero"}
    months = MONTHS
    month_lookup = {m: i + 1 for i, m in enumerate(MONTHS)}
    lexicon = PRONUNCIATIONS["it"]
    number_word = "numero"

    def cardinal(self, n: int) -> str:
        return cardinal(n)

    def cardinal_noun(self, n: int) -> str:
        return "un" if n == 1 else cardinal(n)

    def ordinal(self, n: int) -> str:
        return ORDINALS[n] if 0 < n < len(ORDINALS) else cardinal(n)

    def scaled(self, num: str, scale: str) -> str:
        from .common import parse_num

        i, f = parse_num(num, self.decimal_sep)
        if scale.lower() == "k" and f is None:  # "40K" -> "quarantamila", "1K" -> "mille" (one word)
            return cardinal(int(i) * 1000)
        return super().scaled(num, scale)  # "1,5K" -> "uno virgola cinque mila"

    def fraction(self, frac: str) -> str:
        if len(frac) <= 2 and not frac.startswith("0"):
            return cardinal(int(frac))
        return self.digits(frac)

    def cents_joiner(self) -> str:
        return "e"

    def date(self, y: int | None, m: int, d: int) -> str:
        day = "primo" if d == 1 else cardinal(d)
        head = f"{day} {MONTHS[m - 1]}"
        return f"{head} {cardinal(y)}" if y else head

    def time(self, h: int, mi: int) -> str:
        return cardinal(h) + (f" e {cardinal(mi)}" if mi else " in punto")

    def percent_range(self, a: str, b: str) -> str:
        return f"da {self.number(a)} a {self.number(b)} {self.percent_word}"

    def hours(self, h: int, mi: int | None) -> str | None:
        return f"{cardinal(h)} e {cardinal(mi)}" if mi else f"{cardinal(h)} {'ora' if h == 1 else 'ore'}"

    def fraction_words(self, n: int, d: int) -> str | None:
        one = {2: "mezzo", 3: "terzo", 4: "quarto", 5: "quinto", 6: "sesto", 7: "settimo", 8: "ottavo", 9: "nono", 10: "decimo"}[d]
        return f"un {one}" if n == 1 else f"{cardinal(n)} {one[:-1]}i"

    def ordinal_token(self, core: str) -> str | None:
        m = re.fullmatch(r"(\d+)\.?[ºª°]", core)
        if not m:
            return None
        word = self.ordinal(int(m.group(1)))
        return word[:-1] + "a" if core.endswith("ª") and word.endswith("o") else word

    def multi_date(self, tokens: list[str], i: int) -> tuple[int, list[str]] | None:
        # "1 novembre" / "1° novembre" -> "primo novembre"
        if i + 1 < len(tokens):
            pre, core, post = split_punct(tokens[i])
            if not pre and not post and re.fullmatch(r"1[º°]?", core):
                _, mcore, _ = split_punct(tokens[i + 1])
                if mcore.lower() in self.month_lookup:
                    return 1, ["primo"]
        return None
