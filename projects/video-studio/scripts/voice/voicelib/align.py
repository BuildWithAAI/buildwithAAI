"""Map the contextual phoneme stream Kokoro speaks back to the spoken tokens.

espeak phonemizes a sentence in context ("in the" -> "ɪnðə", "that the" -> "ðætðə", flaps, linking r).
Phonemizing word by word instead degrades the audio ("a" -> "ˈeɪ", "to" -> "tuː"), so the audio always
uses the contextual stream and timing is recovered here:

  1. same number of phoneme words as spoken tokens  -> 1:1 ('1:1')
  2. otherwise a phonetic alignment (Needleman-Wunsch) of the tokens' isolated phonemes against the
     contextual phonemes, with cheap word-boundary merges/splits ('phonetic'). Exact to the phone:
     "ɪnðə" gives "in" = ɪn and "the" = ðə.
  3. if that alignment is poor, proportional by phoneme length ('proportional'); the caller logs a
     warning in timeline.warnings.
Spans are [start, end) character ranges into the contextual string, covering a word's stress marks
and length/tone modifiers but not its punctuation.
"""

from dataclasses import dataclass

PUNCT = frozenset(' !"(),.:;?—“”…¡¿«»-')
PRE_MARKS = frozenset("ˈˌ")  # belong to the phone after them
POST_MARKS = frozenset("ːʰʲ̃ᵝ→↓↗↘")  # belong to the phone before them
VOWELS = frozenset("aeiouyæøœɐɑɒɔəɘɚɛɜɞɤɨɪɯɵɶʉʊʌʏᵻᵊAIOQWYɥ")

MATCH, SUB_SAME, SUB_DIFF, GAP, BOUNDARY_GAP = 0, 5, 10, 7, 2
POOR_COST_PER_PHONE = 6.0  # mean cost above this (0.6 of a substitution) -> proportional fallback


@dataclass
class Alignment:
    spans: list[tuple[int, int] | None]  # per token
    method: str  # '1:1' | 'phonetic' | 'proportional' | 'empty'
    cost_per_phone: float = 0.0


def is_phone(ch: str) -> bool:
    return ch not in PUNCT and ch not in PRE_MARKS and ch not in POST_MARKS and not ch.isspace()


def phones(s: str) -> list[int]:
    return [i for i, ch in enumerate(s) if is_phone(ch)]


def word_ranges(s: str) -> list[tuple[int, int]]:
    """[start, end) of each space-separated phoneme word, trimmed of punctuation; only words with phones."""
    out = []
    i, n = 0, len(s)
    while i < n:
        while i < n and s[i].isspace():
            i += 1
        j = i
        while j < n and not s[j].isspace():
            j += 1
        a, b = i, j
        while a < b and s[a] in PUNCT:
            a += 1
        while b > a and s[b - 1] in PUNCT:
            b -= 1
        if any(is_phone(c) for c in s[a:b]):
            out.append((a, b))
        i = j
    return out


def _widen(s: str, first: int, last: int, lo: int, hi: int) -> tuple[int, int]:
    """Grow [first, last] to take in stress marks before and modifiers after, within [lo, hi)."""
    while first - 1 >= lo and s[first - 1] in PRE_MARKS:
        first -= 1
    while last + 1 < hi and s[last + 1] in POST_MARKS:
        last += 1
    return first, last + 1


def _sub_cost(a: str, b: str) -> int:
    if a == b:
        return MATCH
    return SUB_SAME if (a in VOWELS) == (b in VOWELS) else SUB_DIFF


def align(context: str, isolated: list[str]) -> Alignment:
    """`context`: the phoneme string Kokoro speaks. `isolated`: each spoken token phonemized alone."""
    n_tok = len(isolated)
    tok_ph = [[ch for ch in iso if is_phone(ch)] for iso in isolated]
    toks = [k for k in range(n_tok) if tok_ph[k]]
    ranges = word_ranges(context)
    spans: list[tuple[int, int] | None] = [None] * n_tok
    if not toks or not ranges:
        return Alignment(spans, "empty")
    if len(ranges) == len(toks):
        for k, r in zip(toks, ranges):
            spans[k] = r
        return Alignment(spans, "1:1")

    # Sequences with boundary markers (None) between words.
    A: list[tuple[str | None, int]] = []
    for j, k in enumerate(toks):
        if j:
            A.append((None, -1))
        A.extend((ch, k) for ch in tok_ph[k])
    B: list[tuple[str | None, int]] = []
    for j, (a, b) in enumerate(ranges):
        if j:
            B.append((None, -1))
        B.extend((context[i], i) for i in range(a, b) if is_phone(context[i]))

    n, m = len(A), len(B)
    INF = 10**9
    D = [[INF] * (m + 1) for _ in range(n + 1)]
    P = [[0] * (m + 1) for _ in range(n + 1)]  # 1 diag, 2 up (A gap), 3 left (B gap)
    D[0][0] = 0
    for i in range(1, n + 1):
        D[i][0] = D[i - 1][0] + (BOUNDARY_GAP if A[i - 1][0] is None else GAP)
        P[i][0] = 2
    for j in range(1, m + 1):
        D[0][j] = D[0][j - 1] + (BOUNDARY_GAP if B[j - 1][0] is None else GAP)
        P[0][j] = 3
    for i in range(1, n + 1):
        a = A[i - 1][0]
        up_cost = BOUNDARY_GAP if a is None else GAP
        row, prev = D[i], D[i - 1]
        prow = P[i]
        for j in range(1, m + 1):
            b = B[j - 1][0]
            if a is None and b is None:
                diag = prev[j - 1]
            elif a is None or b is None:
                diag = INF
            else:
                diag = prev[j - 1] + _sub_cost(a, b)
            up = prev[j] + up_cost
            left = row[j - 1] + (BOUNDARY_GAP if b is None else GAP)
            if diag <= up and diag <= left:
                row[j], prow[j] = diag, 1
            elif up <= left:
                row[j], prow[j] = up, 2
            else:
                row[j], prow[j] = left, 3

    owner: dict[int, int] = {}  # context index -> token
    i, j = n, m
    while i > 0 or j > 0:
        move = P[i][j]
        if move == 1:
            if A[i - 1][0] is not None:
                owner[B[j - 1][1]] = A[i - 1][1]
            i, j = i - 1, j - 1
        elif move == 2:
            i -= 1
        else:
            j -= 1

    n_phones = sum(len(p) for p in tok_ph)
    cost_per_phone = D[n][m] / max(1, n_phones)
    # Context phones the alignment skipped take the owner of their neighbour in the same word.
    for a, b in ranges:
        idx = [i for i in range(a, b) if is_phone(context[i])]
        known = [owner.get(i) for i in idx]
        if all(k is None for k in known):
            continue
        last = None
        for pos, k in enumerate(known):
            if k is None and last is not None:
                known[pos] = last
            last = known[pos] if known[pos] is not None else last
        nxt = None
        for pos in range(len(known) - 1, -1, -1):
            if known[pos] is None and nxt is not None:
                known[pos] = nxt
            nxt = known[pos] if known[pos] is not None else nxt
        for i_ctx, k in zip(idx, known):
            owner[i_ctx] = k

    per_tok: dict[int, list[int]] = {}
    for i_ctx, k in owner.items():
        per_tok.setdefault(k, []).append(i_ctx)
    ok = cost_per_phone <= POOR_COST_PER_PHONE and all(k in per_tok for k in toks)
    if ok:
        prev_end = -1
        for k in toks:
            first, last = min(per_tok[k]), max(per_tok[k])
            if first <= prev_end:
                ok = False
                break
            lo, hi = next((a, b) for a, b in ranges if a <= first < b)
            spans[k] = _widen(context, first, last, lo, hi)
            prev_end = last
    if ok:
        return Alignment(spans, "phonetic", cost_per_phone)
    return proportional(context, isolated, cost_per_phone)


def proportional(context: str, isolated: list[str], cost_per_phone: float = 0.0) -> Alignment:
    """Share the context phones out in proportion to each token's isolated phoneme length."""
    weights = [sum(1 for ch in iso if is_phone(ch)) for iso in isolated]
    total = sum(weights)
    ctx = phones(context)
    spans: list[tuple[int, int] | None] = [None] * len(isolated)
    if not total or not ctx:
        return Alignment(spans, "empty")
    acc = 0
    prev_cut = 0
    for k, w in enumerate(weights):
        if not w:
            continue
        acc += w
        cut = max(prev_cut + 1, round(acc / total * len(ctx))) if acc < total else len(ctx)
        cut = min(cut, len(ctx))
        if cut > prev_cut:
            first, last = ctx[prev_cut], ctx[cut - 1]
            spans[k] = _widen(context, first, last, 0, len(context))
        prev_cut = cut
    return Alignment(spans, "proportional", cost_per_phone)
