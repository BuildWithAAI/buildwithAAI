from __future__ import annotations

import numpy as np
import pandas as pd

from aai_fx.research.audusd_engine import Simulation, simulate
from aai_fx.research.audusd_strategies.sessions import regime_htf


def bars(n=8):
    idx = pd.date_range("2024-01-03 10:00", periods=n, freq="1min", tz="UTC")
    mid = np.full(n, .7000)
    d = pd.DataFrame({"open": mid, "high": mid, "low": mid, "close": mid, "volume": 1}, index=idx)
    half = .00005
    for c in ["open","high","low","close"]:
        d["bid_"+c]=d[c]-half;d["ask_"+c]=d[c]+half
    return d, mid


def run(d, side, stop=20, target=None, trail=np.nan, **kwargs):
    n=len(d); z=np.zeros(n,dtype=np.int64)
    ss=np.full(n, float(stop));tr=np.full(n,2*stop if target is None else target,float);tt=np.full(n,trail,float)
    return simulate(d, np.asarray(side,dtype=np.int64),ss,tr,tt,z,z,**kwargs)


def test_long_fills_on_next_open_at_ask():
    d,m=bars();s=[1,0,0,0,0,0,0,0]
    r=run(d,s,stop=10,costs=Simulation(slippage_pips=0,stop_slippage_pips=0,swap_long_pa=0,swap_short_pa=0))
    t=r.trades[0]; assert t["entry_ts"]==d.index[1].isoformat()
    assert abs(t["entry_price"]-d.ask_open.iloc[1])<1e-12
    assert t["exit_ts"]==d.index[-1].isoformat()


def test_short_fills_at_bid_and_stop_on_ask():
    d,m=bars();r=run(d,[0,-1,0,0,0,0,0,0],stop=1, target=1,
                    costs=Simulation(slippage_pips=0,stop_slippage_pips=0,swap_long_pa=0,swap_short_pa=0))
    t=r.trades[0]; assert t["entry_price"]==d.bid_open.iloc[2]
    assert abs(t["exit_price"]-(d.bid_open.iloc[2]+.0001))<1e-12
    assert t["net_pnl"]<0 and t["exit_kind"]=="STOP"


def test_risk_cap_skips_minlot_and_compounds_by_step():
    d,m=bars();r=run(d,[0,1,0,0,0,0,0,0],stop=40)
    assert not r.trades and r.skipped_risk==1
    r=run(d,[0,1,0,0,0,0,0,0],stop=20,start_equity=100)
    assert r.trades[0]["lots"]==.01


def test_fixed_spread_long_pays_whole_spread():
    d,m=bars();r=run(d,[1,0,0,0,0,0,0,0],stop=10,
                     costs=Simulation(spread_mode="fixed",spread_pips=1.5,slippage_pips=0,
                                      stop_slippage_pips=0,swap_long_pa=0,swap_short_pa=0))
    assert abs(r.trades[0]["entry_price"]-(d.open.iloc[1]+.000075))<1e-12


def test_higher_timeframe_features_only_map_completed_buckets():
    from aai_fx.research.audusd_features import load_higher_features
    f=load_higher_features("H4")
    assert f.index.is_monotonic_increasing
    t=f.index[-200]
    d,_=bars(4);d.index=pd.date_range(t-pd.Timedelta(minutes=15),periods=4,freq="15min")
    x=regime_htf(d,"H4")
    assert x.iloc[0].equals(f[f.index<t].iloc[-1])
    assert x.iloc[1].equals(f.loc[t])


def test_breakeven_only_applies_to_following_bar():
    d,_=bars(4)
    for c in ['open','high','low','close']:
        d['bid_'+c]=.7000;d['ask_'+c]=.7001
    d.loc[d.index[1],['bid_high','bid_low','bid_close']]=[.7020,.6998,.7012]
    d.loc[d.index[2],['bid_open','ask_open','bid_low']]=[.7012,.7013,.7000]
    cost=Simulation(slippage_pips=0,stop_slippage_pips=0,commission_lot_side=0,swap_long_pa=0,swap_short_pa=0,breakeven=True)
    r=run(d,[1,0,0,0],stop=10,target=100,costs=cost)
    assert len(r.trades)==1
    assert r.trades[0]['exit_ts']==d.index[2].isoformat()
    assert abs(r.trades[0]['net_pnl'])<1e-10


def test_strict_one_percent_does_not_force_minlot():
    d,_=bars();n=len(d);z=np.zeros(n,dtype=int)
    r=simulate(d,np.array([1,0,0,0,0,0,0,0]),np.full(n,200.),np.full(n,400.),np.full(n,np.nan),z,z,
               start_equity=1000,max_risk_pct=1,force_minlot=False)
    assert not r.trades and r.skipped_risk==1


def test_cash_reconciles_after_commission_and_final_liquidation():
    d,_=bars();r=run(d,[1,0,0,0,0,0,0,0],stop=10,costs=Simulation(commission_lot_side=3.5))
    assert abs(r.metrics['ending_equity']-100-sum(t['net_pnl'] for t in r.trades))<1e-10
    assert abs(r.trades[0]['commission']-.07)<1e-10


def test_asian_percentile_uses_only_prior_sessions():
    from aai_fx.research.audusd_strategies.asian_reversal import AsianAbnormal
    # Synthetic H1 candles are enough for a strict prefix-invariance test.
    n=24*250;d,_=bars(n)
    d.index=pd.date_range('2023-01-02',periods=n,freq='h',tz='UTC')
    x=np.arange(n);v=.7+np.sin(x/11)*.001
    for col in ['open','close','high','low']:
        d[col]=v
        d['bid_'+col]=v-.00005;d['ask_'+col]=v+.00005
    base=AsianAbnormal();s=base.signals(d)
    early=d.iloc[:-24*20]
    short=AsianAbnormal();p=short.signals(early)
    assert np.array_equal(s.side[:len(early)],p.side)
    first=base.session_details.iloc[0]
    assert pd.isna(first.threshold)
    # The first available threshold is computed after at least 126 sessions.
    usable=base.session_details.threshold.dropna()
    assert len(usable)>0
    assert base.session_details.index.get_loc(usable.index[0])>=126


def test_asian_fade_and_continuation_have_exact_opposite_entries():
    from aai_fx.research.audusd_strategies.asian_reversal import AsianAbnormal
    n=24*220;d,_=bars(n);d.index=pd.date_range('2023-01-02',periods=n,freq='h',tz='UTC')
    x=np.arange(n);v=.7+np.sin(x/13)*.0005+(x//24%17)*.000001*(x%24)
    for c in ['open','close','high','low']:d[c]=v
    f=AsianAbnormal('fade').signals(d);c=AsianAbnormal('continue').signals(d)
    assert np.array_equal(f.side,-c.side)
    active=f.side!=0
    assert active.sum()>0
    assert (d.index[active].tz_convert('Europe/London').hour==7).all()
    assert np.all(f.stop_pips[active]==10) and np.all(f.target_r[active]==16)
