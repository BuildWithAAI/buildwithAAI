"""Markdown brief for the owner. All source text is escaped (it is untrusted)."""

import re

from .classify import TYPE_LABEL
from .textutil import format_usd, format_usd_exact

_MD_SPECIAL = re.compile(r"([\\`*_\[\]<>|#])")


def md(text):
    """Escape untrusted text for inline Markdown (tables, lists)."""
    text = (text or "").replace("\r", " ").replace("\n", " ")
    return _MD_SPECIAL.sub(r"\\\1", text)


def md_url(url):
    if not url or not re.match(r"^https?://", url):
        return None
    return url.replace(" ", "%20").replace("(", "%28").replace(")", "%29").replace("<", "%3C").replace(">", "%3E")


def link(text, url):
    safe = md_url(url)
    return f"[{md(text)}]({safe})" if safe else md(text)


def source_link(entry, text=None, names=None):
    """A source's headline linked to its article, or, when the article's link names a person and is withheld, the
    headline and the outlet without a link."""
    text = entry.get("title") if text is None else text
    if entry.get("urlWithheld"):
        who = (names or {}).get(entry.get("id") or entry.get("sourceId"), entry.get("publisher") or entry.get("sourceId") or "")
        return f"{md(text)} ({md(who)}; link withheld: it names a person)"
    return link(text, entry.get("url"))


def losses_line(incident, names):
    if not incident["reportedLosses"]:
        return "none stated"
    parts = []
    for entry in sorted(incident["reportedLosses"], key=lambda e: ("ABC".index(e.get("tier", "C")), -e["amountUsd"])):
        parts.append(f"{format_usd_exact(entry['amountUsd'])} reported by {md(names.get(entry['by'], entry['by']))}")
    return "; ".join(parts)


def _date_cell(incident):
    if incident.get("dateUtc"):
        return incident["dateUtc"]
    return f"not stated (first seen {incident.get('firstSeenUtc') or 'unknown'})"


def _mechanism_line(incident):
    status = incident.get("mechanismStatus") or ("stated" if incident.get("mechanismKnown") else "unknown")
    note = incident.get("mechanismNote") or {}
    who = f", per {md(note.get('publisher') or note.get('sourceId') or '')}" if note.get("publisher") or note.get("sourceId") else ""
    if status == "stated":
        return "stated by a source" + who
    text = f": \"{md(note['text'])}\"" if note.get("text") else ""
    return f"{status}{who}{text}. Say it only with that qualifier and attribution"


def _when(source):
    return (source.get("publishedUtc") or source.get("eventDate") or source.get("listedUtc") or "")[:16].replace("T", " ")


def _incidents(doc):
    return {inc["id"]: inc for inc in doc["top"] + doc["alsoSeen"]}


def _lane_leaders(doc):
    """The lanes' best incidents that are not in the overall top 5, as (lane, rank in its lane, incident): the human
    brief shows each in full, so neither lane's best can be cut to one "Also seen" row by the other lane's scores."""
    top_ids = {inc["id"] for inc in doc["top"]}
    incidents = _incidents(doc)
    out, shown = [], set()
    for lane in ("crypto", "ai"):
        for rank, iid in enumerate((doc.get("laneTop") or {}).get(lane) or [], 1):
            if iid in top_ids or iid in shown or iid not in incidents:
                continue
            shown.add(iid)
            out.append((lane, rank, incidents[iid]))
    return out


def _ai_lane_section(doc, names):
    """The AI-security lane's best incidents (top 5 by score), whether or not they made the overall top 5."""
    ids = (doc.get("laneTop") or {}).get("ai") or []
    if "laneTop" not in doc:
        return []
    out = ["## AI security lane", ""]
    if not ids:
        out += ["No AI-security incident in the fresh window.", ""]
        return out
    by_id = {inc["id"]: (group, rank) for group in ("top", "alsoSeen") for rank, inc in enumerate(doc[group], 1)}
    incidents = _incidents(doc)
    out.append("| Score | Incident | Lane | Status | Type | Harm or loss | Sources | In the brief |")
    out.append("| --- | --- | --- | --- | --- | --- | --- | --- |")
    for iid in ids:
        inc = incidents.get(iid)
        if inc is None:
            continue
        group, rank = by_id[iid]
        where = f"top 5, #{rank}" if group == "top" else "also seen (in full below)"
        sources = ", ".join(sorted({f"{names.get(s['id'], s['id'])} ({s['tier']})" for s in inc["sources"]}))
        harm = inc["score"]["factors"]["loss"]["reason"]
        out.append(f"| {inc['score']['total']} | {md(inc['title'])} | {inc.get('lane', 'crypto')} | {inc['status']} | "
                   f"{md(TYPE_LABEL.get(inc['type'], inc['type']))} | {md(harm)} | {md(sources)} | {where} |")
    out.append("")
    return out


def _incident_block(inc, heading, names):
    out = []
    status = inc["status"].upper()
    # the status is the incident's, never the mechanism's: the title carries the mechanism's own hedge
    out.append(f"### {heading}. {md(inc['title'])} · incident {status} · score {inc['score']['total']} · lane {inc.get('lane', 'crypto')}")
    out.append("")
    out.append(f"- **Incident date (UTC):** {_date_cell(inc)} | **Type:** {md(TYPE_LABEL[inc['type']])} | "
               f"**Chains:** {md(', '.join(inc['chains']) or 'not stated')} | "
               f"**Explainer link:** {md(inc['evergreenTopic'] or 'none')}")
    out.append(f"- **Reported losses:** {losses_line(inc, names)}")
    out.append(f"- **Incident status:** {inc['status']} ({md(inc['statusReason'])})")
    out.append(f"- **Mechanism:** {_mechanism_line(inc)}")
    if inc.get("userSide"):
        out.append("- **User-side:** yes: users' own wallets or keys; do not imply the protocol or vendor was breached")
    if inc.get("dateNote"):
        out.append(f"- **Date note:** {md(inc['dateNote'])}")
    if inc.get("postMortemUrl"):
        out.append(f"- **Post-mortem:** {link(inc['postMortemUrl'], inc['postMortemUrl'])}")
    short = inc["shortReady"]
    out.append("- **Sourcing for a daily Short:** " + ("sufficient (analysis still to be judged)" if short["ready"]
                                                       else "not yet: " + md("; ".join(short["missing"]))))
    factors = inc["score"]["factors"]
    out.append("- **Score:** " + " | ".join(f"{name} {f['points']}/{f['weight']}" for name, f in factors.items()))
    for name, factor in factors.items():
        out.append(f"  - {name}: {md(factor['reason'])}")
    if inc["facts"]:
        out.append("- **What the sources say (attributed):**")
        for fact in inc["facts"]:
            if fact["field"] == "title":
                out.append(f"  - {md(fact['text'])} \"{md(fact['quote'])}\"")
            else:
                out.append(f"  - {md(fact['text'])}")
    for note in inc["notes"]:
        out.append(f"- Note: {md(note)}")
    out.append("")
    out.append("| Tier | Source | Date (UTC) | Item |")
    out.append("| --- | --- | --- | --- |")
    for src in inc["sources"]:
        marks = []
        if src.get("hedge"):
            marks.append(f"hedged: {md(src['hedge'])}")
        if src.get("tracker"):
            marks.append("incident database: never confirms alone")
        if src.get("confirmsAlone") is False:
            marks.append("one researcher's blog: never confirms alone")
        if src.get("unverified"):
            marks.append("unverified: cites only an X post")
        if src.get("roundup"):
            marks.append("round-up: not counted")
        if src.get("listedReport"):
            marks.append("listed report: discovery only, read the original")
        if src.get("hiddenCharacters"):
            marks.append("hidden characters removed")
        if src.get("carried"):
            marks.append(f"carried over from the {md(src.get('carriedFrom') or 'previous')} radar")
        extra = f" ({'; '.join(marks)})" if marks else ""
        out.append(f"| {src['tier']} | {md(names.get(src['id'], src['id']))} | {_when(src)} | {source_link(src, names=names)}{extra} |")
    out.append("")
    out.append("<details><summary>Excerpts (at most 280 characters each)</summary>")
    out.append("")
    for src in inc["sources"]:
        if src.get("excerpt"):
            out.append(f"- {md(names.get(src['id'], src['id']))}: {md(src['excerpt'])}")
    out.append("")
    out.append("</details>")
    out.append("")
    return out


def render_markdown(doc):
    names = {s["id"]: s["name"] for s in doc["sources"]}
    out = []
    window = doc["window"]
    out.append(f"# Security radar: {doc['runDate']}")
    out.append("")
    ok = sum(1 for s in doc["sources"] if s["status"] in ("ok", "cached", "not-modified"))
    out.append(
        f"Generated {doc['generatedUtc']} ({doc['mode']} run). Fresh window {window['freshFrom']} to "
        f"{window['freshTo']} (UTC). {ok} of {len(doc['sources'])} sources read; "
        f"{doc['counts']['candidates']} candidate incident(s), {doc['counts']['unclustered']} unclustered item(s)."
    )
    out.append("")
    for warning in doc.get("warnings") or []:
        out.append(f"> **Warning:** {md(warning)}")
        out.append("")
    out.append(
        "> Research draft for the script writer and the claim gate, not a script. Figures are "
        "\"reported by\" a named source and are never averaged. Status \"developing\" must stay on "
        "screen and in the script. No individuals are named (names in source text are redacted, and a link "
        "whose address spells a name is withheld) and mechanisms stay at concept level. No price or investment talk."
    )
    out.append("")
    leaders = _lane_leaders(doc)
    checked = list(doc["top"]) + [inc for _, _, inc in leaders]
    ready = [i for i in checked if i["shortReady"]["ready"]]
    out.append(
        f"**Sourcing check:** {len(ready)} of {len(checked)} top candidates (the top 5 and each lane's best) are sourced "
        "well enough for a daily Short (confirmed, 2+ independent publishers, a mechanism a source states, a strong "
        "explainer link). This is not the analysis check: owner rule, no daily Short unless it adds real analysis, "
        "which the daily system and the owner judge later."
    )
    out.append("")
    by_lane = doc["counts"].get("candidatesByLane") or {}
    if by_lane:
        out.append(f"**Lanes:** {by_lane.get('crypto', 0)} crypto, {by_lane.get('ai', 0)} AI and {by_lane.get('both', 0)} "
                   "crypto + AI candidate incident(s). AI-security incidents are scored on concrete harm when no "
                   "source states a dollar figure (exploited in real attacks, users or data affected, a fix or "
                   "advisory shipped).")
        out.append("")
    if doc.get("corrections"):
        out.append("## Correction candidates (pin if already published)")
        out.append("")
        for corr in doc["corrections"]:
            out.append(f"- **{md(corr['protocol'])}** (radar {corr['previousRadarDate']}): " + "; ".join(md(c) for c in corr["changes"]))
        out.append("")
    out.append("## Top 5")
    out.append("")
    if not doc["top"]:
        out.append("No candidate incidents in the fresh window.")
        out.append("")
    for rank, inc in enumerate(doc["top"], 1):
        out.extend(_incident_block(inc, str(rank), names))
    if leaders:
        out.append("## Each lane's best beyond the top 5")
        out.append("")
        for lane, rank, inc in leaders:
            out.extend(_incident_block(inc, f"{'AI' if lane == 'ai' else 'crypto'} lane #{rank}", names))
    out.extend(_ai_lane_section(doc, names))
    out.append("## Also seen")
    out.append("")
    if doc["alsoSeen"]:
        out.append("| Score | Incident | Lane | Status | Date | Reported losses | Sources |")
        out.append("| --- | --- | --- | --- | --- | --- | --- |")
        for inc in doc["alsoSeen"]:
            ids = sorted({names.get(s["id"], s["id"]) for s in inc["sources"]})
            figures = ", ".join(sorted({format_usd(e["amountUsd"]) + " (" + names.get(e["by"], e["by"]) + ")" for e in inc["reportedLosses"]})) or "none stated"
            out.append(f"| {inc['score']['total']} | {md(inc['title'])} | {inc.get('lane', 'crypto')} | {inc['status']} | {_date_cell(inc)} | {md(figures)} | {md(', '.join(ids))} |")
    else:
        out.append("Nothing else in the window.")
    out.append("")
    if doc.get("listedOnly"):
        out.append("## Listed by an incident database only (leads, never candidates)")
        out.append("")
        out.append("The AI Incident Database adds other outlets' reports to its list; the date below is when it listed "
                   "them, not when they were published. Read each original report before using anything.")
        out.append("")
        for entry in doc["listedOnly"]:
            links = "; ".join(source_link(s, names=names) for s in entry["sources"][:4])
            note = f" {md(entry['dateNote'])}." if entry.get("dateNote") else ""
            out.append(f"- {md(entry['title'])} (listed {entry['listedUtc']}, lane {entry['lane']}):{note} {links}")
        out.append("")
    if doc.get("ownerReview"):
        out.append("## Held back for the owner (words withheld)")
        out.append("")
        out.append("The AI lane holds back sexual-abuse and intimate-image stories: no title, excerpt or link of theirs "
                   "is in this brief, and none is a candidate, a Short or a Threat Brief item. The owner decides; the "
                   "full links are in the gitignored withheld-links cache.")
        out.append("")
        for entry in doc["ownerReview"]:
            kind = TYPE_LABEL.get(entry.get("suggestedType") or "", "")
            typed = f"; suggested type: {md(kind)}" if kind else ""
            record = f"; database record {link(entry['trackerUrl'], entry['trackerUrl'])}" if entry.get("trackerUrl") else ""
            ref = f"; link ref {md(entry['urlRef'])}" if entry.get("urlRef") else ""
            out.append(f"- {md(names.get(entry['sourceId'], entry.get('publisher') or entry['sourceId']))} (tier "
                       f"{entry['tier']}, lane {entry['lane']}, {entry.get('dateFrom') or 'dated'} "
                       f"{entry.get('date') or 'unknown'}): {md(entry['reason'])}{typed}{record}{ref}")
        out.append("")
    out.append("## Unclustered security items")
    out.append("")
    if doc["unclustered"]:
        for item in doc["unclustered"]:
            when = (item.get("publishedUtc") or "")[:10] or (f"listed {item['listedUtc'][:10]}" if item.get("listedUtc") else "")
            out.append(f"- {source_link(item, names=names)} ({md(names.get(item['sourceId'], item['sourceId']))}, "
                       f"tier {item['tier']}, lane {item.get('lane', 'crypto')}, {when}): {md(item['reason'])}")
    else:
        out.append("None.")
    out.append("")
    out.append("## Source health")
    out.append("")
    out.append("| Source | Tier | Lane | Result | Items | Security-relevant | Note |")
    out.append("| --- | --- | --- | --- | --- | --- | --- |")
    for src in doc["sources"]:
        notes = list(src.get("warnings", [])[:3])
        if src.get("heldForOwner"):
            reasons = src.get("heldForOwnerReasons") or {}
            why = "; ".join(f"{reason} ({n})" for reason, n in reasons.items()) or "sexual-abuse or intimate-image story"
            notes.append(f"{src['heldForOwner']} item(s) held back for the owner, words withheld: {why}")
        note = "; ".join(notes)
        out.append(f"| {md(src['name'])} | {src['tier']} | {src.get('lane', 'crypto')} | {src['status']} | {src['items']} | {src['relevant']} | {md(note)} |")
    out.append("")
    out.append("## Method")
    out.append("")
    weights = doc["scoring"]["weights"]
    out.append("Score = " + " + ".join(f"{k} x {v}" for k, v in weights.items())
               + " (each factor 0 to 1, reasons above). Confirmed = an unhedged tier-A primary statement "
                 "(the project, a post-mortem, a security firm or a law-enforcement release), a project statement "
                 "relayed by an unhedged tier-B outlet (\"the protocol said\", \"X confirms\" in running text; never a "
                 "Title Case or passive headline such as \"X Reported Hacked\"), or two unhedged outlets that do not "
                 "relay the same origin. Incident databases (DefiLlama, SlowMist, the AI Incident Database) never confirm alone; a "
                 "single researcher's blog is one outlet's vote; tier C never confirms; newsletter round-ups do not "
                 "count. The mechanism has its own status (stated, suspected or unknown). Clustering: exact subject or "
                 "alias match plus a date window, never a chain of near-matches; a crypto story never merges with an AI "
                 "story, and two AI reports about one product merge only when they report the same issue. AI lane: "
                 "AI context and an AI-security incident or topic (vendor marketing never counts); its incidents are "
                 "scored on concrete harm when no dollar figure is stated. See scripts/radar/README.md.")
    out.append("")
    return "\n".join(out)
