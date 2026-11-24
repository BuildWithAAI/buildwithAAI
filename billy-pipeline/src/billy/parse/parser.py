"""Deterministic parser for the 'Daily Technical Outlook' template.

Pure regex/rule based (no ML, no network) so the same text always yields the
same Signal. Design:
  1. header  -> asset ("BTC Daily Technical Outlook:")
  2. sentence 1 -> close label ("closed strongly bullish", "closed as a doji", ...)
  3. each clause -> zero or one Scenario:  condition (above/below + level),
     outcome (long/short/upside/decline/sideways), optional 'towards $T' target,
     kind (breakout vs retest "...and then turning bullish").
     Clauses like "Below, ..." without a price inherit the previous level.
  4. bare "$X ... support/resistance" mentions -> level map
  5. primary scenario = first explicit long/short, else first directional one.
"""
from __future__ import annotations

import re
from collections.abc import Iterable

from ..models import Post, Scenario, Signal, StatedPosition

ASSET_ALIASES = {"BTC": "BTC", "BITCOIN": "BTC", "ETH": "ETH", "XRP": "XRP", "LTC": "LTC", "LINK": "LINK"}

HEADER_RE = re.compile(r"^\s*\$?([A-Za-z]+)\s+Daily\s+Technical\s+Outlook", re.I)
PRICE_RE = re.compile(r"\$\s?((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)(?![A-Za-z])\s*(k|K)?")
URL_RE = re.compile(r"https?://\S+")

_CL = r"(?:closed|printed|close|closing)\b[^.$]{0,40}?"
CLOSE_PATTERNS: list[tuple[re.Pattern[str], str, int]] = [
    (re.compile(_CL + r"gravestone", re.I), "gravestone_doji", -1),
    (re.compile(_CL + r"dragonfly", re.I), "dragonfly_doji", 1),
    (re.compile(_CL + r"\b(?:strongly|massively|very|extremely|strong)\s+bullish\b(?!\s+engulfing)", re.I), "strongly_bullish", 2),
    (re.compile(_CL + r"\b(?:strongly|massively|very|extremely|strong)\s+bearish\b(?!\s+engulfing)", re.I), "strongly_bearish", -2),
    (re.compile(_CL + r"bullish\s+engulfing", re.I), "bullish_engulfing", 2),
    (re.compile(_CL + r"bearish\s+engulfing", re.I), "bearish_engulfing", -2),
    (re.compile(_CL + r"\bslightly\s+(?:bullish|green)", re.I), "slightly_bullish", 1),
    (re.compile(_CL + r"\bslightly\s+(?:bearish|red)", re.I), "slightly_bearish", -1),
    (re.compile(_CL + r"upper\s+wick", re.I), "upper_wick", -1),
    (re.compile(_CL + r"lower\s+wick", re.I), "lower_wick", 1),
    (re.compile(_CL + r"\bdoji\b", re.I), "doji", 0),
    (re.compile(_CL + r"\bindecisive", re.I), "indecisive", 0),
    (re.compile(_CL + r"\bneutral\b", re.I), "indecisive", 0),
    (re.compile(_CL + r"\b(?:bullish|green)\b", re.I), "bullish", 1),
    (re.compile(_CL + r"\b(?:bearish|red)\b", re.I), "bearish", -1),
    (re.compile(r"closed\s+above\b", re.I), "bullish", 1),
    (re.compile(r"closed\s+below\b", re.I), "bearish", -1),
    (re.compile(r"^\s*\$?\w+\s+(?:\w+\s+){0,4}?(?:declined|dropped|dumped|had\s+a\s+(?:sharp\s+)?decline)", re.I), "bearish", -1),
    (re.compile(r"^\s*\$?\w+\s+(?:\w+\s+){0,4}?(?:rallied|pumped|surged|pushed\s+higher)", re.I), "bullish", 1),
]

COND_ABOVE = re.compile(
    r"\b(?:hold(?:ing|s)?|stay(?:ing)?|keep(?:ing)?\s+it|trading|mov(?:e|es|ing)|push(?:ing)?|clos(?:e|ing)|break(?:ing)?(?:out)?|"
    r"stable\s+(?:chart|move|price\s+action|candles?)?|bullish\s+breakout(?:\s+of\s+(?:this|that|the))?)?\s*"
    r"(?:above|over|of\s+(?:this|that)\s+resistance)\b"
    r"|\bbullish\s+breakout\b|\breclaim(?:ing|s)?\b",
    re.I,
)
COND_BELOW = re.compile(
    r"\b(?:hold(?:ing|s)?|stay(?:ing)?|keep(?:ing)?\s+it|trading|mov(?:e|es|ing)|push(?:ing)?|clos(?:e|ing)|break(?:ing)?(?:down)?|"
    r"drop(?:ping)?|fall(?:ing)?)?\s*(?:below|under)\b"
    r"|\bbearish\s+breakout\b|\bbreakdown\b|\blos(?:e|ing)\b",
    re.I,
)
RETEST_RE = re.compile(
    r"retest|and\s+then\s+a\s+decline|pullback|(?:bearish|bullish)\s+move[^.]*?and\s+then|and\s+then\s+(?:turning|showing|declining|weakness|bounc)",
    re.I,
)
RETEST_LONG = re.compile(r"and\s+then\s+(?:turn\s+(?:more\s+)?bullish|turning\s+(?:more\s+)?bullish|bounc\w*|showing\s+strength)", re.I)
RETEST_SHORT = re.compile(
    r"and\s+then\s+(?:a\s+)?(?:turning\s+(?:more\s+)?bearish|showing\s+weakness|weakness|declin\w*|drop\w*|rejection)", re.I)

LONG_WORD = re.compile(r"(?<!as )\blong\b(?!\s+as\s+(?:it|price|the|we|this|that|BTC|bitcoin)\b)(?!-term)", re.I)
SHORT_WORD = re.compile(r"\bshort(?!-term)\b", re.I)
UP_WORDS = re.compile(
    r"\b(?:upside|bullish|rally|higher|upward|up\s*move|move\s+up|positive|recover\w*|impulsive|push(?:es)?\s+(?:it\s+)?(?:higher|up)|"
    r"bull(?:s|ish)?\s+(?:area|zone|territory))\b",
    re.I,
)
DOWN_WORDS = re.compile(
    r"\b(?:decline\w*|bearish|downside|downward|lower|weak(?:ness)?|drop|dump|sell-?off|correction|push(?:es)?\s+(?:it\s+)?down|keep\s+pushing\s+down)\b",
    re.I,
)
FLAT_WORDS = re.compile(r"\b(?:sideways|range|ranging|choppy|consolidat\w*)\b", re.I)
TARGET_RE = re.compile(r"(?:towards?|to|toward|target(?:ing)?|reach(?:ing)?|test(?:ing)?|find)\s+(?:the\s+)?(?:next\s+)?(?:\w+\s+)?\$", re.I)
SUPPORT_RE = re.compile(r"support", re.I)
RESIST_RE = re.compile(r"resistance", re.I)
LEVEL_FOLLOWS = re.compile(r",?\s*(?:the\s+|this\s+|that\s+|its\s+)?(?:[\w-]+\s+){0,2}?\$")
MODAL_RE = re.compile(
    r"\b(?:will|can|could|would|should|may|might|offer\w*|trigger\w*|likely|expect\w*|needs?|going\s+to|area|zone|"
    r"territory|location|sign|confirm\w*|lead\w*|push\w*)\b|'ll\b|\bis\s+(?:a\s+)?(?:bullish|bearish|positive|negative|weak)",
    re.I,
)
STATE_RE = re.compile(
    r"(?:is|are|was|currently|now|simply|chart)\s+(?:\w+\s+){0,3}?(holding|trading|hovering|teasing|sitting|consolidating)\s+"
    r"(above|below|close\s+to|near|around|at|within)?\s*(?:the\s+)?\$",
    re.I,
)

FLAG_PATTERNS: dict[str, re.Pattern[str]] = {
    "waits_for_confirmation": re.compile(r"\bwait\w*\b|stable|mature|for\s+a\s+while|confirm|clarity|healthy", re.I),
    "btc_dependent": re.compile(r"bitcoin|\bBTC\b(?!\.D)", re.I),
    "dominance_mentioned": re.compile(r"dominance|BTC\.D|USDT\.D", re.I),
    "pair_dependent": re.compile(r"\b(?:ETH|XRP|LTC|LINK)BTC\b", re.I),
    "event_risk": re.compile(r"\bNFP\b|\bFOMC\b|\bCPI\b|\bPCE\b|weekly\s+(?:transition|close|opening)|monthly|weekend|fundamental", re.I),
    "trade_in_progress": re.compile(r"\bsecur\w*|current\s+trade|our\s+trade", re.I),
    "fakeout_warning": re.compile(r"fake-?out|trap", re.I),
}


def _clean(text: str) -> str:
    t = URL_RE.sub("", text)
    t = t.replace("\u2019", "'").replace("\u2011", "-").replace("\u00a0", " ").replace("&amp;", "&")
    return re.sub(r"[ \t]+", " ", t).strip()


def _price(raw: str, k: str | None) -> float:
    v = float(raw.replace(",", ""))
    return v * 1000 if k else v


def _prices(s: str) -> list[tuple[int, float]]:
    return [(m.start(), _price(m.group(1), m.group(2))) for m in PRICE_RE.finditer(s)]


def _split_clauses(body: str) -> list[str]:
    sents = re.split(r"(?<=[.!?])\s+(?=[A-Z$])|\n+", body)
    out: list[str] = []
    for s in sents:
        parts = re.split(r",\s*(?=[Oo]therwise\b)|;\s*|\s+(?=On the other hand\b)", s)
        out.extend(p.strip() for p in parts if p and p.strip())
    return out


def parse_close_label(text: str) -> tuple[str, int]:
    first = re.split(r"(?<=[.!?])\s+(?=[A-Z$])", text.strip(), maxsplit=1)[0]
    second = text.strip()[len(first):]
    if re.search(r"daily\s+candle\s+was\s+indecisive", text[:300], re.I):
        return "indecisive", 0
    for pat, label, bias in CLOSE_PATTERNS:
        if pat.search(first):
            return label, bias
    for pat, label, bias in CLOSE_PATTERNS[:-4]:  # e.g. "$BTC declined. However, the Daily candle was indecisive"
        if pat.search(second[:200]):
            return label, bias
    if re.search(r"daily\s+candle\s+was\s+indecisive", text, re.I):
        return "indecisive", 0
    return "unknown", 0


def detect_asset(text: str) -> str | None:
    m = HEADER_RE.match(text)
    if not m:
        return None
    return ASSET_ALIASES.get(m.group(1).upper())


def _outcome(after: str) -> tuple[str | None, bool]:
    """Return (side, explicit) from the text after the condition phrase."""
    lw, sw = LONG_WORD.search(after), SHORT_WORD.search(after)
    if lw and (not sw or lw.start() < sw.start()):
        return "long", True
    if sw:
        return "short", True
    fw, uw, dw = FLAT_WORDS.search(after), UP_WORDS.search(after), DOWN_WORDS.search(after)
    hits = [(m.start(), side) for m, side in ((fw, "flat"), (uw, "long"), (dw, "short")) if m]
    if not hits:
        return None, False
    return min(hits)[1], False


def _target(clause: str, after_pos: int, side: str, level: float) -> float | None:
    for m in TARGET_RE.finditer(clause):
        if m.end() - 1 < after_pos:
            continue
        pm = PRICE_RE.match(clause, m.end() - 1)
        if pm:
            t = _price(pm.group(1), pm.group(2))
            if (side == "long" and t > level) or (side == "short" and t < level):
                return t
    return None


def parse_clause(clause: str, prev_level: float | None) -> Scenario | None:
    prices = _prices(clause)
    # --- retest / pullback-then-turn pattern -------------------------------------------
    if RETEST_RE.search(clause) and (RETEST_LONG.search(clause) or RETEST_SHORT.search(clause)):
        lm, sm = RETEST_LONG.search(clause), RETEST_SHORT.search(clause)
        side = "long" if lm and (not sm or lm.start() < sm.start()) else "short"
        level = prices[0][1] if prices else prev_level
        if level is None:
            return None
        if side == "long" and len(prices) >= 2 and prices[1][1] > level:
            target = prices[1][1]
        elif side == "short" and len(prices) >= 2 and prices[1][1] < level:
            target = prices[1][1]
        else:
            target = _target(clause, 0, side, level)
        explicit = bool(LONG_WORD.search(clause) if side == "long" else SHORT_WORD.search(clause))
        return Scenario(side=side, cond="above" if side == "long" else "below", level=level, target=target,
                        kind="retest", explicit=explicit, sentence=clause)

    # --- conditional breakout / hold pattern -------------------------------------------
    ca, cb = COND_ABOVE.search(clause), COND_BELOW.search(clause)
    cands = [(m.start(), m, c) for m, c in ((ca, "above"), (cb, "below")) if m]
    if not cands:
        return None
    _, cm, cond = min(cands, key=lambda x: x[0])
    # A present-tense state ("chart is holding above $X") is not a condition unless an outcome follows
    if not MODAL_RE.search(clause):
        return None  # present-tense description ("closed above $X", "is trading above $X"), not a condition
    lf = LEVEL_FOLLOWS.match(clause, cm.end())
    after_cond = [(pos, p) for pos, p in prices if pos >= cm.end()]
    if lf and after_cond and after_cond[0][0] <= lf.end():
        lvl_pos, level = after_cond[0]
    elif prev_level is not None:
        lvl_pos, level = cm.end() - 1, prev_level  # "Below, ..." / "above that support" -> previous level
    elif prices and prices[0][0] < cm.start():
        lvl_pos, level = cm.end() - 1, prices[-1][1] if prices[-1][0] < cm.start() else prices[0][1]
    elif after_cond:
        lvl_pos, level = after_cond[0]
    else:
        return None
    tail = clause[max(cm.end(), lvl_pos + 1):]
    tail = PRICE_RE.sub(" ", tail)
    tail_wo_level_words = re.sub(r"\b(?:support|resistance)\b", " ", tail, flags=re.I)
    side, explicit = _outcome(tail_wo_level_words)
    if side is None:
        # e.g. "To become bullish, it needs to hold above $12" -> look before the condition too
        side, explicit = _outcome(clause[: cm.start()])
    if side is None:
        # "Holding above will secure our trade and push towards the $1.68 resistance" -> direction from target
        tm = TARGET_RE.search(clause, lvl_pos + 1)
        pm = PRICE_RE.match(clause, tm.end() - 1) if tm else None
        if pm:
            t = _price(pm.group(1), pm.group(2))
            side = "long" if t > level else "short" if t < level else None
    if side is None:
        return None
    if side == "flat":
        return Scenario(side="flat", cond=cond, level=level, kind="sideways", sentence=clause)
    target = _target(clause, lvl_pos + 1, side, level)
    return Scenario(side=side, cond=cond, level=level, target=target, kind="breakout", explicit=explicit, sentence=clause)


def _stated_positions(clause: str) -> list[StatedPosition]:
    out: list[StatedPosition] = []
    for m in STATE_RE.finditer(clause):
        pm = PRICE_RE.match(clause, m.end() - 1)
        if not pm:
            continue
        rel_word = (m.group(2) or "near").lower()
        rel = "above" if rel_word == "above" else "below" if rel_word == "below" else "near"
        out.append(StatedPosition(relation=rel, level=_price(pm.group(1), pm.group(2))))
    return out


def parse_post(post: Post) -> Signal:
    text = _clean(post.text)
    asset = detect_asset(text)
    base = dict(post_id=post.id, post_ts=post.created_at, url=post.url, text=post.text)
    if asset is None:
        status = "unparsed" if "Daily Technical Outlook" in text else "not_outlook"
        return Signal(asset="?", close_label="unknown", parse_status=status, **base)

    body = text.split(":", 1)[1] if ":" in text.split("\n", 1)[0] else text
    label, bias = parse_close_label(body)
    clauses = _split_clauses(body)
    scenarios: list[Scenario] = []
    supports: set[float] = set()
    resistances: set[float] = set()
    stated: list[StatedPosition] = []
    prev_level: float | None = None
    for i, cl in enumerate(clauses):
        if i == 0 and re.search(r"\bclosed\b", cl, re.I) and not _prices(cl):
            continue
        stated.extend(_stated_positions(cl))
        for pos, p in _prices(cl):
            window = cl[pos: pos + 40]
            if SUPPORT_RE.search(window):
                supports.add(p)
            elif RESIST_RE.search(window):
                resistances.add(p)
        sc = parse_clause(cl, prev_level)
        if sc is not None:
            scenarios.append(sc)
            prev_level = sc.level
        elif _prices(cl):
            prev_level = _prices(cl)[-1][1]

    flags = {k: bool(p.search(body)) for k, p in FLAG_PATTERNS.items()}
    directional = [s for s in scenarios if s.side != "flat"]
    explicit = [s for s in directional if s.explicit]
    primary = (explicit or directional or [None])[0]
    all_levels = sorted({s.level for s in scenarios} | supports | resistances | {s.target for s in scenarios if s.target})

    sig = Signal(
        asset=asset, close_label=label, bias=bias,
        parse_status="actionable" if primary else "no_trade",
        scenarios=scenarios, supports=sorted(supports), resistances=sorted(resistances),
        stated_positions=stated, **base,
    )
    if primary is None:
        sig.condition_type = "sideways"
        sig.flags = flags | {"explicit_trade": False, "has_target": False, "has_invalidation": False,
                             "two_sided": False}
        return sig

    sig.direction = primary.side
    sig.trigger = primary.level
    sig.condition_type = primary.kind
    tgt = primary.target
    if tgt is None:
        beyond = [lv for lv in all_levels if (lv > primary.level if primary.side == "long" else lv < primary.level)]
        if beyond:
            tgt = min(beyond) if primary.side == "long" else max(beyond)
    sig.targets = [tgt] if tgt is not None else []
    # invalidation: an opposite-side level on the other side of the trigger, else the trigger itself (close back)
    opp = [lv for lv in all_levels if (lv < primary.level if primary.side == "long" else lv > primary.level)]
    sig.invalidation = (max(opp) if primary.side == "long" else min(opp)) if opp else primary.level
    sides = {s.side for s in directional}
    sig.flags = flags | {
        "explicit_trade": primary.explicit,
        "has_target": bool(sig.targets),
        "has_invalidation": sig.invalidation is not None,
        "invalidation_is_trigger": sig.invalidation == primary.level,
        "two_sided": len(sides) == 2 or any(s.side == "flat" for s in scenarios),
    }
    return sig


def parse_posts(posts: Iterable[Post], assets: Iterable[str] | None = None) -> list[Signal]:
    allowed = set(assets) if assets else None
    out = []
    for p in posts:
        s = parse_post(p)
        if s.parse_status == "not_outlook":
            continue
        if s.asset != "?" and allowed is not None and s.asset not in allowed:
            continue
        if s.asset == "?" and not re.match(r"^\s*\$?(BTC|ETH|XRP|LTC|LINK)\b", p.text, re.I):
            continue  # non-crypto outlooks (EURUSD, XAUUSD, Oil, ...)
        out.append(s)
    return sorted(out, key=lambda s: s.post_ts)
