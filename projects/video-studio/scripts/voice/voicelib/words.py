"""Narration -> words. A Word pairs what captions show with what Kokoro says:

  Word(display=["$40,000"], spoken="forty thousand dollars")
  Word(display=["Pump.fun", "founders"], spoken="pump fun founders")   # multi-word {display|spoken}
  Word(display=[], spoken="uh")                                        # {|uh}: spoken only
  Word(display=["—"], spoken="—")                                      # punctuation: no phones

Space-separated languages get one Word per display token. zh/ja plain text arrives as one Word with
`segment=True` and is split into words by the language's G2P (jieba / MeCab), which also supplies
`phonemes` for every word.
"""

from dataclasses import dataclass, field

from . import markup
from .langs import spec
from .normalize import ja as ja_norm
from .normalize import spaced
from .normalize import zh as zh_norm


@dataclass
class Word:
    display: list[str]
    spoken: str
    segment: bool = False  # zh/ja plain text still to be split by the G2P
    phonemes: str = ""  # zh/ja: this word's Kokoro phonemes (set by the G2P)
    start_ms: float | None = None  # scene-relative, set after synthesis
    end_ms: float | None = None
    meta: dict = field(default_factory=dict)


def build_words(narration: str, lang: str) -> list[Word]:
    segments = markup.strip_sources(markup.parse(narration))
    s = spec(lang)
    words: list[Word] = []
    if s.spaced:
        norm = spaced(lang)
        touching = False  # the previous segment ended without whitespace
        for seg in segments:
            if isinstance(seg, markup.Text):
                tokens = seg.text.split()
                spoken = norm.normalize_tokens(tokens)
                if tokens and touching and words and not seg.text[0].isspace():
                    # "{68.67%|...}." -> the "." belongs to the markup word: one caption word "68.67%."
                    _glue(words[-1], tokens.pop(0), spoken.pop(0))
                words.extend(Word([tok], sp) for tok, sp in zip(tokens, spoken))
                touching = bool(seg.text) and not seg.text[-1].isspace()
            else:
                spoken = norm.normalize_text(seg.spoken) if seg.spoken else ""
                display = seg.display.split()
                if touching and words and display and words[-1].display:
                    _glue(words[-1], display.pop(0), "")  # "~{$40|forty dollars}" stays one caption word
                    words[-1].spoken = f"{words[-1].spoken} {spoken}".strip()
                    if display:
                        words.append(Word(display, ""))
                else:
                    words.append(Word(display, spoken))
                touching = True
        return words
    spans_fn = zh_norm.spans if lang == "zh" else ja_norm.spans
    for seg in segments:
        if isinstance(seg, markup.Text):
            for display, spoken, atomic in spans_fn(seg.text):
                if atomic:
                    words.append(Word([display], spoken))
                elif display.strip():
                    words.append(Word([display], spoken, segment=True))
        else:
            spoken = "".join(sp for _, sp, _ in spans_fn(seg.spoken)) if seg.spoken else ""
            words.append(Word([seg.display] if seg.display else [], spoken))
    return words


def _glue(word: Word, display: str, spoken: str) -> None:
    """Attach a token that touches `word` in the text (no space between them)."""
    if word.display:
        word.display[-1] += display
    else:
        word.display.append(display)
    word.spoken += spoken


def spoken_text(words: list[Word]) -> str:
    return " ".join(w.spoken for w in words if w.spoken)
