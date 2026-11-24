"""A channel's typical recent performance: the median views of its recent uploads, compared like with like.

The baseline for a candidate:
1. takes the channel's recent uploads (uploads playlist), minus the candidate itself, live or upcoming broadcasts,
   uploads younger than minAgeDays (still ramping) and older than maxAgeDays;
2. keeps the same format as the candidate (Shorts with Shorts, long-form with long-form: Shorts count every start,
   so their views are not comparable with long-form views);
3. prefers uploads published under the same view-counting rules as the candidate (contracts.VIEW_COUNT_EPOCHS);
4. falls back, with a flag each time, to a thin same-format sample, then a mixed-format sample, then the channel's
   lifetime average without the candidate (channels.list viewCount / videoCount)."""

import datetime as dt
import statistics

from . import contracts, text
from .classify import detect_format


def epoch_start(fmt, published_at, epochs=contracts.VIEW_COUNT_EPOCHS):
    """The latest view-counting change that applies to this format and is not after the candidate's publish time."""
    latest = None
    for e in epochs:
        if fmt not in e["formats"]:
            continue
        start = dt.datetime.fromisoformat(e["date"]).replace(tzinfo=dt.timezone.utc)
        if published_at is not None and start <= published_at and (latest is None or start > latest):
            latest = start
    return latest


def _quartiles(values):
    if len(values) < 4:
        return None, None
    q = statistics.quantiles(values, n=4, method="inclusive")
    return q[0], q[2]


def lifetime_estimate(channel, candidate_views):
    """(estimate, note) from channels.list statistics with the candidate's own views and the candidate removed."""
    if not channel:
        return None, "no channel statistics"
    views, count = channel.get("viewCount"), channel.get("videoCount")
    if views is None or not count:
        return None, "channel statistics hide the view or video count"
    if count <= 1:
        return None, "the channel has no other public videos"
    rest = max(0, views - (candidate_views or 0))
    return rest / (count - 1), f"lifetime average of {text.fmt_int(rest)} views over {count - 1} other public videos"


def compute(candidate, uploads, channel, now, cfg, fmt_cfg, epochs=contracts.VIEW_COUNT_EPOCHS, uploads_note=None):
    """candidate: classified full record ('format', 'publishedAt', 'views', 'id').
    uploads: baseline video records of the channel (any order), or None when they could not be read."""
    b = cfg
    cand_pub = text.parse_time(candidate.get("publishedAt"))
    fmt = candidate["format"]
    flags, notes = [], []
    pool = []
    for v in uploads or []:
        if v.get("id") == candidate.get("id") or v.get("liveBroadcastContent") in ("live", "upcoming"):
            continue
        views = v.get("views")
        pub = text.parse_time(v.get("publishedAt"))
        if views is None or pub is None:
            continue
        age = text.days_between(pub, now)
        if age < b.get("minAgeDays", 7) or age > b.get("maxAgeDays", 365):
            continue
        vfmt, _assumed, _aspect = detect_format(v.get("durationSec"), v.get("embedWidth"), v.get("embedHeight"), fmt_cfg)
        pool.append({"id": v["id"], "publishedAt": pub, "format": vfmt, "views": views})
    pool.sort(key=lambda p: p["publishedAt"], reverse=True)
    max_n = b.get("maxVideos", 30)
    min_n = b.get("minVideos", 5)
    thin_n = b.get("thinMinVideos", 3)
    same = [p for p in pool if p["format"] == fmt][:max_n]
    epoch = epoch_start(fmt, cand_pub, epochs)
    sample, method = None, None
    if epoch is not None:
        same_epoch = [p for p in same if p["publishedAt"] >= epoch]
        if len(same_epoch) >= min_n:
            sample, method = same_epoch, "median-same-format"
    if sample is None and len(same) >= min_n:
        sample, method = same, "median-same-format"
    if sample is None and len(same) >= thin_n:
        sample, method = same, "median-same-format"
        flags.append("thin-baseline")
        notes.append(f"only {len(same)} recent {fmt_label(fmt)} uploads")
    if sample is None and len(pool) >= min_n:
        sample, method = pool[:max_n], "median-mixed-format"
        flags.append("mixed-format-baseline")
        notes.append(f"only {len(same)} recent {fmt_label(fmt)} uploads, so all {len(pool[:max_n])} recent uploads were used")
    if sample is not None:
        if epoch is not None and any(p["publishedAt"] < epoch for p in sample):
            flags.append("baseline-spans-view-count-change")
            notes.append(f"some baseline uploads predate the {epoch.date().isoformat()} view-counting change")
        views = [p["views"] for p in sample]
        p25, p75 = _quartiles(views)
        return {
            "method": method,
            "median": float(statistics.median(views)),
            "n": len(views),
            "format": fmt if method == "median-same-format" else "mixed",
            "p25": p25,
            "p75": p75,
            "from": min(p["publishedAt"] for p in sample).date().isoformat(),
            "to": max(p["publishedAt"] for p in sample).date().isoformat(),
            "epoch": epoch.date().isoformat() if epoch else None,
            "flags": flags,
            "notes": notes,
        }
    estimate, note = lifetime_estimate(channel, candidate.get("views"))
    if uploads_note:
        notes.append(uploads_note)
    elif uploads is not None:
        notes.append(f"only {len(pool)} usable recent uploads")
    flags.append("estimated-baseline")
    notes.append(note)
    return {
        "method": "lifetime-average" if estimate is not None else "none",
        "median": float(estimate) if estimate is not None else None,
        "n": 0, "format": "all", "p25": None, "p75": None, "from": None, "to": None,
        "epoch": epoch.date().isoformat() if epoch else None,
        "flags": flags, "notes": notes,
    }


def fmt_label(fmt):
    return "Shorts" if fmt == "short" else "long-form"
