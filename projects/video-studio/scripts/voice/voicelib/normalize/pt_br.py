"""Brazilian Portuguese number words (decimal "vírgula"; BR spellings dezesseis, dezessete, dezenove).
Connector "e": inside hundreds ("cento e vinte e três") and before the last group when that group is
below one hundred or a round hundred ("mil e quinhentos", "dois mil e vinte e seis", but
"mil duzentos e trinta"). Scale nouns are singular below 2 ("1,5 milhão de dólares").
"""

import re

from .common import SpacedNormalizer, split_punct

UNITS = [
    "zero", "um", "dois", "três", "quatro", "cinco", "seis", "sete", "oito", "nove", "dez",
    "onze", "doze", "treze", "quatorze", "quinze", "dezesseis", "dezessete", "dezoito", "dezenove",
]
TENS = {2: "vinte", 3: "trinta", 4: "quarenta", 5: "cinquenta", 6: "sessenta", 7: "setenta", 8: "oitenta", 9: "noventa"}
HUNDREDS = {
    1: "cento", 2: "duzentos", 3: "trezentos", 4: "quatrocentos", 5: "quinhentos",
    6: "seiscentos", 7: "setecentos", 8: "oitocentos", 9: "novecentos",
}
SCALES = [(10**12, "trilhão", "trilhões"), (10**9, "bilhão", "bilhões"), (10**6, "milhão", "milhões"), (1000, "mil", "mil")]
ORDINALS = ["", "primeiro", "segundo", "terceiro", "quarto", "quinto", "sexto", "sétimo", "oitavo", "nono", "décimo"]
MONTHS = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"]


def under_100(n: int) -> str:
    if n < 20:
        return UNITS[n]
    t, u = divmod(n, 10)
    return TENS[t] + (f" e {UNITS[u]}" if u else "")


def under_1000(n: int) -> str:
    if n == 100:
        return "cem"
    h, r = divmod(n, 100)
    if not h:
        return under_100(r)
    return HUNDREDS[h] + (f" e {under_100(r)}" if r else "")


def cardinal(n: int) -> str:
    if n < 0:
        return f"menos {cardinal(-n)}"
    if n == 0:
        return "zero"
    groups: list[str] = []
    rest = n
    for value, singular, plural in SCALES:
        q, rest = divmod(rest, value)
        if q:
            if value == 1000:
                groups.append("mil" if q == 1 else f"{cardinal(q)} mil")
            else:
                groups.append(f"{cardinal(q)} {singular if q == 1 else plural}")
    if rest:
        groups.append(under_1000(rest))
    if len(groups) == 1:
        return groups[0]
    last_value = n % 1000 if rest else _last_group_value(n)
    joiner = " e " if (last_value < 100 or last_value % 100 == 0) else " "
    return " ".join(groups[:-1]) + joiner + groups[-1]


def _last_group_value(n: int) -> int:
    """Value of the lowest non-zero thousand-group (1_500_000 -> 500)."""
    while n and n % 1000 == 0:
        n //= 1000
    return n % 1000


class BrazilianPortuguese(SpacedNormalizer):
    lang = "pt-br"
    decimal_sep = ","
    decimal_word = "vírgula"
    percent_word = "por cento"
    plus_word = "mais"
    minus_word = "menos"
    plusminus_word = "mais ou menos"
    about_word = "cerca de"
    range_word = "a"
    times_word = "vezes"
    currencies = {
        "$": ("dólar", "dólares", "centavo", "centavos"),
        "€": ("euro", "euros", "centavo", "centavos"),
        "£": ("libra", "libras", None, None),
        "¥": ("iene", "ienes", None, None),
        "₹": ("rupia", "rupias", None, None),
    }
    scales = {"k": ("mil", "mil"), "m": ("milhão", "milhões"), "b": ("bilhão", "bilhões"), "t": ("trilhão", "trilhões")}
    scale_words = frozenset({"mil", "milhão", "milhões", "bilhão", "bilhões", "trilhão", "trilhões"})
    connector_after_scale = "de"
    big_scale_words = frozenset({"milhão", "milhões", "bilhão", "bilhões", "trilhão", "trilhões"})
    tickers = {"BTC": "bitcoin", "ETH": "ether", "SOL": "sol", "USDC": "U S D C", "USDT": "U S D T"}
    symbols = {"&": "e", "+": "mais", "=": "igual a", "@": "arroba", "%": "por cento", "~": "cerca de", "×": "vezes"}
    months = MONTHS
    month_lookup = {m: i + 1 for i, m in enumerate(MONTHS)} | {"marco": 3}

    def cardinal(self, n: int) -> str:
        return cardinal(n)

    def ordinal(self, n: int) -> str:
        return ORDINALS[n] if 0 < n < len(ORDINALS) else cardinal(n)

    def is_singular(self, value: float) -> bool:
        return value < 2

    def fraction(self, frac: str) -> str:
        if len(frac) <= 2 and not frac.startswith("0"):
            return cardinal(int(frac))
        return self.digits(frac)

    def cents_joiner(self) -> str:
        return "e"

    def date(self, y: int | None, m: int, d: int) -> str:
        day = "primeiro" if d == 1 else cardinal(d)
        head = f"{day} de {MONTHS[m - 1]}"
        return f"{head} de {cardinal(y)}" if y else head

    def time(self, h: int, mi: int) -> str:
        return cardinal(h) + (f" e {cardinal(mi)}" if mi else " em ponto")

    def ordinal_token(self, core: str) -> str | None:
        m = re.fullmatch(r"(\d+)\.?[ºª°]", core)
        if not m:
            return None
        word = self.ordinal(int(m.group(1)))
        return word[:-1] + "a" if core.endswith("ª") and word.endswith("o") else word

    def multi_date(self, tokens: list[str], i: int) -> tuple[int, list[str]] | None:
        if i + 2 < len(tokens):
            pre, core, post = split_punct(tokens[i])
            if not pre and not post and re.fullmatch(r"1(\.?[ºo°])?", core) and tokens[i + 1] == "de":
                _, mcore, _ = split_punct(tokens[i + 2])
                if mcore.lower() in self.month_lookup:
                    return 1, ["primeiro"]
        return None
