"""Spanish number words (Castilian espeak voice: decimal "coma").
Apocope before nouns and scale words: "un dólar", "veintiún mil", "un millón". "De" after an exact
millón/millones/billón: "dos millones de dólares", but "dos millones quinientos mil dólares".
"""

import re

from .common import SpacedNormalizer, split_punct

UNITS = [
    "cero", "uno", "dos", "tres", "cuatro", "cinco", "seis", "siete", "ocho", "nueve", "diez",
    "once", "doce", "trece", "catorce", "quince", "dieciséis", "diecisiete", "dieciocho", "diecinueve",
    "veinte", "veintiuno", "veintidós", "veintitrés", "veinticuatro", "veinticinco", "veintiséis",
    "veintisiete", "veintiocho", "veintinueve",
]
TENS = {3: "treinta", 4: "cuarenta", 5: "cincuenta", 6: "sesenta", 7: "setenta", 8: "ochenta", 9: "noventa"}
HUNDREDS = {
    1: "ciento", 2: "doscientos", 3: "trescientos", 4: "cuatrocientos", 5: "quinientos",
    6: "seiscientos", 7: "setecientos", 8: "ochocientos", 9: "novecientos",
}
ORDINALS = ["", "primero", "segundo", "tercero", "cuarto", "quinto", "sexto", "séptimo", "octavo", "noveno", "décimo"]
MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"]


def apocope(words: str) -> str:
    """'uno' -> 'un', 'veintiuno' -> 'veintiún' at the end of a number used before a noun."""
    if words.endswith("veintiuno"):
        return words[:-len("veintiuno")] + "veintiún"
    if words == "uno" or words.endswith(" uno"):
        return words[:-3] + "un"
    return words


def under_1000(n: int) -> str:
    if n == 100:
        return "cien"
    h, r = divmod(n, 100)
    parts = []
    if h:
        parts.append(HUNDREDS[h])
    if r:
        if r < 30:
            parts.append(UNITS[r])
        else:
            t, u = divmod(r, 10)
            parts.append(TENS[t] + (f" y {UNITS[u]}" if u else ""))
    return " ".join(parts)


def cardinal(n: int, noun: bool = False) -> str:
    """`noun`: the number is followed by a (masculine) noun or a scale word: apocope applies."""
    if n < 0:
        return f"menos {cardinal(-n, noun)}"
    if n == 0:
        return "cero"
    if n < 1000:
        words = under_1000(n)
        return apocope(words) if noun else words
    if n < 10**6:
        th, r = divmod(n, 1000)
        head = "mil" if th == 1 else f"{apocope(under_1000(th))} mil"
        return head + (f" {cardinal(r, noun)}" if r else "")
    if n < 10**12:
        mi, r = divmod(n, 10**6)
        head = "un millón" if mi == 1 else f"{cardinal(mi, True)} millones"
        return head + (f" {cardinal(r, noun)}" if r else "")
    bi, r = divmod(n, 10**12)
    head = "un billón" if bi == 1 else f"{cardinal(bi, True)} billones"
    return head + (f" {cardinal(r, noun)}" if r else "")


class Spanish(SpacedNormalizer):
    lang = "es"
    decimal_sep = ","
    decimal_word = "coma"
    percent_word = "por ciento"
    plus_word = "más"
    minus_word = "menos"
    plusminus_word = "más o menos"
    about_word = "unos"
    range_word = "a"
    times_word = "veces"
    currencies = {
        "$": ("dólar", "dólares", "centavo", "centavos"),
        "€": ("euro", "euros", "céntimo", "céntimos"),
        "£": ("libra", "libras", None, None),
        "¥": ("yen", "yenes", None, None),
        "₹": ("rupia", "rupias", None, None),
    }
    scales = {"k": ("mil", "mil"), "m": ("millón", "millones"), "b": ("mil millones", "mil millones"), "t": ("billón", "billones")}
    scale_words = frozenset({"mil", "millón", "millones", "billón", "billones"})
    connector_after_scale = "de"
    big_scale_words = frozenset({"millón", "millones", "billón", "billones"})
    tickers = {"BTC": "bitcóin", "ETH": "ether", "SOL": "sol", "USDC": "U S D C", "USDT": "U S D T"}
    symbols = {"&": "y", "+": "más", "=": "igual a", "@": "arroba", "%": "por ciento", "~": "unos", "×": "por"}
    months = MONTHS
    month_lookup = {m: i + 1 for i, m in enumerate(MONTHS)} | {"setiembre": 9}

    def cardinal(self, n: int) -> str:
        return cardinal(n)

    def cardinal_noun(self, n: int) -> str:
        return cardinal(n, noun=True)

    def ordinal(self, n: int) -> str:
        return ORDINALS[n] if 0 < n < len(ORDINALS) else cardinal(n)

    def scaled(self, num: str, scale: str) -> str:
        words = super().scaled(num, scale)
        # "1K" -> "mil", "1B" -> "mil millones", but "1M" stays "un millón"
        return words[3:] if re.match(r"un mil(\s|$)", words) else words

    def fraction(self, frac: str) -> str:
        # "68,67" -> "sesenta y siete"; long or zero-led decimals digit by digit
        if len(frac) <= 2 and not frac.startswith("0"):
            return cardinal(int(frac))
        return self.digits(frac)

    def cents_joiner(self) -> str:
        return "con"

    def date(self, y: int | None, m: int, d: int) -> str:
        day = "primero" if d == 1 else cardinal(d)
        head = f"{day} de {MONTHS[m - 1]}"
        return f"{head} de {cardinal(y)}" if y else head

    def time(self, h: int, mi: int) -> str:
        return cardinal(h) + (f" y {cardinal(mi)}" if mi else " en punto")

    def ordinal_token(self, core: str) -> str | None:
        m = re.fullmatch(r"(\d+)\.?[ºª°]", core)
        if not m:
            return None
        n = int(m.group(1))
        word = self.ordinal(n)
        return word[:-1] + "a" if core.endswith("ª") and word.endswith("o") else word

    def multi_date(self, tokens: list[str], i: int) -> tuple[int, list[str]] | None:
        # "1 de enero" / "1.º de enero" -> "primero de enero"
        if i + 2 < len(tokens):
            pre, core, post = split_punct(tokens[i])
            if not pre and not post and re.fullmatch(r"1(\.?[ºo°])?", core) and tokens[i + 1] == "de":
                _, mcore, _ = split_punct(tokens[i + 2])
                if mcore.lower() in self.month_lookup:
                    return 1, ["primero"]
        return None
