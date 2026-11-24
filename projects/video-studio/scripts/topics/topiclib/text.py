"""Text and time helpers: accent folding, phrase matching, ISO 8601 durations, RFC 3339 times, language hints and
the word-overlap measures behind the copy guard. Standard library only."""

import datetime as dt
import re
import unicodedata

_WS = re.compile(r"\s+")
_WORD = re.compile(r"[a-z0-9]+(?:['’][a-z]+)?")
_DURATION = re.compile(
    r"^P(?:(?P<weeks>\d+)W)?(?:(?P<days>\d+)D)?(?:T(?:(?P<hours>\d+)H)?(?:(?P<minutes>\d+)M)?(?:(?P<seconds>\d+(?:\.\d+)?)S)?)?$"
)


def fold(text):
    """Lowercase, strip accents and collapse whitespace: 'Inyección  de PROMPTS' -> 'inyeccion de prompts'."""
    if not text:
        return ""
    decomposed = unicodedata.normalize("NFKD", str(text).replace("\u2019", "'").replace("\u2018", "'"))
    stripped = "".join(ch for ch in decomposed if not unicodedata.combining(ch))
    return _WS.sub(" ", stripped.casefold()).strip()


def words(text):
    return _WORD.findall(fold(text))


def compile_phrases(phrases):
    """One regex for a list of phrases, matched on folded text at word boundaries. The words of a phrase may be
    joined by spaces, hyphens, dots, slashes or nothing ('rug pull' matches 'rug-pull' and 'rugpull'; 'pump.fun'
    matches 'pump fun'); '*' at the end of a word is a prefix wildcard."""
    alts = []
    for phrase in phrases:
        folded = fold(phrase)
        if not folded:
            continue
        parts = []
        for token in re.split(r"[\s\-_/.:]+", folded):
            star = token.endswith("*")
            token = token.rstrip("*")
            if not token:
                continue
            piece = re.escape(token)
            parts.append(piece + (r"[a-z0-9]*" if star else ""))
        if parts:
            alts.append(r"[\s\-_/.:]*".join(parts))
    if not alts:
        return None
    alts.sort(key=len, reverse=True)
    return re.compile(r"(?<![a-z0-9])(?:" + "|".join(alts) + r")(?![a-z0-9])")


def find_phrases(pattern, folded_text):
    if pattern is None or not folded_text:
        return []
    return [m.group(0) for m in pattern.finditer(folded_text)]


def parse_duration(value):
    """ISO 8601 duration as YouTube sends it (PT15M33S, PT1H2M, P1DT2H3M4S, P0D) -> seconds, or None."""
    if not isinstance(value, str):
        return None
    m = _DURATION.match(value.strip())
    if not m or value.strip() in ("P", "PT") or value.strip().endswith("T"):
        return None
    parts = {k: float(v) if v else 0.0 for k, v in m.groupdict().items()}
    total = parts["weeks"] * 604800 + parts["days"] * 86400 + parts["hours"] * 3600 + parts["minutes"] * 60 + parts["seconds"]
    return int(round(total))


def format_duration(seconds):
    if seconds is None:
        return "unknown length"
    seconds = int(seconds)
    h, rem = divmod(seconds, 3600)
    m, s = divmod(rem, 60)
    return f"{h}:{m:02d}:{s:02d}" if h else f"{m}:{s:02d}"


def parse_time(value):
    """RFC 3339 / ISO 8601 date-time ('2026-11-05T14:00:00Z', with or without fractions) -> aware UTC datetime."""
    if not isinstance(value, str) or not value.strip():
        return None
    text = value.strip()
    if text.endswith("Z") or text.endswith("z"):
        text = text[:-1] + "+00:00"
    try:
        parsed = dt.datetime.fromisoformat(text)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=dt.timezone.utc)
    return parsed.astimezone(dt.timezone.utc)


def rfc3339(moment):
    """Aware datetime -> '2026-08-26T12:00:00Z' (whole seconds, UTC), the form search.list publishedAfter takes."""
    return moment.astimezone(dt.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def days_between(earlier, later):
    return (later - earlier).total_seconds() / 86400.0


# Stopwords per language, used only as a fallback when the API gives no language code.
_STOP = {
    "en": {"the", "and", "you", "your", "how", "what", "this", "with", "for", "are", "why", "from", "that", "was", "is", "it", "my", "of", "to", "in"},
    "es": {"el", "la", "los", "las", "de", "del", "que", "y", "en", "un", "una", "por", "con", "como", "para", "tu", "te", "asi", "es", "su", "no", "mi"},
    "pt": {"o", "a", "os", "as", "de", "do", "da", "dos", "das", "que", "e", "em", "um", "uma", "por", "com", "como", "para", "voce", "seu", "sua", "nao", "meu", "minha"},
}
_PT_MARKERS = re.compile(r"(?:ç|ã|õ)")
_ES_MARKERS = re.compile(r"(?:ñ|¿|¡)")


def language_from_code(code):
    """'es-419' -> 'es', 'pt-BR' -> 'pt', 'en-US' -> 'en'; other languages -> their primary subtag; None if empty."""
    if not code or not isinstance(code, str):
        return None
    primary = code.strip().replace("_", "-").split("-")[0].lower()
    return primary or None


def guess_language(text):
    """'en', 'es' or 'pt' from stopwords and letter markers, or None when the text is too short to tell."""
    if not text:
        return None
    raw = str(text).lower()
    tokens = words(text)
    if len(tokens) < 3:
        return None
    scores = {lang: sum(1 for t in tokens if t in stop) for lang, stop in _STOP.items()}
    if _PT_MARKERS.search(raw):
        scores["pt"] += 2
    if _ES_MARKERS.search(raw):
        scores["es"] += 2
    best = max(scores, key=lambda k: scores[k])
    ranked = sorted(scores.values(), reverse=True)
    if ranked[0] == 0 or ranked[0] == ranked[1]:
        return None
    return best


# Function words ignored by the copy guard, so 'the' or 'de' never count as copied words.
_GUARD_STOP = set().union(*_STOP.values()) | {"a", "an", "i", "me", "we", "our", "us", "on", "at", "by", "be", "or", "do", "can", "will", "just", "one", "all", "into", "out", "up", "so", "if", "lo", "le", "se", "al", "ao", "na", "no", "nos", "nas", "pra"}


def content_words(text):
    return [w for w in words(text) if w not in _GUARD_STOP and len(w) > 1]


def jaccard(a, b):
    sa, sb = set(content_words(a)), set(content_words(b))
    if not sa or not sb:
        return 0.0
    return len(sa & sb) / len(sa | sb)


def longest_shared_run(a, b):
    """Length of the longest run of consecutive content words that appears in both texts, in the same order."""
    wa, wb = content_words(a), content_words(b)
    best = 0
    prev = [0] * (len(wb) + 1)
    for i in range(1, len(wa) + 1):
        cur = [0] * (len(wb) + 1)
        for j in range(1, len(wb) + 1):
            if wa[i - 1] == wb[j - 1]:
                cur[j] = prev[j - 1] + 1
                best = max(best, cur[j])
        prev = cur
    return best


def slugify(text, max_len=64):
    slug = re.sub(r"[^a-z0-9]+", "-", fold(text)).strip("-")
    slug = re.sub(r"-{2,}", "-", slug)
    return slug[:max_len].strip("-")


def truncate(text, limit):
    if text is None:
        return None
    text = str(text)
    return text if len(text) <= limit else text[: max(0, limit - 1)].rstrip() + "…"


def fmt_int(n):
    return "n/a" if n is None else f"{int(n):,}"


def fmt_ratio(x):
    if x is None:
        return "n/a"
    return f"{x:.1f}×" if x < 100 else f"{x:.0f}×"


def fmt_pct(x):
    return "n/a" if x is None else f"{x * 100:.1f}%"
