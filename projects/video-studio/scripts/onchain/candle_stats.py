"""Chart-calibration statistics from ANONYMIZED 5-second candle files (stdlib only, no case data).

  python3 candle_stats.py <candles.json>... [--exclude LABEL ...] [--out stats.json]

Input: candle files in the format the audits write to content/<channel>/<slug>/audit-data/:
  {"tokens": [{"label" or "id": ..., "candles": [{"t", "open", "high", "low", "close",
   "volume_sol" or "volume_usd", "trades", "buys", "sells", ["tx_listed"]}, ...],
   "events": [{"t", "who", "side" or "action"}, ...]}, ...]}
with prices normalized to the public wallet's first buy (1.0) and t in seconds from that buy.

Output: per-token metrics and, over all tokens given, the median and interquartile range of each
(linear interpolation). A token whose series stops early (`left_curve_for_pool_within_window`) is
kept for pre-buy metrics only. Linked-wallet sells are events whose `who` starts with side_ or group_,
or is launch_cluster_wallet / seller_proceeds_to_third_address.

Metrics (t = 0 is the public buy):
  token_age_at_public_buy_s, runup_into_public_buy_x (vs 60 s earlier, or vs the first trade),
  peak_x, time_to_peak_s, drawdown_peak_to_low, close_at_30m_x, time_until_close_below_public_buy_price_s,
  time_from_peak_to_half_of_peak_s, side_last_sell_s, side_last_sell_after_peak_s,
  drop_within_5m_after_side_last_sell, largest red candle at 5 s / 1 min / 5 min,
  volume shares in the first 60 s and 5 min of the 30-min window, the largest 5-s bucket in the first
  5 min vs the median active bucket, the first 5-min bar vs the mean of the next five, the first
  minute vs the preceding minutes (volume and trades), buy share of trades in the first 30 s,
  when half / 80% of the first 5 minutes' buys had arrived, share of 5-s buckets with trades after
  minute 10, and the first 5-min bar's high and close.
"""

import argparse
import json
import math
import statistics
import sys

SIDE_WHO = ('launch_cluster_wallet', 'seller_proceeds_to_third_address')


def quantile(xs, p):
    xs = sorted(xs)
    if not xs:
        return None
    k = (len(xs) - 1) * p
    f, c = math.floor(k), math.ceil(k)
    return xs[f] if f == c else xs[f] + (xs[c] - xs[f]) * (k - f)


def summary(xs):
    xs = [x for x in xs if x is not None]
    if not xs:
        return None
    return {'n': len(xs), 'median': quantile(xs, 0.5), 'iqr': [quantile(xs, 0.25), quantile(xs, 0.75)]}


def bars(cs, width, t0, t1, vol):
    out = []
    t = t0
    while t < t1:
        g = [c for c in cs if t <= c['t'] < t + width]
        if g:
            out.append({'t': t, 'o': g[0]['open'], 'h': max(c['high'] for c in g), 'l': min(c['low'] for c in g),
                        'c': g[-1]['close'], 'v': sum(vol(c) for c in g)})
        t += width
    return out


def token_metrics(tok):
    cs = sorted(tok['candles'], key=lambda c: c['t'])
    vkey = 'volume_usd' if any('volume_usd' in c for c in cs) else 'volume_sol'
    vol = lambda c: c.get(vkey, 0) or 0
    cnt = lambda c: c.get('tx_listed', c.get('trades', 0)) or 0
    ev = tok.get('events', [])
    act = lambda e: e.get('side') or e.get('action')
    launch = next((e['t'] for e in ev if e.get('who') in ('token_launch', 'creator')), None)
    side_sells = sorted(e['t'] for e in ev if act(e) == 'sell' and (
        str(e.get('who', '')).startswith(('side_', 'group_')) or e.get('who') in SIDE_WHO))
    truncated = bool(tok.get('left_curve_for_pool_within_window'))
    m = {'label': tok.get('label') or tok.get('id'), 'series_stops_early': truncated}
    age = (-launch) if launch is not None else tok.get('token_age_at_public_buy_s')
    m['token_age_at_public_buy_s'] = age
    first = next((c for c in cs if not c.get('empty') and (c.get('trades', 0) or 0) > 0), None)
    ref = None
    for c in cs:
        if c['t'] <= -60:
            ref = c['close']
    if ref is None or (launch is not None and launch > -60):
        ref = first['open'] if first else None
    m['runup_into_public_buy_x'] = (1.0 / ref) if ref else None
    life0 = max(-600, launch if launch is not None else -600)
    pre_len = -life0
    v60 = sum(vol(c) for c in cs if 0 <= c['t'] < 60)
    n60 = sum(cnt(c) for c in cs if 0 <= c['t'] < 60)
    if pre_len >= 60:
        vpre = sum(vol(c) for c in cs if life0 <= c['t'] < 0) / (pre_len / 60)
        npre = sum(cnt(c) for c in cs if life0 <= c['t'] < 0) / (pre_len / 60)
        m['volume_first_minute_vs_preceding_minutes_x'] = (v60 / vpre) if vpre else None
        m['trades_first_minute_vs_preceding_minutes_x'] = (n60 / npre) if npre else None
    if truncated:
        return m
    post = [c for c in cs if 0 <= c['t'] < 1800]
    pk = max(post, key=lambda c: c['high'])
    m['peak_x'] = pk['high']
    m['time_to_peak_s'] = pk['t']
    after_pk = [c for c in post if c['t'] >= pk['t']]
    m['drawdown_peak_to_low'] = min(c['low'] for c in after_pk) / pk['high'] - 1
    m['close_at_30m_x'] = post[-1]['close']
    m['time_until_close_below_public_buy_price_s'] = next((c['t'] for c in after_pk if c['close'] < 1.0), None)
    half = next((c['t'] for c in after_pk if c['close'] <= 0.5 * pk['high']), None)
    m['time_from_peak_to_half_of_peak_s'] = (half - pk['t']) if half is not None else None
    ss = [t for t in side_sells if t >= -5]
    if ss:
        last = max(ss)
        start = (last // 5) * 5
        before = [c for c in cs if c['t'] < start]
        base = before[-1]['close'] if before else 1.0
        low5 = min(c['low'] for c in cs if start <= c['t'] <= last + 300)
        m['side_last_sell_s'] = last
        m['side_last_sell_after_peak_s'] = last - pk['t']
        m['drop_within_5m_after_side_last_sell'] = low5 / base - 1
    m['largest_red_candle_5s'] = min(c['close'] / c['open'] - 1 for c in post if c['open'] > 0)
    b1 = bars(cs, 60, 0, 1800, vol)
    b5 = bars(cs, 300, 0, 1800, vol)
    m['largest_red_candle_1m'] = min(b['c'] / b['o'] - 1 for b in b1 if b['o'] > 0)
    m['largest_red_candle_5m'] = min(b['c'] / b['o'] - 1 for b in b5 if b['o'] > 0)
    m['first_5m_bar_high_x'] = b5[0]['h']
    m['first_5m_bar_close_x'] = b5[0]['c']
    later = [b['v'] for b in b5[1:]]
    mean_later = (sum(later) / len(later)) if later else 0
    m['first_5m_bar_vs_mean_of_next_five_x'] = (b5[0]['v'] / mean_later) if mean_later > 0 else None
    vtot = sum(vol(c) for c in post)
    m['share_of_30m_volume_in_first_60s'] = (v60 / vtot) if vtot else None
    m['share_of_30m_volume_in_first_5m'] = (sum(vol(c) for c in post if c['t'] < 300) / vtot) if vtot else None
    active = [vol(c) for c in post if vol(c) > 0]
    med_active = statistics.median(active) if active else None
    mx = max(vol(c) for c in post if c['t'] < 300)
    m['largest_5s_bucket_first_5m_vs_median_active_bucket_x'] = (mx / med_active) if med_active else None
    tr30 = sum(c.get('trades', 0) or 0 for c in post if c['t'] < 30)
    by30 = sum(c.get('buys', 0) or 0 for c in post if c['t'] < 30)
    m['buy_share_of_trades_first_30s'] = (by30 / tr30) if tr30 else None
    buys = [(c['t'], c.get('buys', 0) or 0) for c in post if c['t'] < 300]
    total = sum(b for _, b in buys)
    acc, t50, t80 = 0, None, None
    for t, b in buys:
        acc += b
        if t50 is None and total and acc >= 0.5 * total:
            t50 = t + 5
        if t80 is None and total and acc >= 0.8 * total:
            t80 = t + 5
    m['half_of_first_5m_buys_arrived_by_s'] = t50
    m['eighty_pct_of_first_5m_buys_arrived_by_s'] = t80
    tail = [c for c in post if c['t'] >= 600]
    m['share_of_5s_buckets_with_trades_after_10m'] = (sum(1 for c in tail if (c.get('trades', 0) or 0) > 0) / len(tail)) if tail else None
    return m


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('files', nargs='+')
    ap.add_argument('--exclude', nargs='*', default=[], help='token labels to leave out')
    ap.add_argument('--out')
    a = ap.parse_args()
    rows = []
    for f in a.files:
        for tok in json.load(open(f))['tokens']:
            if (tok.get('label') or tok.get('id')) in a.exclude:
                continue
            rows.append(token_metrics(tok))
    keys = sorted({k for r in rows for k in r if k not in ('label', 'series_stops_early')})
    agg = {k: summary([r.get(k) for r in rows]) for k in keys}
    out = {'tokens': rows, 'aggregate': agg}
    s = json.dumps(out, indent=1)
    if a.out:
        open(a.out, 'w').write(s + '\n')
    else:
        sys.stdout.write(s + '\n')


if __name__ == '__main__':
    main()
