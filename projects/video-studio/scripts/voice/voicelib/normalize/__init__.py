"""Per-language text normalization: numbers, currencies, percentages, dates and symbols -> words.

Space-separated languages (en, es, pt-br, it, hi) normalize token by token (one spoken string per
display token, see common.SpacedNormalizer). zh and ja normalize spans (see zh.spans, ja.spans).
Hand-written tables, not num2words: num2words is LGPL-2.1, has no Hindi, and its output for
currency and decimals does not match how these scripts are read; these tables are unit-tested in
tests/test_normalize.py.
"""

from . import ja, zh
from .common import SpacedNormalizer
from .en import English
from .es import Spanish
from .hi import Hindi
from .it import Italian
from .pt_br import BrazilianPortuguese

_SPACED: dict[str, SpacedNormalizer] = {
    "en": English(),
    "es": Spanish(),
    "pt-br": BrazilianPortuguese(),
    "it": Italian(),
    "hi": Hindi(),
}


def spaced(lang: str) -> SpacedNormalizer:
    try:
        return _SPACED[lang]
    except KeyError:
        raise ValueError(f"no space-separated normalizer for {lang!r}") from None


def normalize_text(text: str, lang: str) -> str:
    """Normalize a whole string (tests and quick checks)."""
    if lang == "zh":
        return zh.normalize_text(text)
    if lang == "ja":
        return ja.normalize_text(text)
    return spaced(lang).normalize_text(text)
