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


def losses_line(incident, names):
    if not incident["reportedLosses"]:
        return "none stated"
    parts = []
    for entry in sorted(incident["reportedLosses"], key=lambda e: ("ABC".index(e.get("tier", "C")), -e["amountUsd"])):
        parts.append(f"{format_usd_exact(entry['amountUsd'])} reported by {md(names.get(entry['by'], entry['by']))}")
    return "; ".join(parts)


def _when(source):
    return (source.get("publishedUtc") or source.get("eventDate") or "")[:16].replace("T", " ")


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
    out.append(
        "> Research draft for the script writer and the claim gate, not a script. Figures are "
        "\"reported by\" a named source and are never averaged. Status \"developing\" must stay on "
        "screen and in the script. No individuals are named (names in source text are redacted) "
        "and mechanisms stay at concept level. No price or investment talk."
    )
    out.append("")
    ready = [i for i in doc["top"] if i["shortReady"]["ready"]]
    out.append(
        f"**Daily Short check:** {len(ready)} of {len(doc['top'])} top candidates meet the analysis bar "
        "(confirmed, 2+ independent sources, stated mechanism, a strong explainer link)."
        + ("" if ready else " Owner rule: skip today's daily Short unless one of these gains real analysis.")
    )
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
        status = inc["status"].upper()
        out.append(f"### {rank}. {md(inc['title'])} ({status}) score {inc['score']['total']}")
        out.append("")
        out.append(f"- **Incident date (UTC):** {inc['dateUtc']} | **Type:** {md(TYPE_LABEL[inc['type']])} | "
                   f"**Chains:** {md(', '.join(inc['chains']) or 'not stated')} | "
                   f"**Explainer link:** {md(inc['evergreenTopic'] or 'none')}")
        out.append(f"- **Reported losses:** {losses_line(inc, names)}")
        out.append(f"- **Status:** {md(inc['statusReason'])}")
        if inc.get("postMortemUrl"):
            out.append(f"- **Post-mortem:** {link(inc['postMortemUrl'], inc['postMortemUrl'])}")
        short = inc["shortReady"]
        out.append("- **Daily Short:** " + ("meets the analysis bar" if short["ready"] else "not yet: " + md("; ".join(short["missing"]))))
        factors = inc["score"]["factors"]
        out.append("- **Score:** " + " | ".join(
            f"{name} {f['points']}/{f['weight']}" for name, f in factors.items()))
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
            hedge = f" (hedged: {md(src['hedge'])})" if src.get("hedge") else ""
            out.append(f"| {src['tier']} | {md(names.get(src['id'], src['id']))} | {_when(src)} | {link(src['title'], src['url'])}{hedge} |")
        out.append("")
        out.append("<details><summary>Excerpts (at most 280 characters each)</summary>")
        out.append("")
        for src in inc["sources"]:
            if src.get("excerpt"):
                out.append(f"- {md(names.get(src['id'], src['id']))}: {md(src['excerpt'])}")
        out.append("")
        out.append("</details>")
        out.append("")
    out.append("## Also seen")
    out.append("")
    if doc["alsoSeen"]:
        out.append("| Score | Incident | Status | Date | Reported losses | Sources |")
        out.append("| --- | --- | --- | --- | --- | --- |")
        for inc in doc["alsoSeen"]:
            ids = sorted({names.get(s["id"], s["id"]) for s in inc["sources"]})
            figures = ", ".join(sorted({format_usd(e["amountUsd"]) + " (" + names.get(e["by"], e["by"]) + ")" for e in inc["reportedLosses"]})) or "none stated"
            out.append(f"| {inc['score']['total']} | {md(inc['title'])} | {inc['status']} | {inc['dateUtc']} | {md(figures)} | {md(', '.join(ids))} |")
    else:
        out.append("Nothing else in the window.")
    out.append("")
    out.append("## Unclustered security items")
    out.append("")
    if doc["unclustered"]:
        for item in doc["unclustered"]:
            out.append(f"- {link(item['title'], item['url'])} ({md(names.get(item['sourceId'], item['sourceId']))}, "
                       f"tier {item['tier']}, {(item.get('publishedUtc') or '')[:10]}): {md(item['reason'])}")
    else:
        out.append("None.")
    out.append("")
    out.append("## Source health")
    out.append("")
    out.append("| Source | Tier | Result | Items | Security-relevant | Note |")
    out.append("| --- | --- | --- | --- | --- | --- |")
    for src in doc["sources"]:
        note = "; ".join(src.get("warnings", [])[:2])
        out.append(f"| {md(src['name'])} | {src['tier']} | {src['status']} | {src['items']} | {src['relevant']} | {md(note)} |")
    out.append("")
    out.append("## Method")
    out.append("")
    weights = doc["scoring"]["weights"]
    out.append("Score = " + " + ".join(f"{k} x {v}" for k, v in weights.items())
               + " (each factor 0 to 1, reasons above). Confirmed = one unhedged tier-A source, or two "
                 "independent unhedged tier-B outlets; tier C never confirms. Clustering: subject or alias "
                 "match plus a date window. See scripts/radar/README.md.")
    out.append("")
    return "\n".join(out)
