"""Our own tagging of a video: topic and sub-topic (taxonomy.json), style cues, source format (Short or long-form),
language, exclusions and risk flags. These tags are the topic finder's categorization, never YouTube's categories.

Phrases from every language are matched on accent-folded text, because Spanish and Portuguese titles often use the
English terms ('wallet drainer', 'rug pull')."""

import json
import re

from . import text

FIELD_WEIGHTS = {"title": 3.0, "tags": 2.0, "description": 1.0}
WEAK_FACTOR = 0.5
LANGS = ("en", "es", "pt")
SUBTOPIC_FIELDS = ("label", "concept", "conceptShort", "redFlag", "oneFix", "pov", "titles", "facts", "shortIdeas")
EXCLUDING_CUES = ("attackTutorial",)
# "How I made $50,000 ..." style claims that a phrase list cannot catch (folded title text).
_MONEY = re.compile(r"(?:[$\u20ac\u00a3]\s?\d|\d[\d.,]*\s?(?:k|usd|dollars|dolares|reais|euros)\b)")
_EARN = re.compile(r"\b(?:made|make|making|earn|earned|earning|profit|profits|gane|ganar|gano|ganhei|ganhar|lucrei|lucro)\b")
TITLE_EXCLUDING_CUES = ("priceContent",)


class TaxonomyError(ValueError):
    pass


def _lexicon(spec):
    phrases = []
    if isinstance(spec, dict):
        for lang in LANGS:
            phrases.extend(spec.get(lang) or [])
    elif isinstance(spec, list):
        phrases.extend(spec)
    return text.compile_phrases(phrases)


class Taxonomy:
    def __init__(self, data, channel_formats, security_evergreen=None, source="taxonomy.json"):
        self.source = source
        self.raw = data
        problems = validate(data, channel_formats, security_evergreen)
        if problems:
            raise TaxonomyError("; ".join(problems))
        self.channel_formats = {ch: list(fmts) for ch, fmts in channel_formats.items()}
        self.angle_templates = dict(data["angleTemplates"])
        self.cue_boosts = dict(data.get("cueBoosts") or {})
        self.cues = {name: _lexicon(spec) for name, spec in (data.get("cues") or {}).items()}
        self.topics = []
        for t in data["topics"]:
            topic = dict(t)
            topic["_strong"] = _lexicon((t.get("match") or {}).get("strong"))
            topic["_weak"] = _lexicon((t.get("match") or {}).get("weak"))
            topic["_subs"] = [(dict(s), _lexicon(s.get("match"))) for s in t.get("subtopics") or []]
            self.topics.append(topic)
        self.by_id = {t["id"]: t for t in self.topics}

    @classmethod
    def load(cls, path, channel_formats, security_evergreen=None):
        with open(path, encoding="utf-8") as fh:
            return cls(json.load(fh), channel_formats, security_evergreen, source=path)

    def topic(self, topic_id):
        return self.by_id[topic_id]

    def subtopic(self, topic_id, subtopic_id):
        topic = self.by_id[topic_id]
        if not subtopic_id:
            return topic["general"]
        for sub, _pat in topic["_subs"]:
            if sub["id"] == subtopic_id:
                return sub
        return topic["general"]

    # -- matching ------------------------------------------------------------------------------------------------

    def cue_hits(self, folded_fields):
        joined = " \n ".join(folded_fields.values())
        return {name: sorted(set(text.find_phrases(pat, joined))) for name, pat in self.cues.items()}

    def topic_scores(self, folded_fields):
        scores = []
        for topic in self.topics:
            total, hits = 0.0, set()
            for field, weight in FIELD_WEIGHTS.items():
                blob = folded_fields.get(field, "")
                strong = set(text.find_phrases(topic["_strong"], blob))
                weak = set(text.find_phrases(topic["_weak"], blob)) - strong
                total += weight * len(strong) + weight * WEAK_FACTOR * len(weak)
                hits |= strong | weak
            if total > 0:
                scores.append((total, topic["id"], sorted(hits)))
        order = {t["id"]: i for i, t in enumerate(self.topics)}
        scores.sort(key=lambda s: (-s[0], order[s[1]]))
        return scores

    def best_subtopic(self, topic_id, folded_fields):
        topic = self.by_id[topic_id]
        best = (0.0, None, [])
        for sub, pat in topic["_subs"]:
            total, hits = 0.0, set()
            for field, weight in FIELD_WEIGHTS.items():
                found = set(text.find_phrases(pat, folded_fields.get(field, "")))
                total += weight * len(found)
                hits |= found
            if total > best[0]:
                best = (total, sub["id"], sorted(hits))
        return best[1], best[2]

    def topic_in_text(self, topic_id, raw_text):
        topic = self.by_id.get(topic_id)
        if not topic:
            return False
        folded = text.fold(raw_text)
        return bool(text.find_phrases(topic["_strong"], folded) or text.find_phrases(topic["_weak"], folded))

    def subtopics_in_text(self, topic_id, raw_text):
        """Every sub-topic of a topic that a piece of our own text mentions (for matching existing backlog ideas)."""
        folded = text.fold(raw_text)
        topic = self.by_id.get(topic_id)
        if not topic:
            return set()
        return {sub["id"] for sub, pat in topic["_subs"] if text.find_phrases(pat, folded)}

    def choose_fit(self, topic_id, cues, lang_weight=1.0):
        topic = self.by_id[topic_id]
        options = []
        for f in topic["fits"]:
            if f["format"] not in self.channel_formats.get(f["channel"], []):
                continue
            score = float(f["weight"])
            boosts = []
            for cue, per_format in self.cue_boosts.items():
                if cues.get(cue) and per_format.get(f["format"]):
                    score += float(per_format[f["format"]])
                    boosts.append(cue)
            multiplier = 1.0
            fit_cue = topic.get("fitCue")
            if fit_cue and not cues.get(fit_cue["cue"]):
                multiplier = float(fit_cue["missingMultiplier"])
            options.append({
                "channel": f["channel"],
                "format": f["format"],
                "evergreenTopic": f["evergreenTopic"],
                "fit": round(min(1.0, score) * multiplier * lang_weight, 4),
                "raw": round(score * multiplier, 4),
                "baseWeight": f["weight"],
                "boostedBy": boosts,
                "cueMultiplier": multiplier,
            })
        # Choose on the uncapped score, so a cue that lifts a 0.9 format to 1.05 beats an unboosted 1.0; ties keep
        # the taxonomy's order.
        options.sort(key=lambda o: -o["raw"])
        return options


def detect_format(duration, width, height, fmt_cfg):
    """('short'|'long', assumed: bool, aspect: 'vertical'|'square'|'horizontal'|None)."""
    short_max = fmt_cfg.get("shortMaxSeconds", 180)
    bare_max = fmt_cfg.get("shortWithoutAspectMaxSeconds", 60)
    aspect = None
    if width and height and width > 0 and height > 0:
        if height > width * 1.05:
            aspect = "vertical"
        elif abs(height - width) <= width * 0.05:
            aspect = "square"
        else:
            aspect = "horizontal"
    if not duration:  # unknown, or P0D (a live or scheduled broadcast without a final length)
        return "long", True, aspect
    if aspect:
        return ("short" if duration <= short_max and aspect in ("vertical", "square") else "long"), False, aspect
    if duration <= bare_max:
        return "short", False, None
    return "long", duration <= short_max, None


def detect_language(video, query_lang=None):
    for field in ("defaultAudioLanguage", "defaultLanguage"):
        code = text.language_from_code(video.get(field))
        if code:
            return code, field
    guess = text.guess_language(f"{video.get('title', '')} {(video.get('description') or '')[:300]}")
    if guess:
        return guess, "text"
    return query_lang, "query"


def folded_fields(video):
    return {
        "title": text.fold(video.get("title") or ""),
        "tags": text.fold(" | ".join(video.get("tags") or [])),
        "description": text.fold((video.get("description") or "")[:600]),
    }


STYLE_CUES = ("story", "news", "scamPattern", "explainer", "howTo", "priceContent")
# Attack tutorials phrase things freely ("how to build a wallet drainer", "como criar seu proprio drainer"), so
# besides the lexicon a few words may sit between the verb and the object.
_ATTACK = re.compile(
    r"\b(?:how to|como|tutorial(?: de| para)?)\s+(?:build|make|create|deploy|code|write|set ?up|setup|run|crear|hacer|montar|programar|criar|fazer)"
    r"(?:\W+\w+){0,3}?\W+(?:drainer|drainers|wallet drainer|phishing (?:kit|page|site)|malware|stealer|infostealer)\b"
    r"|\b(?:how to|como)\s+(?:hack|steal|drain|hackear|robar|roubar|drenar|vaciar|esvaziar)\b(?:\W+\w+){0,3}?\W+(?:wallet|wallets|crypto|cripto|billetera|carteira|exchange|account|cuenta|conta|seed|metamask)\w*"
)


def classify_video(video, taxonomy, fmt_cfg, query_lang=None):
    """Style cues (story, news, scam pattern, explainer, how-to, price talk) come from the title only, because
    descriptions and SEO tags mention everything. Attack tutorials and content cues (crypto, security, income
    claims) are read from every field: excluding a defensive video by mistake costs less than taking inspiration
    from an attack tutorial."""
    fields = folded_fields(video)
    all_cues = taxonomy.cue_hits(fields)
    title_cues = taxonomy.cue_hits({"title": fields["title"]})
    cues = {name: (title_cues.get(name, []) if name in STYLE_CUES else hits) for name, hits in all_cues.items()}
    fmt, assumed, aspect = detect_format(video.get("durationSec"), video.get("embedWidth"), video.get("embedHeight"), fmt_cfg)
    lang, lang_source = detect_language(video, query_lang)
    out = {
        "topic": None, "topicScore": 0.0, "topicHits": [], "otherTopics": [],
        "subtopic": None, "subtopicHits": [],
        "cues": {k: v for k, v in cues.items() if v},
        "flags": [], "exclude": None,
        "format": fmt, "formatAssumed": assumed, "aspect": aspect,
        "lang": lang, "langSource": lang_source,
    }
    for cue in EXCLUDING_CUES:
        if cues.get(cue):
            out["exclude"] = "attack-tutorial"
    if not out["exclude"] and any(_ATTACK.search(fields[f]) for f in ("title", "tags", "description")):
        out["exclude"] = "attack-tutorial"
    for cue in TITLE_EXCLUDING_CUES:
        if title_cues.get(cue) and not out["exclude"]:
            out["exclude"] = "price-content"
    if cues.get("incomeClaim") or (_MONEY.search(fields["title"]) and _EARN.search(fields["title"])):
        out["flags"].append("income-claims")
    if cues.get("howTo"):
        out["flags"].append("how-to")
    scores = taxonomy.topic_scores(fields)
    if not scores:
        out["exclude"] = out["exclude"] or "off-niche"
        return out
    total, topic_id, hits = scores[0]
    out.update({"topic": topic_id, "topicScore": round(total, 2), "topicHits": hits, "otherTopics": [s[1] for s in scores[1:4]]})
    sub_id, sub_hits = taxonomy.best_subtopic(topic_id, fields)
    out["subtopic"], out["subtopicHits"] = sub_id, sub_hits
    return out


def validate(data, channel_formats, security_evergreen=None):
    """Problems with taxonomy.json, so an editing slip fails loudly instead of producing broken pitches."""
    problems = []
    if not isinstance(data, dict) or data.get("version") != 1:
        return ["taxonomy.json: expected {\"version\": 1, ...}"]
    templates = data.get("angleTemplates") or {}
    for ch, fmts in channel_formats.items():
        for fmt in fmts:
            if f"{ch}/{fmt}" not in templates:
                problems.append(f"angleTemplates has no template for {ch}/{fmt}")
    topics = data.get("topics")
    if not isinstance(topics, list) or not topics:
        return problems + ["topics must be a non-empty list"]
    seen = set()
    for t in topics:
        tid = t.get("id")
        if not isinstance(tid, str) or not tid or tid in seen:
            problems.append(f"topic id {tid!r} is missing or repeated")
            continue
        seen.add(tid)
        strong = ((t.get("match") or {}).get("strong") or {})
        if not any(strong.get(lang) for lang in LANGS):
            problems.append(f"{tid}: match.strong needs phrases")
        fits = t.get("fits") or []
        if not fits:
            problems.append(f"{tid}: fits must name at least one channel and format")
        for f in fits:
            ch, fmt = f.get("channel"), f.get("format")
            if ch not in channel_formats or fmt not in channel_formats[ch]:
                problems.append(f"{tid}: fit {ch}/{fmt} is not a known channel format")
                continue
            if not isinstance(f.get("weight"), (int, float)) or not 0 < f["weight"] <= 1:
                problems.append(f"{tid}: fit {ch}/{fmt} weight must be in (0, 1]")
            if not isinstance(f.get("evergreenTopic"), str) or not f["evergreenTopic"]:
                problems.append(f"{tid}: fit {ch}/{fmt} needs an evergreenTopic")
            elif ch == "zoora-security" and security_evergreen and f["evergreenTopic"] not in security_evergreen:
                problems.append(f"{tid}: evergreenTopic {f['evergreenTopic']!r} is not in content/zoora-security/channel.json evergreen")
        if not t.get("risks"):
            problems.append(f"{tid}: risks must list at least one risk")
        blocks = [("general", t.get("general") or {})] + [(s.get("id", "?"), s) for s in t.get("subtopics") or []]
        sub_ids = set()
        for name, block in blocks:
            if name != "general":
                if name in sub_ids or not isinstance(name, str):
                    problems.append(f"{tid}: sub-topic id {name!r} repeated")
                sub_ids.add(name)
                if not any((block.get("match") or {}).get(lang) for lang in LANGS):
                    problems.append(f"{tid}/{name}: match needs phrases")
            for field in SUBTOPIC_FIELDS:
                if not block.get(field):
                    problems.append(f"{tid}/{name}: {field} is missing")
            titles = block.get("titles") or {}
            for f in fits:
                if f.get("format") in (channel_formats.get(f.get("channel")) or []):
                    options = titles.get(f["format"]) or (t.get("general") or {}).get("titles", {}).get(f["format"])
                    if not options:
                        problems.append(f"{tid}/{name}: no title for format {f['format']}")
            for fmt, options in titles.items():
                for title in options:
                    if not title or len(title) > 100 or "<" in title or ">" in title:
                        problems.append(f"{tid}/{name}: title {title!r} must be 1-100 characters with no < or >")
    return problems
