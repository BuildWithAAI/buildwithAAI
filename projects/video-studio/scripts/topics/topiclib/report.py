"""out/topics/<date>.md (for the owner) from the run document that is also written as out/topics/<date>.json.

Every YouTube value is shown as the API returned it, with the time it was fetched; every metric the tool computed
is labelled as ours (the derived-metrics policy requires the two to be distinguishable)."""

from . import contracts, text

REJECT_LABELS = {
    "below-floor": "below the view floor",
    "not-outlier": "not an outlier (ratio below the threshold)",
    "attack-tutorial": "attack tutorial (we never take inspiration from how-to-attack videos)",
    "price-content": "price prediction or buy content (off-limits for our channels)",
    "off-niche": "off-niche (no topic in taxonomy.json matched)",
    "own-channel": "our own channel",
    "excluded-channel": "a channel in excludeChannelIds",
    "live-or-upcoming": "live or upcoming broadcast",
    "outside-window": "published outside the window",
    "no-statistics": "no public view count",
    "no-fit": "no channel format fits the topic",
    "no-baseline-budget": "baseline not fetched (quota cap reached)",
}


def _cell(value):
    return str(value).replace("|", "\\|").replace("\n", " ")


def _md_text(value):
    """Escape characters that would turn a YouTube title into Markdown markup or a link."""
    out = str(value or "")
    for ch in ("\\", "`", "*", "_", "[", "]", "<", ">", "|"):
        out = out.replace(ch, "\\" + ch)
    return out


def _views(n):
    return f"{text.fmt_int(n)} view{'s' if n != 1 else ''}" if n is not None else "hidden views"


def why_sentence(c):
    b = c["baseline"]
    fmt = "Shorts" if c["format"] == "short" else "long-form"
    age = c.get("ageDays")
    age_txt = f"{age:.0f} day{'s' if round(age) != 1 else ''} after publishing" if age is not None else "age unknown"
    parts = []
    if b["method"] in ("median-same-format", "median-mixed-format"):
        scope = f"{b['n']} most recent {fmt + ' uploads' if b['method'] == 'median-same-format' else 'uploads of every format'}"
        parts.append(f"{_views(c['views'])} {age_txt}: {text.fmt_ratio(c['outlier'])} this channel's median of {text.fmt_int(round(b['median']))} across its {scope} ({b['from']} to {b['to']})")
    elif b["method"] == "lifetime-average":
        parts.append(f"{_views(c['views'])} {age_txt}: {text.fmt_ratio(c['outlier'])} an estimated baseline of {text.fmt_int(round(b['median']))} ({'; '.join(b['notes'])})")
    else:
        parts.append(f"{_views(c['views'])} {age_txt}: no baseline could be read ({'; '.join(b['notes']) or 'unknown'}), so the {text.fmt_int(c['floor'])}-view floor was used: {text.fmt_ratio(c['outlier'])}")
    if c.get("floorApplied") and b["method"] != "none":
        parts.append(f"the median is below the {text.fmt_int(c['floor'])}-view floor, so the floor was used")
    rate, ref = c.get("engagementRate"), c.get("engagementReference")
    if rate is not None:
        parts.append(f"likes and comments per view {text.fmt_pct(rate)} vs {text.fmt_pct(ref)} for this run's {fmt} candidates" if ref else f"likes and comments per view {text.fmt_pct(rate)}")
    else:
        parts.append("likes hidden, so engagement counts as neutral")
    other = [n for n in b.get("notes", []) if "view-counting change" in n]
    parts.extend(other)
    return "; ".join(parts) + "."


def _evidence_line(e, lead=False):
    lang = {"en": "English", "es": "Spanish", "pt": "Portuguese"}.get(e.get("lang"), e.get("lang") or "unknown language")
    fmt = ("Short" if e["format"] == "short" else "long-form") + (" (format assumed: no aspect ratio)" if e.get("formatAssumed") else "")
    dur = text.format_duration(e.get("durationSec"))
    pub = (e.get("publishedAt") or "")[:10]
    head = f"[{_md_text(e['title'])}]({e['url']}) by {_md_text(e['channelTitle'])}"
    meta = f"{_views(e['views'])} · published {pub} · {fmt} {dur} · {lang}"
    if lead:
        return f"{head} · {meta}"
    return f"{head} · {meta} · {text.fmt_ratio(e['outlier'])} (score {e['score']:.0f})"


def render_markdown(doc):
    out = []
    add = out.append
    run_date = doc["runDate"]
    add(f"# Topic finder: {run_date}")
    add("")
    niches = sorted({q["niche"] for q in doc["queries"]})
    langs = sorted({q["lang"] for q in doc["queries"]})
    add(f"Ranked video ideas from outliers in our niches ({', '.join(niches)}; {', '.join(langs)}), published in the {doc['window']['days']} days before {run_date}.")
    add("")
    if doc["mode"] == "fixtures":
        add("> **Fixture run: synthetic data shaped like YouTube Data API responses. These are not real videos or channels.**")
        add("")
    add(f"> Source: YouTube Data API v3 (data from YouTube), fetched {doc['fetchedAt']}; counts are as of that time. "
        "Outlier ratios, scores, tags, angles and titles are the topic finder's own work, not YouTube data. "
        f"This report holds YouTube data, so it is deleted on {doc['expiresOn']} (YouTube API Developer Policies III.E.4: at most {doc['policy']['retentionDays']} days). "
        f"YouTube Terms of Service: {contracts.POLICY['youtubeTerms']}.")
    add("")
    ideas = doc["ideas"]
    listed = [i for i in ideas if i["backlog"]["status"] != "duplicate"]
    dups = [i for i in ideas if i["backlog"]["status"] == "duplicate"]
    add("## At a glance")
    add("")
    if not listed:
        add("No new ideas this run." + (" See the evidence for existing backlog ideas below." if dups else ""))
    else:
        add("| # | Our working title | Channel and format | Score (ours) | Best outlier | Backlog |")
        add("| --- | --- | --- | --- | --- | --- |")
        for i in listed:
            top = i["evidence"][0]
            add(f"| {i['rank']} | {_cell(i['pitch']['workingTitle'])} | {_cell(i['channelName'])}, {_cell(i['formatLabel'])} | {i['score']:.0f} | {text.fmt_ratio(top['outlier'])} ({text.fmt_int(top['views'])} views) | {i['backlog']['status']} |")
    add("")
    q = doc["quota"]
    add("## Quota")
    add("")
    calls = ", ".join(f"{m} {n}" for m, n in q["calls"].items()) or "none"
    add(f"- search.list: {q['spent'].get('search', 0)} of this run's {q['caps'].get('search', 0)} calls (Search Queries bucket, {q['dailyLimits'].get('search')} a day per project).")
    add(f"- Other methods: {q['spent'].get('default', 0):,} of this run's {q['caps'].get('default', 0):,} units ({q['dailyLimits'].get('default'):,} a day per project).")
    cache_txt = f"{doc['cache']['hits']} hits, {doc['cache']['misses']} misses" if doc["cache"].get("enabled") else "off"
    add(f"- Requests sent: {calls}. Cache: {cache_txt}.")
    if q.get("refused"):
        add(f"- Not sent because the cap was reached: {', '.join(f'{m} {n}' for m, n in q['refused'].items())}.")
    if q.get("exhausted"):
        add(f"- YouTube answered quotaExceeded for: {', '.join(q['exhausted'])}. The run used what it had.")
    for note in q.get("notes", []):
        add(f"- {note}")
    add("")
    add("## Ideas")
    add("")
    for i in listed:
        _render_idea(add, i)
    if dups:
        add("## Demand evidence for ideas already in the backlog")
        add("")
        add("These outliers match ideas the backlog already has, so they are not exported again. Consider raising those ideas' priority.")
        add("")
        for i in dups:
            m = next(x for x in i["backlog"]["matches"] if x["relation"] == "duplicate")
            top = i["evidence"][0]
            add(f"- `{m['id']}` ({_md_text(m['title'])}, {i['channelName']}, priority {m.get('priority')}): {len(i['evidence'])} outlier video{'s' if len(i['evidence']) != 1 else ''} on {i['evidenceChannels']} channel{'s' if i['evidenceChannels'] != 1 else ''}; best {_evidence_line(top)}.")
        add("")
    add("## Not listed")
    add("")
    rejected = doc["rejected"]
    if rejected:
        add("| Reason | Videos |")
        add("| --- | --- |")
        for reason, n in sorted(rejected.items(), key=lambda kv: (-kv[1], kv[0])):
            add(f"| {_cell(REJECT_LABELS.get(reason, reason))} | {n} |")
    else:
        add("Nothing was filtered out.")
    add("")
    add("## Queries")
    add("")
    add("| Query id | Niche | Language | Order | Videos | Status |")
    add("| --- | --- | --- | --- | --- | --- |")
    for row in doc["queries"]:
        add(f"| `{row['id']}` | {_cell(row['niche'])} | {row['lang']} | {row['order']} | {row.get('videos', 0)} | {_cell(row['status'])} |")
    add("")
    if doc.get("exports"):
        add("## Backlog exports")
        add("")
        for channel, info in sorted(doc["exports"].items()):
            add(f"- `{info['path']}`: {info['ideas']} candidate idea{'s' if info['ideas'] != 1 else ''} for {channel}, in the format of `content/{channel}/backlog.json`" + (f"; merged preview `{info['preview']}`" if info.get("preview") else "") + ".")
        add("")
        add("Copy the ideas you want into the channel's backlog by hand and renumber their priority; never copy the evidence map (it holds YouTube data that expires).")
        add("")
    if doc.get("warnings") or doc.get("errors"):
        add("## Warnings")
        add("")
        for w in doc.get("warnings", []):
            add(f"- {_md_text(w)}")
        for e in doc.get("errors", []):
            add(f"- {e['method']} ({e['kind']}{', ' + str(e['status']) if e.get('status') else ''}{', ' + e['reason'] if e.get('reason') else ''}): {_md_text(e['message'])} [{_md_text(e.get('context', ''))}]")
        add("")
    add("## How to read the scores")
    add("")
    w = doc.get("settings", {}).get("weights", {})
    formula = " + ".join(f"{float(w[k]):.2f} {k}" for k in ("outlier", "recency", "engagement", "fit") if k in w)
    add("Outlier ratio = views / the channel's median recent views (same format, never below the floor). "
        f"Score = 100 x ({formula}) x confidence, with the weights and penalties in `scripts/topics/config.json`. "
        "A high score is a reason to look, not proof of demand: a single viral video can be luck, so ideas seen on several channels get a small bonus.")
    add("")
    return "\n".join(out)


def _render_idea(add, i):
    top = i["evidence"][0]
    add(f"### {i['rank']}. {_md_text(i['pitch']['workingTitle'])}")
    add("")
    add(f"**{i['channelName']} · {i['formatLabel']} · evergreen `{i['evergreenTopic']}` · our score {i['score']:.0f}** · backlog: {i['backlog']['status']} · id `{i['id']}`")
    add("")
    add(f"**Original video (YouTube):** {_evidence_line(top, lead=True)}")
    add("")
    add(f"**Why it is an outlier:** {_md_text(top['why'])} Our score parts: outlier {top['components']['outlier']:.2f}, recency {top['components']['recency']:.2f}, engagement {top['components']['engagement']:.2f}, fit {top['components']['fit']:.2f}; confidence {top['confidence']:.2f}" + (f" ({', '.join(top['flags'])})" if top["flags"] else "") + ".")
    add("")
    if len(i["evidence"]) > 1:
        add(f"**Also seen ({len(i['evidence']) - 1} more{', +' + str(int(i['breadthBonus'])) + ' for demand on several channels' if i['breadthBonus'] else ''}):**")
        add("")
        for e in i["evidence"][1:5]:
            add(f"- {_evidence_line(e)}")
        add("")
    add(f"**Our original angle:** {i['pitch']['angle']}")
    add("")
    guard = i["copyGuard"]["title"]
    guard_txt = "passes" if guard["ok"] else "FAILS: rewrite the title"
    add(f"**Working title options (ours):** " + " / ".join(f"\"{t}\"" for t in i["pitch"]["titleOptions"]) + f". Copy guard {guard_txt} (word overlap with source titles {guard['maxJaccard']:.2f}, longest shared run {guard['maxRun']} word{'s' if guard['maxRun'] != 1 else ''}).")
    add("")
    if i["pitch"]["shortIdeas"]:
        add("**Shorts:** " + " / ".join(i["pitch"]["shortIdeas"]))
        add("")
    add("**Facts to verify before scripting:**")
    add("")
    for f in i["facts"]:
        add(f"- {f}")
    add("")
    fit = i["fit"]
    fit_line = f"**Channel fit:** {fit['channelName']}, {i['formatLabel']} (fit {fit['fit']:.2f}: {', '.join(fit['reasons'])})."
    if fit.get("evergreenPlanned"):
        fit_line += f" Feeds the evergreen \"{fit['evergreenPlanned']['title']}\" ({fit['evergreenPlanned'].get('status') or 'planned'})."
    if fit.get("alternatives"):
        fit_line += " Also fits: " + "; ".join(fit["alternatives"]) + "."
    related = [m for m in i["backlog"]["matches"] if m["relation"] == "related"]
    if related:
        fit_line += " Related backlog ideas: " + ", ".join(f"`{m['id']}`" for m in related) + "."
    add(fit_line)
    add("")
    add("**Risks:**")
    add("")
    for r in i["risks"]:
        add(f"- {r}")
    add("")
    add("**Tags (ours, not YouTube categories):** " + " ".join(f"`{t}`" for t in i["tags"]))
    add("")
    add("---")
    add("")
