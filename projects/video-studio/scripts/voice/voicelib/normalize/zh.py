"""Chinese (Mandarin) normalization: written numbers -> Chinese numerals, as spans of the text.

Chinese has no spaces, so instead of per-token output this returns (display, spoken) spans that tile
the text; the zh G2P (misaki) then segments the plain spans with jieba.
  * "40,000" -> 四万; "1005" -> 一千零五; "100010" -> 十万零一十; 两 before 千/万/亿 ("两万").
  * years before 年 digit by digit: "2026年" -> 二零二六年; "11月24日" -> 十一月二十四日.
  * decimals with 点 digit by digit: 68.67 -> 六十八点六七; percent: 百分之六十八点六七.
  * "$40,000" -> 四万美元; "$1.5M" -> 一百五十万美元 (scaled to 万/亿).
  * signed percentages: "+402%" -> 上涨百分之四百零二, "−84%" -> 下跌百分之八十四.
"""

import re
from collections.abc import Callable

from .common import FULLWIDTH_DIGITS, parse_num

DIG = "零一二三四五六七八九"
BIG = ["", "万", "亿", "万亿"]
CURRENCY = {
    "$": "美元", "＄": "美元", "€": "欧元", "£": "英镑", "¥": "元", "￥": "元", "₹": "卢比",
    "US$": "美元", "R$": "巴西雷亚尔", "A$": "澳元", "C$": "加元", "MX$": "墨西哥比索",
}
SCALE = {"k": 10**3, "m": 10**6, "b": 10**9, "bn": 10**9, "t": 10**12, "万": 10**4, "亿": 10**8}
TICKERS = {"BTC": "比特币", "ETH": "以太币"}
NUM = r"\d+(?:[.,]\d+)*"
SIGN = r"[+\-−±]"


def _group(n: int) -> str:
    """1..9999 within a 4-digit group: 1005 -> 一千零五."""
    out: list[str] = []
    zero = False
    for value, unit in ((1000, "千"), (100, "百"), (10, "十"), (1, "")):
        d = n // value % 10
        if d == 0:
            if out:
                zero = True
            continue
        if zero:
            out.append("零")
            zero = False
        out.append(("两" if d == 2 and unit == "千" else DIG[d]) + unit)
    return "".join(out)


def cardinal(n: int) -> str:
    if n < 0:
        return "负" + cardinal(-n)
    if n == 0:
        return "零"
    groups = []
    while n:
        groups.append(n % 10000)
        n //= 10000
    out = ""
    gap = False
    for idx in range(len(groups) - 1, -1, -1):
        v = groups[idx]
        if v == 0:
            if out:
                gap = True
            continue
        if out and (v < 1000 or gap):
            out += "零"
        words = "两" if v == 2 and idx > 0 else _group(v)
        out += words + BIG[idx]
        gap = False
    if out.startswith("一十"):
        out = out[1:]
    return out


def digits(s: str) -> str:
    return "".join(DIG[int(c)] for c in s)


def number(s: str) -> str:
    i, f = parse_num(s, ".")
    head = cardinal(int(i))
    return f"{head}点{digits(f)}" if f else head


def scaled_value(num: str, scale: str) -> tuple[int, str | None]:
    """'1.5', 'M' -> (1500000, None); exact integer arithmetic."""
    i, f = parse_num(num, ".")
    frac = f or ""
    total = int(i + frac) * SCALE[scale.lower() if scale not in ("万", "亿") else scale]
    whole, rem = divmod(total, 10 ** len(frac))
    if rem == 0:
        return whole, None
    return whole, str(rem).rjust(len(frac), "0").rstrip("0")


def _amount(num: str, scale: str | None) -> str:
    if scale:
        whole, frac = scaled_value(num, scale)
        return cardinal(whole) + (f"点{digits(frac)}" if frac else "")
    i, f = parse_num(num, ".")
    f = (f or "").rstrip("0") or None
    return cardinal(int(i)) + (f"点{digits(f)}" if f else "")


_RULES: list[tuple[re.Pattern, Callable[[re.Match], str]]] = []


def rule(pattern: str):
    def deco(fn):
        _RULES.append((re.compile(pattern), fn))
        return fn
    return deco


@rule(r"(\d{4})-(\d{1,2})-(\d{1,2})")
def _iso(m: re.Match) -> str:
    return f"{digits(m.group(1))}年{cardinal(int(m.group(2)))}月{cardinal(int(m.group(3)))}日"


@rule(r"(\d{1,2}):(\d{2})(?!\d)")
def _time(m: re.Match) -> str:
    h, mi = int(m.group(1)), int(m.group(2))
    return f"{cardinal(h)}点" + (f"{cardinal(mi)}分" if mi else "")


@rule(r"(\d{4})\s?年")
def _year(m: re.Match) -> str:
    return digits(m.group(1)) + "年"  # the unit stays in the span: one caption word "2026年"


@rule(r"(\d{1,2})\s?([月日号点时])")
def _month_day(m: re.Match) -> str:
    return cardinal(int(m.group(1))) + m.group(2)


@rule(rf"({SIGN})?(US\$|R\$|A\$|C\$|MX\$|[$＄€£¥￥₹])\s?({NUM})(bn|[kKmMbBtT万亿])?")
def _money(m: re.Match) -> str:
    sign = {"-": "负", "−": "负"}.get(m.group(1) or "", "")
    return sign + _amount(m.group(3), m.group(4)) + CURRENCY[m.group(2)]


@rule(r"#(\d+)")
def _number_sign(m: re.Match) -> str:
    return f"{cardinal(int(m.group(1)))}号"  # "#1" -> 一号, never "hash"


@rule(rf"({SIGN})?({NUM})\s?[%％]")
def _percent(m: re.Match) -> str:
    sign = {"+": "上涨", "-": "下跌", "−": "下跌", "±": "正负"}.get(m.group(1) or "", "")
    return f"{sign}百分之{number(m.group(2))}"


@rule(rf"({NUM})\s?[xX×](?![A-Za-z])")
def _times(m: re.Match) -> str:
    return f"{number(m.group(1))}倍"


@rule(rf"({SIGN})?({NUM})(bn|[kKMBT])(?![A-Za-z])")
def _scaled(m: re.Match) -> str:
    sign = {"-": "负", "−": "负", "+": "正"}.get(m.group(1) or "", "")
    return sign + _amount(m.group(2), m.group(3))


@rule(rf"({NUM})\s?[-–~～]\s?({NUM})(?![.,]?\d)(\s?[%％])?")
def _range(m: re.Match) -> str:
    if m.group(3):
        return f"百分之{number(m.group(1))}到百分之{number(m.group(2))}"
    return f"{number(m.group(1))}到{number(m.group(2))}"


@rule(r"\$?(BTC|ETH)(?![A-Za-z])")
def _ticker(m: re.Match) -> str:
    return TICKERS[m.group(1)]


@rule(rf"({SIGN})?({NUM})")
def _number(m: re.Match) -> str:
    sign = {"-": "负", "−": "负", "+": "正"}.get(m.group(1) or "", "")
    if m.group(1) and m.start() > 0 and m.string[m.start() - 1].isdigit():
        sign = ""
    return sign + number(m.group(2))


SYMBOLS = {"~": "约", "≈": "约", "&": "和", "+": "加", "=": "等于", "@": "艾特"}


@rule(r"[~≈&+=@]")
def _symbol(m: re.Match) -> str:
    return SYMBOLS[m.group(0)]


def spans(text: str) -> list[tuple[str, str, bool]]:
    """Tile `text` with (display, spoken, atomic) spans. Atomic spans (every rule match) are kept
    whole as one caption word; plain spans (spoken == display) are segmented later by jieba."""
    text = text.translate(FULLWIDTH_DIGITS)
    out: list[tuple[str, str, bool]] = []
    pos = 0
    while pos < len(text):
        best = None
        for pattern, fn in _RULES:
            m = pattern.search(text, pos)
            if m and m.end() > m.start() and (best is None or m.start() < best[0].start()):
                best = (m, fn)
        if best is None:
            out.append((text[pos:], text[pos:], False))
            break
        m, fn = best
        if m.start() > pos:
            out.append((text[pos : m.start()], text[pos : m.start()], False))
        try:
            spoken = fn(m)
        except ValueError:
            spoken = m.group(0)
        out.append((m.group(0), spoken, True))
        pos = m.end()
    return out


def normalize_text(text: str) -> str:
    return "".join(s for _, s, _ in spans(text))
