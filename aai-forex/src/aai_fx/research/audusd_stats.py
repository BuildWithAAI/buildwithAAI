"""Descriptive AUDUSD market, session and trade-path statistics."""
from __future__ import annotations
import math
from typing import Any
import numpy as np
import pandas as pd
from .audusd_strategies.sessions import session_features
from .audusd_strategies.common import regime


def qstats(values: pd.Series) -> dict[str, Any]:
    x = values.dropna().to_numpy()
    if not len(x): return {"n": 0}
    return {"n": len(x), **{f"p{int(q)}": float(np.percentile(x, q)) for q in (10, 25, 50, 75, 90, 95)},
            "mean": float(x.mean())}


def characterize(h1: pd.DataFrame, m15: pd.DataFrame | None = None) -> dict[str, Any]:
    from .audusd_features import load_higher_features
    key=(h1.index.tz_convert('America/New_York').tz_localize(None)+pd.Timedelta(hours=7)).normalize()
    g=h1.assign(key=key).groupby('key').agg(open=('open','first'),high=('high','max'),low=('low','min'),close=('close','last'),n=('close','size'),t=('open',lambda _:0))
    g=g[(g.n>=20)&(g.index.dayofweek<5)]
    g['range_pips']=(g.high-g.low)/.0001;g['directional_pips']=(g.close-g.open)/.0001
    g['prior_range']=g.range_pips.shift(1)
    # Prior known regime at actual NY session open. These are conditions, not
    # forward-looking explanations of a move or proof of causation.
    opens=(g.index-pd.Timedelta(hours=7)).tz_localize('America/New_York',ambiguous='NaT',nonexistent='shift_forward').tz_convert('UTC')
    for tf in ['H4','D1']:
        f=load_higher_features(tf).reindex(opens,method='ffill')
        g[tf+'_prior_regime']=f.regime.to_numpy()
    def one(d):
        return {'days':len(d),'range_pips':qstats(d.range_pips),'abs_open_close_pips':qstats(d.directional_pips.abs()),
                'range_ge100_pct':float(100*(d.range_pips>=100).mean()),'directional_ge100_pct':float(100*(d.directional_pips.abs()>=100).mean()),
                'directional_ge130_pct':float(100*(d.directional_pips.abs()>=130).mean())}
    by_year={str(y):one(v) for y,v in g.groupby(g.index.year)}
    regimes={}
    for tf in ['H4','D1']:
        regimes[tf]={str(int(r)):one(v) for r,v in g.groupby(tf+'_prior_regime')}
    big=g[g.directional_pips.abs()>=100]
    direction_accuracy={}
    for tf in ['H4','D1']:
        usable=g[g[tf+'_prior_regime'].notna()&(g[tf+'_prior_regime']!=0)]
        x=usable[usable.directional_pips.abs()>=100]
        direction_accuracy[tf]={'big_days':len(x),'correct_prior_regime_direction_pct':float(100*(np.sign(x.directional_pips)==x[tf+'_prior_regime']).mean())}
    # Session windows intentionally overlap; ranges cannot be added together.
    windows={'Sydney':('Australia/Sydney',8,17),'Tokyo':('Asia/Tokyo',9,18),'London':('Europe/London',8,17),'New_York':('America/New_York',8,17)}
    sessions={}
    for name,(tz,lo,hi) in windows.items():
        loc=h1.index.tz_convert(tz);sel=(loc.hour>=lo)&(loc.hour<hi)
        x=h1[sel].copy();day=loc[sel].date
        rr=x.groupby(day).agg(high=('high','max'),low=('low','min'),n=('close','size'))
        rr=rr[rr.n>=6]
        ct=h1.index[sel].tz_convert('America/Chicago')
        sessions[name]={'local_window':f'{lo:02d}:00-{hi:02d}:00 {tz}',
                        'Chicago_open_hours':sorted(set(h1.index[(loc.hour==lo)].tz_convert('America/Chicago').hour.tolist())),
                        'session_range_pips':qstats((rr.high-rr.low)/.0001),
                        'H1_range_pips':qstats((x.high-x.low)/.0001),'quoted_open_spread_pips':qstats(x.spread_pips)}
    local=h1.index.tz_convert('America/New_York').tz_localize(None)+pd.Timedelta(hours=7)
    hr=h1.assign(k=local.floor('4h')).groupby('k').agg(high=('high','max'),low=('low','min'),n=('close','size'))
    hr=hr[hr.n>=3]
    costs=[]
    for target in [5,10,20,25,30]:
        for sp in [.8,1.15,1.5]:
            costs.append({'target_pips':target,'spread_pips':sp,'roundtrip_market_slip_pips':.3,
                          'with_7usd_lot_roundtrip_commission_pips':sp+.3+.7,
                          'cost_pct_target_no_commission':100*(sp+.3)/target,
                          'cost_pct_target_with_commission':100*(sp+1.0)/target})
    macro: dict[str, Any]={}
    root=__import__('pathlib').Path(__file__).resolve().parents[3]
    pp=root/'data/forex_factory_cache.csv'
    if pp.exists():
        cal=pd.read_csv(pp,usecols=['DateTime','Currency','Impact','Event'])
        cal['dt']=pd.to_datetime(cal.DateTime,utc=True,errors='coerce')
        cal=cal[cal.dt.notna() & ~cal.DateTime.str.contains('T00:00:00',na=False)].copy()
        cal['day']=(cal.dt.dt.tz_convert('America/New_York').dt.tz_localize(None)+pd.Timedelta(hours=7)).dt.normalize()
        begin,end=cal.dt.min(),cal.dt.max()
        coverage=g[(g.index>=begin.tz_convert(None).normalize())&(g.index<=end.tz_convert(None).normalize())]
        for name,cur,regex in [('RBA_secondary_timed','AUD','^Cash Rate$'),('US_payroll','USD','^Non-Farm Employment Change$'),('US_CPI','USD','^(?:Core CPI m/m|CPI m/m|CPI y/y)$'),('US_FOMC','USD','^(?:Federal Funds Rate|FOMC Statement)$'),('AU_employment','AUD','^Employment Change$')]:
            dates=cal[(cal.Currency==cur)&cal.Event.str.contains(regex,regex=True,na=False)].day.unique()
            macro[name]={'event_days':one(coverage[coverage.index.isin(dates)]),'other_days':one(coverage[~coverage.index.isin(dates)])}
        macro['calendar_source']='https://huggingface.co/datasets/oprizzle/Forex_Factory_Calendar; archived secondary source, dates not individually verified'
        official=root/'research/audusd/rba_dates.json'
        if official.exists():
            import json
            records=json.loads(official.read_text())
            dates=[pd.Timestamp(d) for rec in records for d in rec['dates']]
            covered_years=[rec['year'] for rec in records if rec['dates']]
            covered=g[g.index.year.isin(covered_years)]
            macro['RBA_official']={'event_days':one(covered[covered.index.isin(dates)]),'other_days':one(covered[~covered.index.isin(dates)]),'source':'https://www.rba.gov.au/monetary-policy/int-rate-decisions/; rba_dates.json','definition':'RBA Australian calendar date equals NY trading-date label at 14:30 Sydney announcement'}

        macro['coverage_end']=end.tz_convert('America/Chicago').isoformat()
    for hours in [24,72,120]:
        # Forward directional displacement in exactly H1 bar count is a descriptive
        # opportunity statistic only; weekends/gaps make this not calendar hours.
        pass
    return {'daily':one(g),'by_year':by_year,'sessions':sessions,'H1_range_pips':qstats((h1.high-h1.low)/.0001),
            'H4_range_pips':qstats((hr.high-hr.low)/.0001),'prior_regimes':regimes,'prior_regime_direction_on_big_days':direction_accuracy,
            'prior_day_range_before_100pip_days':qstats(big.prior_range),
            'all_prior_day_ranges':qstats(g.prior_range),
            'big_days':[{'session_date':str(t.date()),'open_close_pips':float(r.directional_pips),'range_pips':float(r.range_pips)} for t,r in big.iterrows()],
            'cost_hurdle':costs,'macro_days':macro}


def longest_streak(trades: list[dict[str, Any]]) -> int:
    best = cur = 0
    for t in trades:
        cur = cur + 1 if t["net_pnl"] <= 0 else 0
        best = max(best, cur)
    return best


def trade_bootstrap(trades: list[dict[str, Any]], samples: int = 1000, seed: int = 8042) -> dict[str, Any]:
    """Moving-block resampling with lot-step compounding; model uncertainty only.

    Block size 5 trades retains some short-run dependence. Cannot capture
    unseen regime shifts, execution failures, or estimate true ruin odds.
    """
    rng=np.random.default_rng(seed);n=len(trades)
    if n<10:return {'n':n,'note':'too few trades'}
    rs=np.array([t['r_multiple'] for t in trades]);pnl=np.array([t['net_pnl']/t['lots'] for t in trades]);risk=np.array([t['initial_risk']/t['lots'] for t in trades]);price=np.array([t['entry_price'] for t in trades])
    starts=rng.integers(0,n,(samples,(n+4)//5));ix=((starts[:,:,None]+np.arange(5))%n).reshape(samples,-1)[:,:n]
    means=rs[ix].mean(axis=1)
    equity=np.full(samples,100.);peak=equity.copy();maxdd=np.zeros(samples);min_eq=equity.copy();stalled=np.zeros(samples,bool)
    for k in range(n):
        j=ix[:,k];lots=np.floor(equity*.01/(risk[j]*.01)+1e-9)*.01
        lots=np.minimum(lots,np.floor(equity*10/(price[j]*100000)/.01)*.01)
        lots=np.maximum(lots,.01)
        ok=(risk[j]*lots<=equity*.03)&(lots*100000*price[j]/10<=equity)&(~stalled)
        stalled|=~ok
        equity+=np.where(ok,pnl[j]*lots,0)
        peak=np.maximum(peak,equity);maxdd=np.maximum(maxdd,1-equity/peak);min_eq=np.minimum(min_eq,equity)
    return {'n':n,'samples':samples,'block_length_trades':5,'expectancy_r_ci95':np.quantile(means,[.025,.975]).tolist(),
            'fraction_resampled_mean_below_zero':float((means<0).mean()),'final_equity_p05_p50_p95':np.quantile(equity,[.05,.5,.95]).tolist(),
            'maxdrawdown_pct_p05_p50_p95':(100*np.quantile(maxdd,[.05,.5,.95])).tolist(),
            'fraction_touching_50dollars':float((min_eq<=50).mean()),'fraction_risk_or_margin_stalled':float(stalled.mean()),
            'warning':'Conditional resampling of historical trades, NOT real-world ruin probability or forecast.'}
