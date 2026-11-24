"""Languages the voice step supports (mirrors `Lang` in src/episode/types.ts).

Each language needs a MALE Kokoro v1.0 voice for ZOO. French has none, so it is not supported.
`g2p` selects how text becomes Kokoro phonemes:
  espeak  espeak-ng through phonemizer, the same backend kokoro-onnx uses internally
  misaki  hexgrad's misaki 0.7.4 (the G2P Kokoro v1.0 was trained with); needed for ja and zh,
          because espeak's `cmn` output drops sounds Kokoro lacks (e.g. ʐ) and writes '.' as a
          retroflex marker that Kokoro reads as a full stop, and espeak reads Japanese kanji as
          "Japanese letter".
"""

from dataclasses import dataclass


@dataclass(frozen=True)
class LangSpec:
    code: str  # the Lang value in types.ts
    voice: str  # default male Kokoro voice for ZOO
    espeak: str | None  # espeak-ng language code (espeak G2P only)
    g2p: str  # 'espeak' | 'misaki'
    decimal_sep: str  # the language's decimal separator in written numbers
    spaced: bool  # words are separated by spaces (False for zh/ja)


LANGS: dict[str, LangSpec] = {
    "en": LangSpec("en", "am_michael", "en-us", "espeak", ".", True),
    "es": LangSpec("es", "em_alex", "es", "espeak", ",", True),
    "pt-br": LangSpec("pt-br", "pm_alex", "pt-br", "espeak", ",", True),
    "hi": LangSpec("hi", "hm_omega", "hi", "espeak", ".", True),
    "it": LangSpec("it", "im_nicola", "it", "espeak", ",", True),
    "zh": LangSpec("zh", "zm_yunjian", None, "misaki", ".", False),
    "ja": LangSpec("ja", "jm_kumo", None, "misaki", ".", False),
}

SUPPORTED = tuple(LANGS)


def spec(lang: str) -> LangSpec:
    try:
        return LANGS[lang]
    except KeyError:
        hint = " French is not supported: Kokoro v1.0 has no male French voice for ZOO." if lang.lower().startswith("fr") else ""
        raise ValueError(f"unsupported language {lang!r}; supported: {', '.join(SUPPORTED)}.{hint}") from None
