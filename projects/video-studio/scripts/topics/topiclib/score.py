"""The topic finder's own metrics (derived from YouTube API Data, so labelled as ours wherever they are shown):

- outlier ratio = views / max(channel baseline median, baseline floor);
- outlier component = log2(ratio) / log2(saturation), clamped to 0-1 (a 32x outlier scores 1.0);
- recency component = 0.5 ** (age days / half-life);
- engagement component = 0.5 + 0.5 * log2(rate / run median rate for the same format), clamped; 0.5 when likes are
  hidden or views are zero;
- fit component from taxonomy.json (channel, format and cue weights, times the language weight);
- rank = 100 x weighted sum x confidence, where confidence multiplies a penalty per flag (config.json)."""

import math
import statistics


def outlier_ratio(views, median, floor):
    """(ratio, floor_applied). A missing median uses the floor."""
    if views is None:
        return None, False
    base = median if median is not None else 0.0
    applied = base < floor
    return views / max(base, float(floor), 1.0), applied


def outlier_component(ratio, saturation):
    if ratio is None or ratio <= 1.0:
        return 0.0
    return max(0.0, min(1.0, math.log2(ratio) / math.log2(max(2.0, saturation))))


def recency_component(age_days, half_life):
    if age_days is None:
        return 0.0
    return 0.5 ** (max(0.0, age_days) / max(1.0, half_life))


def engagement_rate(likes, comments, views):
    """(likes + comments) per view, or None when likes are hidden or there are no views."""
    if not views or views <= 0 or likes is None:
        return None
    return (likes + (comments or 0)) / views


def median_rates(candidates):
    """Median engagement rate per format among this run's candidates (the reference for the engagement component)."""
    by_format = {}
    for c in candidates:
        if c.get("engagementRate") is not None:
            by_format.setdefault(c["format"], []).append(c["engagementRate"])
    return {fmt: statistics.median(rates) for fmt, rates in by_format.items() if rates}


def engagement_component(rate, reference):
    if rate is None or not reference or reference <= 0 or rate <= 0:
        return 0.5
    return max(0.0, min(1.0, 0.5 + 0.5 * math.log2(rate / reference)))


def confidence(flags, table):
    value = 1.0
    for flag in sorted(set(flags)):
        value *= float(table.get(flag, 1.0))
    return value


def rank(parts, weights, conf):
    total_weight = sum(weights.values()) or 1.0
    weighted = sum(weights[k] * parts.get(k, 0.0) for k in weights) / total_weight
    return round(100.0 * weighted * conf, 1)
