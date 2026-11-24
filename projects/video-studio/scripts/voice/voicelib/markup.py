"""Narration markup (StoryboardScene.narration in src/episode/types.ts).

  {display|spoken}  show `display` in captions and on screen, speak `spoken`:
                    "{$40,000|forty thousand dollars}". Either side may be empty: {|uh} is spoken only,
                    {SOL|} is shown only.
  [src:id]          the preceding claim is backed by sources[id]. Removed from captions AND speech.
                    "[src:a,b]" (several ids) is accepted too.

Malformed markup raises MarkupError with the character position, so a broken storyboard fails the
build instead of being read aloud with braces in it.
"""

import re
from dataclasses import dataclass


class MarkupError(ValueError):
    pass


@dataclass(frozen=True)
class Text:
    text: str


@dataclass(frozen=True)
class Spoken:
    display: str
    spoken: str


@dataclass(frozen=True)
class SourceRef:
    id: str


Segment = Text | Spoken | SourceRef

_SRC = re.compile(r"\[src:\s*([^\]]*?)\s*\]")
_SRC_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.:\-/]*$")
# Punctuation that hugs the previous word: removing "[src:x]" must not leave "claim ." behind.
_HUG = ".,;:!?…)]}»”\"'%。，、；：！？）」』"


def parse(narration: str) -> list[Segment]:
    """Split narration into Text, Spoken and SourceRef segments, in order."""
    if not isinstance(narration, str):
        raise MarkupError(f"narration must be a string, got {type(narration).__name__}")
    out: list[Segment] = []
    buf: list[str] = []
    i, n = 0, len(narration)

    def flush() -> None:
        if buf:
            out.append(Text("".join(buf)))
            buf.clear()

    while i < n:
        ch = narration[i]
        if ch == "{":
            close = narration.find("}", i + 1)
            if close < 0:
                raise MarkupError(f"unclosed '{{' at {i}: {narration[i:i + 30]!r}")
            body = narration[i + 1 : close]
            if "{" in body:
                raise MarkupError(f"nested '{{' inside markup at {i}: {narration[i:close + 1]!r}")
            if body.count("|") != 1:
                raise MarkupError(f"markup at {i} needs exactly one '|' as {{display|spoken}}: {narration[i:close + 1]!r}")
            display, spoken = body.split("|")
            if not display.strip() and not spoken.strip():
                raise MarkupError(f"empty markup at {i}: {narration[i:close + 1]!r}")
            flush()
            out.append(Spoken(display.strip(), spoken.strip()))
            i = close + 1
        elif ch == "}":
            raise MarkupError(f"unmatched '}}' at {i}: {narration[max(0, i - 20):i + 1]!r}")
        elif ch == "[" and narration.startswith("[src:", i):
            m = _SRC.match(narration, i)
            if not m:
                raise MarkupError(f"unclosed source tag at {i}: {narration[i:i + 30]!r}")
            ids = [s.strip() for s in m.group(1).split(",")]
            if not ids or any(not _SRC_ID.match(s) for s in ids):
                raise MarkupError(f"bad source id in {m.group(0)!r} at {i}")
            flush()
            out.extend(SourceRef(s) for s in ids)
            i = m.end()
        else:
            buf.append(ch)
            i += 1
    flush()
    return out


def strip_sources(segments: list[Segment]) -> list[Segment]:
    """Drop SourceRef segments and repair the whitespace they leave behind.

    "a claim [src:x]. Next" -> "a claim. Next";  "claim [src:x] and more" -> "claim and more".
    """
    out: list[Segment] = []
    for idx, seg in enumerate(segments):
        if not isinstance(seg, SourceRef):
            out.append(seg)
            continue
        nxt = next((s for s in segments[idx + 1 :] if not isinstance(s, SourceRef)), None)
        nxt_text = nxt.text if isinstance(nxt, Text) else (nxt.display if isinstance(nxt, Spoken) else "")
        if out and isinstance(out[-1], Text):
            prev = out[-1].text
            # Trailing space before the tag is redundant when the next text starts with a space,
            # with hugging punctuation, or when nothing follows.
            if not nxt_text or nxt_text[0].isspace() or nxt_text[0] in _HUG:
                out[-1] = Text(prev.rstrip())
    merged: list[Segment] = []
    for seg in out:
        if isinstance(seg, Text) and merged and isinstance(merged[-1], Text):
            merged[-1] = Text(merged[-1].text + seg.text)
        else:
            merged.append(seg)
    return [s for s in merged if not (isinstance(s, Text) and s.text == "")]


def source_ids(narration: str) -> list[str]:
    return [s.id for s in parse(narration) if isinstance(s, SourceRef)]


def _join(parts: list[str]) -> str:
    text = "".join(parts)
    return re.sub(r"[ \t]{2,}", " ", text).strip()


def display_text(narration: str) -> str:
    """Caption text: markup display sides, no source tags."""
    return _join([s.text if isinstance(s, Text) else s.display for s in strip_sources(parse(narration))])


def spoken_text(narration: str) -> str:
    """Raw spoken text (before number normalization): markup spoken sides, no source tags."""
    return _join([s.text if isinstance(s, Text) else s.spoken for s in strip_sources(parse(narration))])
