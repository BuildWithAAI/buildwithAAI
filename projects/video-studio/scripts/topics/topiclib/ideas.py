"""From scored outlier videos to ranked ideas: group by (channel, format, topic, sub-topic), pitch each one in our own
words, guard against copying, list the facts to verify and the risks, and match the channel backlogs.

Every pitch is assembled from taxonomy.json and our show formats. A source video contributes only evidence of
demand (why it is an outlier), never its title, script, structure or thumbnail; the copy guard checks that our
working title and angle share no long word run and little vocabulary with any source title."""

import re

from . import text

FORMAT_PREFIX = {"explainer": "explainer", "scam-of-the-week": "sotw", "pov-story": "pov"}
FORMAT_LABEL = {"explainer": "explainer", "scam-of-the-week": "Scam of the Week", "pov-story": "POV story"}
CHANNEL_NAMES = {"zoora-ai": "Zoora AI", "zoora-security": "Zoodger News"}
LANG_NAMES = {"en": "English", "es": "Spanish", "pt": "Portuguese"}
TITLE_MAX_JACCARD = 0.5
TITLE_MAX_RUN = 3  # a run of 4+ shared content words fails
ANGLE_MAX_RUN = 4  # a run of 5+ shared content words fails
_INCIDENT = re.compile(r"(\$\s?\d|\d[\d.,]*\s?(?:million|billion|millones|mil millones|milhoes|milhões|bilhoes|bilhões|\bm\b|\bk\b)|\bhack(?:ed)?\b|\bexploit(?:ed)?\b)", re.I)


def copy_check(ours, source_titles, max_jaccard=TITLE_MAX_JACCARD, max_run=TITLE_MAX_RUN):
    worst_j, worst_run = 0.0, 0
    for title in source_titles:
        worst_j = max(worst_j, text.jaccard(ours, title))
        worst_run = max(worst_run, text.longest_shared_run(ours, title))
    return {"ok": worst_j <= max_jaccard and worst_run <= max_run, "maxJaccard": round(worst_j, 3), "maxRun": worst_run}


def _fill(template, block):
    values = {k: block.get(k, "") for k in ("label", "concept", "conceptShort", "redFlag", "oneFix", "pov")}
    return template.format(**values)


class IdeaBuilder:
    def __init__(self, taxonomy, config, backlogs=None, evergreen=None, channel_names=None):
        self.tax = taxonomy
        self.cfg = config
        self.backlogs = backlogs or {}
        self.evergreen = evergreen or {}
        self.channel_names = dict(CHANNEL_NAMES)
        self.channel_names.update(channel_names or {})
        scoring = config.get("scoring", {})
        self.bonus_per_channel = scoring.get("breadthBonusPerChannel", 3)
        self.bonus_max = scoring.get("breadthBonusMax", 9)
        self.dubs = list(config.get("output", {}).get("dubs", ["es", "pt-br"]))

    # -- grouping ------------------------------------------------------------------------------------------------

    def build(self, candidates):
        groups = {}
        for c in candidates:
            fit = c.get("fit")
            if not fit or not c.get("topic"):
                continue
            key = (fit["channel"], fit["format"], c["topic"], c.get("subtopic") or "general")
            groups.setdefault(key, []).append(c)
        ideas = []
        taken = self._existing_slugs()
        for key in sorted(groups):
            evidence = sorted(groups[key], key=lambda c: (-c["score"], -(c.get("views") or 0), c["videoId"]))
            ideas.append(self._idea(key, evidence))
        ideas.sort(key=lambda i: (-i["score"], -(i["evidence"][0].get("views") or 0), i["key"]))
        rank = 0
        for idea in ideas:
            idea["id"] = self._unique_id(idea, taken)
            taken.add(idea["id"])
            if idea["backlog"]["status"] != "duplicate":
                rank += 1
                idea["rank"] = rank  # duplicates of existing backlog ideas are reported as evidence, not ranked
        return ideas

    def _existing_slugs(self):
        slugs = set()
        for data in self.backlogs.values():
            for x in (data or {}).get("ideas", []) if isinstance(data, dict) else []:
                for k in ("id", "slug"):
                    if isinstance(x.get(k), str):
                        slugs.add(x[k])
        return slugs

    @staticmethod
    def _unique_id(idea, taken):
        channel, fmt, topic, sub = idea["key"]
        base = text.slugify(f"{FORMAT_PREFIX.get(fmt, fmt)}-{sub if sub != 'general' else topic}", 60)
        candidate, n = base, 1
        while candidate in taken:
            n += 1
            candidate = f"{base}-tf{n if n > 2 else ''}".rstrip("-")
        return candidate

    # -- one idea ------------------------------------------------------------------------------------------------

    def _idea(self, key, evidence):
        channel, fmt, topic_id, sub_id = key
        topic = self.tax.topic(topic_id)
        block = self.tax.subtopic(topic_id, None if sub_id == "general" else sub_id)
        general = topic["general"]
        top = evidence[0]
        channels = {e["channelId"] for e in evidence}
        bonus = min(self.bonus_max, self.bonus_per_channel * (len(channels) - 1))
        score = round(min(100.0, top["score"] + bonus), 1)
        source_titles = [e["title"] for e in evidence]
        title, title_check, options = self._title(block, general, fmt, source_titles)
        template = self.tax.angle_templates[f"{channel}/{fmt}"]
        angle = _fill(template, block)
        angle_check = copy_check(angle, source_titles, max_jaccard=1.0, max_run=ANGLE_MAX_RUN)
        evergreen = top["fit"]["evergreenTopic"]
        langs = sorted({e["lang"] for e in evidence if e.get("lang")})
        flags = sorted({f for e in evidence for f in e.get("flags", [])})
        source_flags = sorted({f for e in evidence for f in e.get("classification", {}).get("flags", [])})
        idea = {
            "key": key,
            "rank": None,
            "id": None,
            "channel": channel,
            "channelName": self.channel_names.get(channel, channel),
            "format": fmt,
            "formatLabel": FORMAT_LABEL.get(fmt, fmt),
            "topic": topic_id,
            "topicLabel": topic["label"],
            "subtopic": None if sub_id == "general" else sub_id,
            "label": block.get("label") or topic["label"],
            "evergreenTopic": evergreen,
            "score": score,
            "breadthBonus": bonus,
            "evidenceChannels": len(channels),
            "evidence": evidence,
            "pitch": {
                "workingTitle": title,
                "titleOptions": options,
                "angle": angle,
                "shortIdeas": list(dict.fromkeys((block.get("shortIdeas") or []) + (general.get("shortIdeas") or [])))[:4],
                "redFlag": block.get("redFlag"),
                "oneFix": block.get("oneFix"),
            },
            "copyGuard": {"title": title_check, "angle": angle_check},
            "facts": self._facts(topic, block, general, evidence),
            "risks": self._risks(topic, source_flags),
            "languages": langs,
            "flags": flags,
            "sourceFlags": source_flags,
            "fit": self._fit(top, channel, fmt, evergreen),
            "tags": self._tags(channel, fmt, topic_id, sub_id, evergreen, evidence),
        }
        idea["backlog"] = self._backlog_match(idea)
        return idea

    def _title(self, block, general, fmt, source_titles):
        options = list(dict.fromkeys((block.get("titles") or {}).get(fmt, []) + (general.get("titles") or {}).get(fmt, [])))
        checked = [(t, copy_check(t, source_titles)) for t in options]
        for t, check in checked:
            if check["ok"]:
                return t, check, options
        best = min(checked, key=lambda tc: (tc[1]["maxRun"], tc[1]["maxJaccard"]))
        return best[0], dict(best[1], ok=False, note="every title option is too close to a source title: rewrite it"), options

    def _facts(self, topic, block, general, evidence):
        needs = list(block.get("facts") or [])
        if block is not general:
            needs += [f for f in general.get("facts") or [] if f not in needs][:1]
        needs += [f for f in topic.get("facts") or [] if f not in needs]
        needs.append(f"Primary sources for every claim the script makes about {block.get('label') or topic['label']} (the outlier videos behind this idea are leads, never sources)")
        if any(_INCIDENT.search(f"{e.get('title', '')} {(e.get('description') or '')[:300]}") for e in evidence):
            needs.append("If the story rests on a specific incident: its primary report (official post-mortem, regulator or law-enforcement release) and the loss exactly as that source states it")
        for lang, name in (("es", "Spanish"), ("pt", "Portuguese")):
            if any(e.get("lang") == lang for e in evidence):
                needs.append(f"A {name}-language regulator or police warning on this pattern, for the {lang if lang == 'es' else 'pt-br'} dub's description (optional)")
        return needs

    @staticmethod
    def _risks(topic, source_flags):
        risks = list(topic.get("risks") or [])
        if "income-claims" in source_flags:
            risks.append("A source video makes income or profit claims: never repeat them; ours is the cautionary side (no income claims, no buy calls).")
        if "how-to" in source_flags:
            risks.append("A source video is a how-to: ours stays at concept level (no steps, code or tool names).")
        risks.append("Original work only: never reuse a source video's title, thumbnail, script, structure or footage (YouTube's reused-content and inauthentic-content policies).")
        return risks

    def _fit(self, top, channel, fmt, evergreen):
        fit = top["fit"]
        reasons = [f"taxonomy weight {fit['baseWeight']}"]
        if fit.get("boostedBy"):
            reasons.append("cues: " + ", ".join(fit["boostedBy"]))
        if fit.get("cueMultiplier", 1.0) != 1.0:
            reasons.append(f"x{fit['cueMultiplier']} (no crypto context in the source)")
        lang = top.get("lang")
        lang_weight = self.cfg.get("languages", {}).get(lang, {}).get("weight") if lang else None
        if lang_weight and lang_weight != 1.0:
            reasons.append(f"x{lang_weight} ({LANG_NAMES.get(lang, lang)} source)")
        planned = (self.evergreen.get(channel) or {}).get(evergreen) if isinstance(self.evergreen.get(channel), dict) else None
        out = {
            "channel": channel,
            "channelName": self.channel_names.get(channel, channel),
            "format": fmt,
            "evergreenTopic": evergreen,
            "fit": fit["fit"],
            "reasons": reasons,
            "alternatives": [f"{self.channel_names.get(o['channel'], o['channel'])} {FORMAT_LABEL.get(o['format'], o['format'])} ({o['fit']:.2f})" for o in top.get("fitOptions", [])[1:3]],
        }
        if isinstance(planned, dict) and planned.get("title"):
            out["evergreenPlanned"] = {"title": planned["title"], "status": planned.get("status"), "url": planned.get("url")}
        return out

    @staticmethod
    def _tags(channel, fmt, topic_id, sub_id, evergreen, evidence):
        tags = [f"channel:{channel}", f"format:{fmt}", f"topic:{topic_id}", f"evergreen:{evergreen}"]
        if sub_id != "general":
            tags.append(f"subtopic:{sub_id}")
        tags += sorted({f"lang:{e['lang']}" for e in evidence if e.get("lang")})
        tags += sorted({f"source-format:{e['format']}" for e in evidence})
        tags += sorted({f"cue:{cue}" for e in evidence for cue in e.get("classification", {}).get("cues", {}) if cue in ("story", "news", "scamPattern", "explainer")})
        return tags

    # -- backlog matching ----------------------------------------------------------------------------------------

    def _backlog_match(self, idea):
        """duplicate: same channel, format and evergreen topic, and the existing idea's title or factTags cover the
        same sub-topic (or none, for a general idea). related: same channel and evergreen bucket, or the same
        sub-topic in the other channel. Titles and factTags are used for scope, not angles, because broad ideas
        mention many sub-topics in passing."""
        matches = []
        topic_id, sub, evergreen = idea["topic"], idea["subtopic"], idea["evergreenTopic"]
        sub_ids = {s["id"] for s in self.tax.topic(topic_id).get("subtopics", [])}
        for channel, data in sorted(self.backlogs.items()):
            if not isinstance(data, dict):
                continue
            for x in data.get("ideas", []):
                if not isinstance(x, dict) or x.get("status", "idea") == "dropped":
                    continue
                tags = [t for t in x.get("factTags", []) if isinstance(t, str)]
                scope_text = " ".join([str(x.get("title", "")), " ".join(tags)])
                full_text = " ".join([scope_text, str(x.get("angle", ""))])
                same_evergreen = x.get("evergreenTopic") == evergreen
                if not same_evergreen and not self.tax.topic_in_text(topic_id, full_text):
                    continue
                subs = self.tax.subtopics_in_text(topic_id, scope_text) | (set(tags) & sub_ids)
                on_topic = topic_id == x.get("evergreenTopic") or self.tax.topic_in_text(topic_id, scope_text)
                same_scope = on_topic and ((sub in subs) if sub else not subs)
                if channel == idea["channel"] and x.get("format") == idea["format"] and same_evergreen and same_scope:
                    relation = "duplicate"
                elif (channel == idea["channel"] and same_evergreen) or same_scope:
                    relation = "related"
                else:
                    continue
                matches.append({"channel": channel, "id": x.get("id"), "title": x.get("title"), "format": x.get("format"), "priority": x.get("priority"), "status": x.get("status", "idea"), "relation": relation})
        order = {"duplicate": 0, "related": 1}
        matches.sort(key=lambda m: (order[m["relation"]], m["channel"] != idea["channel"], m.get("priority") or 999, str(m["id"])))
        status = "duplicate" if any(m["relation"] == "duplicate" for m in matches) else ("related" if matches else "new")
        return {"status": status, "matches": matches[:4], "checked": sorted(c for c, d in self.backlogs.items() if isinstance(d, dict))}
