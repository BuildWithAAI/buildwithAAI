"""Words -> the phoneme string Kokoro speaks (kokoro-onnx `is_phonemes=True`), plus each word's span.

espeak languages (en, es, pt-br, it, hi): the whole scene is phonemized in context by espeak-ng through
phonemizer, exactly as kokoro-onnx does internally, but with `language_switch='remove-flags'`.
kokoro-onnx's own call keeps espeak's "(en)...(hi)" switch flags, and since '(' 'e' 'n' ')' are all in
Kokoro's vocabulary, an English word inside Hindi or Spanish text would be read aloud as "en".
Word spans come from align.py.

misaki languages (zh, ja): misaki 0.7.4, the G2P Kokoro v1.0 was trained with, word by word:
  zh  jieba segmentation, pypinyin, misaki's pinyin->IPA with tone arrows (→ ↗ ↓ ↘)
  ja  MeCab (fugashi + unidic-lite) readings, misaki's kana->IPA (sokuon ʔ joined like misaki does)
Latin words inside zh/ja text (tickers, names) are read with espeak en-us. Spans are exact.

Characters Kokoro's vocabulary lacks are dropped (as Kokoro would) and reported.
"""

import os
import re
import warnings
from dataclasses import dataclass, field

from . import align as aligner
from .langs import spec
from .normalize import spaced
from .words import Word

# Full-width / CJK punctuation -> the ASCII marks in Kokoro's vocabulary (pauses and intonation).
CJK_PUNCT = {
    "，": ",", "、": ",", "。": ".", "．": ".", "！": "!", "？": "?", "：": ":", "；": ";",
    "…": "…", "⋯": "…", "—": "—", "－": "—", "～": "—", "〜": "—", "「": "“", "」": "”", "『": "“", "』": "”",
    "（": "(", "）": ")", "《": "“", "》": "”", "【": "(", "】": ")", "・": " ", "“": "“", "”": "”",
    ",": ",", ".": ".", "!": "!", "?": "?", ":": ":", ";": ";", "(": "(", ")": ")", '"': '"',
}
_LATIN = re.compile(r"[A-Za-z][A-Za-z0-9'.\-]*")


@dataclass
class Phonemized:
    phonemes: str  # exactly what Kokoro is given (vocabulary-filtered, single spaces)
    word_spans: list[tuple[int, int] | None]  # per Word: [start, end) into `phonemes`, None = no phones
    method: str  # 'exact' | '1:1' | 'phonetic' | 'proportional' | 'empty'
    dropped: set[str] = field(default_factory=set)
    words: list[Word] = field(default_factory=list)  # the final word list (zh/ja split by segmenter)


def load_vocab() -> dict[str, int]:
    import json
    import kokoro_onnx

    path = os.path.join(os.path.dirname(kokoro_onnx.__file__), "config.json")
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)["vocab"]


def _filter(text: str, vocab: dict[str, int], dropped: set[str]) -> str:
    out = []
    for ch in text:
        if ch in vocab or ch == " ":
            out.append(ch)
        else:
            dropped.add(ch)
    return " ".join("".join(out).split())


class EspeakG2P:
    def __init__(self, espeak_lang: str, vocab: dict[str, int]):
        import espeakng_loader
        from phonemizer.backend import EspeakBackend
        from phonemizer.backend.espeak.wrapper import EspeakWrapper
        from phonemizer.separator import Separator

        EspeakWrapper.set_data_path(espeakng_loader.get_data_path())
        EspeakWrapper.set_library(espeakng_loader.get_library_path())
        self.vocab = vocab
        self.lang = espeak_lang
        self.sep = Separator(phone="", word=" ", syllable="")
        self.backend = EspeakBackend(
            espeak_lang, preserve_punctuation=True, with_stress=True, language_switch="remove-flags"
        )

    def raw(self, lines: list[str]) -> list[str]:
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            return self.backend.phonemize(lines, separator=self.sep, strip=True)

    def phonemize(self, words: list[Word]) -> Phonemized:
        dropped: set[str] = set()
        tokens: list[tuple[int, str]] = [(wi, t) for wi, w in enumerate(words) for t in w.spoken.split()]
        if not tokens:
            return Phonemized("", [None] * len(words), "empty", dropped, words)
        text = " ".join(t for _, t in tokens)
        context = _filter(self.raw([text])[0], self.vocab, dropped)
        isolated = [_filter(p, self.vocab, set()) for p in self.raw([t for _, t in tokens])]
        result = aligner.align(context, isolated)
        word_spans: list[tuple[int, int] | None] = [None] * len(words)
        for (wi, _), sp in zip(tokens, result.spans):
            if sp is None:
                continue
            cur = word_spans[wi]
            word_spans[wi] = sp if cur is None else (min(cur[0], sp[0]), max(cur[1], sp[1]))
        return Phonemized(context, word_spans, result.method, dropped, words)


def _assemble(words: list[Word], vocab: dict[str, int], dropped: set[str]) -> Phonemized:
    """Join per-word phonemes (zh/ja) and record exact spans."""
    parts: list[str] = []
    spans: list[tuple[int, int] | None] = []
    pos = 0
    for w in words:
        ph = _filter(w.phonemes, vocab, dropped)
        if not ph:
            spans.append(None)
            continue
        if parts:
            parts.append(" ")
            pos += 1
        core = ph.rstrip("".join(aligner.PUNCT))
        lead = len(ph) - len(ph.lstrip("".join(aligner.PUNCT)))
        has_phone = any(aligner.is_phone(c) for c in core)
        spans.append((pos + lead, pos + len(core)) if has_phone else None)
        parts.append(ph)
        pos += len(ph)
    return Phonemized("".join(parts), spans, "exact", dropped, words)


class _LatinMixin:
    """Latin-script words inside zh/ja text: English normalization + espeak en-us."""

    _en: "EspeakG2P | None" = None

    def latin(self, text: str) -> str:
        if self._en is None:
            self._en = EspeakG2P("en-us", self.vocab)
        spoken = spaced("en").normalize_text(text)
        return self._en.raw([spoken])[0]


def _split_plain(text: str) -> list[tuple[str, str]]:
    """Split zh/ja plain text into (display, kind) chunks: 'cjk' runs, 'latin' words, 'punct', 'space'."""
    out: list[tuple[str, str]] = []
    i = 0
    while i < len(text):
        ch = text[i]
        if ch.isspace():
            j = i
            while j < len(text) and text[j].isspace():
                j += 1
            out.append((text[i:j], "space"))
            i = j
            continue
        m = _LATIN.match(text, i)
        if m:
            word = m.group(0)
            trail = len(word) - len(word.rstrip(".-'"))
            word = word[: len(word) - trail] if trail else word
            out.append((word, "latin"))
            i += len(word)
            continue
        if ch in CJK_PUNCT or not ch.isalnum():
            out.append((ch, "punct"))
            i += 1
            continue
        j = i
        while j < len(text) and not text[j].isspace() and text[j] not in CJK_PUNCT and text[j].isalnum() and not _LATIN.match(text, j):
            j += 1
        out.append((text[i:j], "cjk"))
        i = j
    return out


def _attach_punct(words: list[Word], display: str, mark: str) -> None:
    if words:
        words[-1].display = words[-1].display[:-1] + [words[-1].display[-1] + display] if words[-1].display else [display]
        words[-1].phonemes += mark
    else:
        words.append(Word([display], "", phonemes=mark))


class ZhG2P(_LatinMixin):
    def __init__(self, vocab: dict[str, int], cache_dir: str | None = None):
        import logging

        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            import jieba
            from misaki.zh import ZHG2P
        jieba.setLogLevel(logging.WARNING)
        if cache_dir:
            os.makedirs(cache_dir, exist_ok=True)
            jieba.dt.tmp_dir = cache_dir
        self.jieba = jieba
        self.word2ipa = ZHG2P.word2ipa
        self.vocab = vocab

    def ipa(self, word: str) -> str:
        return self.word2ipa(word).replace(chr(815), "")  # misaki strips U+032F at the end of __call__

    def phonemes_of(self, text: str) -> str:
        """Phonemes for a whole atomic span ("四万美元"), punctuation attached."""
        parts: list[str] = []
        for chunk, kind in _split_plain(text):
            if kind == "punct":
                if parts:
                    parts[-1] += CJK_PUNCT.get(chunk, "")
            elif kind == "latin":
                parts.append(self.latin(chunk))
            elif kind == "cjk":
                parts.extend(self.ipa(t) for t in self.jieba.lcut(chunk) if t.strip())
        return " ".join(p for p in parts if p)

    def phonemize(self, words: list[Word]) -> Phonemized:
        out: list[Word] = []
        for w in words:
            if not w.segment:
                out.append(Word(list(w.display), w.spoken, phonemes=self.phonemes_of(w.spoken) if w.spoken else ""))
                continue
            for chunk, kind in _split_plain(w.spoken):
                if kind == "space":
                    continue
                if kind == "punct":
                    _attach_punct(out, chunk, CJK_PUNCT.get(chunk, ""))
                elif kind == "latin":
                    out.append(Word([chunk], chunk, phonemes=self.latin(chunk)))
                else:
                    for t in self.jieba.lcut(chunk):
                        out.append(Word([t], t, phonemes=self.ipa(t)))
        return _assemble(out, self.vocab, set())


class JaG2P(_LatinMixin):
    def __init__(self, vocab: dict[str, int]):
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            import jaconv
            from misaki import ja as mja
        self.mja = mja
        self.jaconv = jaconv
        self.g = mja.JAG2P()
        self.vocab = vocab
        self.punct_out = set(".,?!:;“”()[]—…\"' «»")

    def groups(self, text: str) -> list[tuple[str, str]]:
        """misaki 0.7.4 JAG2P.__call__, keeping each group's surface: [(surface, phonemes)]."""
        mja, g = self.mja, self.g
        text = g._normalize_text(text)
        words = [
            mja.Word(w.surface, self.jaconv.kata2hira(w.feature.pron or w.feature.kana or w.surface), 6 if w.char_type == 7 or not w.is_unk else w.char_type)
            for w in g.tagger(text)
        ]
        groups = []
        i = 0
        while i < len(words):
            z = next((z for z in range(i + 1, len(words)) if words[z].char_type != words[i].char_type), len(words))
            j = next((j for j in range(z, i, -1) if "".join(w.surface for w in words[i:j]) in mja.JA_WORDS), None)
            if j is None:
                groups.append([words[i]])
                i += 1
            else:
                groups.append(words[i:j])
                i = j
        out = []
        for grp in groups:
            word = mja.Word("".join(w.surface for w in grp), "".join(w.hira for w in grp), grp[0].char_type)
            out.append((word.surface, g._romaji_word(word).replace("っ", "")))
        return out

    def phonemes_of(self, text: str) -> str:
        """Phonemes for a whole atomic span ("40000ドル"), punctuation attached."""
        parts: list[str] = []
        for chunk, kind in _split_plain(text):
            if kind == "latin":
                parts.append(self.latin(chunk))
            elif kind == "punct":
                if parts:
                    parts[-1] += CJK_PUNCT.get(chunk, "")
            elif kind == "cjk":
                for _, roma in self.groups(chunk):
                    if not roma.strip():
                        continue
                    if all(c in self.punct_out for c in roma) and parts:
                        parts[-1] += CJK_PUNCT.get(roma.strip(), roma.strip())
                    else:
                        parts.append(roma)
        return " ".join(p for p in parts if p)

    def phonemize(self, words: list[Word]) -> Phonemized:
        out: list[Word] = []
        for w in words:
            if not w.segment:
                out.append(Word(list(w.display), w.spoken, phonemes=self.phonemes_of(w.spoken) if w.spoken else ""))
                continue
            for chunk, kind in _split_plain(w.spoken):
                if kind == "space":
                    continue
                if kind == "latin":
                    out.append(Word([chunk], chunk, phonemes=self.latin(chunk)))
                    continue
                if kind == "punct":
                    _attach_punct(out, chunk, CJK_PUNCT.get(chunk, ""))
                    continue
                for surface, roma in self.groups(chunk):
                    if not roma.strip():
                        if out:
                            _attach_punct(out, surface, "")
                        continue
                    if all(c in self.punct_out for c in roma):
                        _attach_punct(out, surface, CJK_PUNCT.get(roma.strip(), roma.strip()))
                        continue
                    # sokuon: misaki joins a word ending or starting in ʔ to its neighbour
                    if out and (out[-1].phonemes.endswith("ʔ") or roma.startswith("ʔ")) and out[-1].phonemes[-1:] not in self.punct_out:
                        out[-1].display = out[-1].display[:-1] + [out[-1].display[-1] + surface] if out[-1].display else [surface]
                        out[-1].phonemes += roma
                        out[-1].spoken += surface
                        continue
                    out.append(Word([surface], surface, phonemes=roma))
        return _assemble(out, self.vocab, set())


def make(lang: str, vocab: dict[str, int], cache_dir: str | None = None):
    s = spec(lang)
    if s.g2p == "espeak":
        return EspeakG2P(s.espeak, vocab)
    try:
        if lang == "zh":
            return ZhG2P(vocab, cache_dir)
        if lang == "ja":
            return JaG2P(vocab)
    except ImportError as e:
        raise RuntimeError(
            f"--lang {lang} needs misaki 0.7.4 and its {lang} dependencies ({e.name} is missing). "
            "Run scripts/voice/setup.sh (it installs scripts/voice/requirements-cjk.txt)."
        ) from e
    raise ValueError(f"no G2P for {lang}")
