"""Japanese: minimal normalization before misaki (which reads integers itself with num2kana).

The task's normalization list does not include Japanese; this only removes the cases misaki gets
wrong: thousands separators ("40,000" would be read as two numbers), currency symbols before the
number ("$40,000" -> 40000ドル), percent signs, and decimals (misaki would turn the '.' into a full stop:
"68.67" -> 68点六七, digits after the point one by one).
"""

import re

from .common import FULLWIDTH_DIGITS, parse_num

KANJI_DIGITS = "〇一二三四五六七八九"
CURRENCY = {"$": "ドル", "＄": "ドル", "€": "ユーロ", "£": "ポンド", "¥": "円", "￥": "円", "₹": "ルピー"}
SCALE = {"k": 10**3, "m": 10**6, "b": 10**9, "bn": 10**9, "t": 10**12}
NUM = r"\d+(?:[.,]\d+)*"


def _decimal(i: str, f: str | None) -> str:
    return i + (f"点{''.join(KANJI_DIGITS[int(c)] for c in f)}" if f else "")


def _num(s: str, scale: str | None = None) -> str:
    """Digits misaki can read: separators removed; "1.5M" -> "1500000" (read in 万 units)."""
    i, f = parse_num(s, ".")
    if scale:
        frac = f or ""
        whole, rem = divmod(int(i + frac) * SCALE[scale.lower()], 10 ** len(frac))
        return _decimal(str(whole), str(rem).rjust(len(frac), "0").rstrip("0") if rem else None)
    return _decimal(i, f)


_PATTERN = re.compile(rf"([$＄€£¥￥₹])?\s?({NUM})(bn|[kKmMbBtT](?![A-Za-z]))?\s?([%％])?")


def spans(text: str) -> list[tuple[str, str, bool]]:
    text = text.translate(FULLWIDTH_DIGITS)
    out: list[tuple[str, str, bool]] = []
    pos = 0
    for m in _PATTERN.finditer(text):
        if m.start() > pos:
            out.append((text[pos : m.start()], text[pos : m.start()], False))
        cur, num, scale, pct = m.groups()
        try:
            spoken = _num(num, scale)
        except ValueError:
            spoken = num
        if pct:
            spoken += "パーセント"
        if cur:
            spoken += CURRENCY[cur]
        out.append((m.group(0), spoken, True))  # atomic: one caption word
        pos = m.end()
    if pos < len(text):
        out.append((text[pos:], text[pos:], False))
    return out


def normalize_text(text: str) -> str:
    return "".join(s for _, s, _ in spans(text))
