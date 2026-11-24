"""Reproducible four-family AUDUSD study. Historical/paper only."""
from __future__ import annotations
import json, time, hashlib
from dataclasses import asdict, replace
from pathlib import Path
import numpy as np
import pandas as pd
from .audusd_engine import simulate, Simulation
from .audusd_data import load_h1,load_yahoo
from .audusd_stats import characterize,trade_bootstrap
from .audusd_strategies.scalp import Scalp
from .audusd_strategies.sniper import Sniper
from .audusd_strategies.swing import Swing
from .audusd_strategies.pico import Pico
from .audusd_strategies.common import Signals

ROOT=Path(__file__).resolve().parents[3]
OUT=ROOT/'research/audusd'
START=pd.Timestamp('2018-01-01',tz='UTC');SPLIT=pd.Timestamp('2023-06-30',tz='UTC')
BASE=Simulation(commission_lot_side=3.5)
TRIAL_COUNT=0
LOG_TRIALS=False


def variants(tf='H1'):
    look=2 if tf=='H1' else 6
    return [Scalp(session=s,stop=st,target=t,lookback=look) for s in ['london','ny'] for st,t in [(10,20),(15,30)]]+[
        Sniper(level=l,stop=12,target=3,htf=h) for h in ['H4','D1'] for l in ['ema','ema_or_day']]+[
        Swing('H4','pullback',20,30),Swing('H4','pullback',20,45),Swing('H4','breakout',25,45),
        Swing('D1','pullback',20,45),Swing('D1','breakout',25,45),
        Swing('H4','pullback',20,45,fast=198,slow=792),
        Swing('H4','pullback',20,100000,target=5),Swing('H4','pullback',30,45)]


def execute(df,sig,obj,start=None,end=None,equity=100,costs=BASE,risk_cap_override=None):
    if obj.family in ['SNIPER','SWING']:costs=replace(costs,breakeven=True)
    x=simulate(df,sig.side,sig.stop_pips,sig.target_r,sig.trail_pips,sig.regime_exit,sig.eod,
        start=start,end=end,max_bars=sig.max_bars,start_equity=equity,
        risk_pct=1,max_risk_pct=risk_cap_override if risk_cap_override is not None else (3 if equity==100 else 1),force_minlot=equity==100,costs=costs)
    m=x.summary()
    m['trades_ge100_net_pips']=sum((t['exit_price']-t['entry_price'])*t['side']/.0001>=100 for t in x.trades)
    m['best_trade_net_r']=max([t['r_multiple'] for t in x.trades],default=None)
    m['average_calendar_holding_hours']=float(np.mean([(pd.Timestamp(t['exit_ts'])-pd.Timestamp(t['entry_ts'])).total_seconds()/3600 for t in x.trades])) if x.trades else None
    running=equity;riskp=[]
    for t in x.trades:
        riskp.append(100*t['initial_risk']/running)
        running+=t['net_pnl']
    m['initial_risk_pct_median']=float(np.median(riskp)) if riskp else None
    m['initial_risk_pct_max']=max(riskp,default=None)
    if LOG_TRIALS:
        global TRIAL_COUNT
        TRIAL_COUNT+=1
        rec={'trial':TRIAL_COUNT,'family':obj.family,'params':obj.params,'bar_minutes':float(df.index.to_series().diff().dropna().median().total_seconds()/60),
             'first_data':str(df.index[0]),'last_data':str(df.index[-1]),'start':str(start),'end':str(end),'equity':equity,
             'max_risk_pct':risk_cap_override if risk_cap_override is not None else (3 if equity==100 else 1),
             'costs':asdict(costs),'metrics':m}
        with (OUT/'trial_ledger_final.jsonl').open('a') as f:f.write(json.dumps(clean(rec),allow_nan=False)+'\n')
    return x,m


def clean(x):
    if isinstance(x,dict):return {str(k):clean(v) for k,v in x.items()}
    if isinstance(x,(list,tuple)):return [clean(v) for v in x]
    if isinstance(x,np.ndarray):return clean(x.tolist())
    if isinstance(x,(np.integer,np.bool_)):return x.item()
    if isinstance(x,(float,np.floating)):return float(x) if np.isfinite(x) else None
    if isinstance(x,(pd.Timestamp,Path)):return str(x)
    return x


def main():
    OUT.mkdir(parents=True,exist_ok=True)
    global LOG_TRIALS,TRIAL_COUNT
    LOG_TRIALS=True;TRIAL_COUNT=0
    (OUT/'trial_ledger_final.jsonl').write_text('')
    h=load_h1(ROOT)
    print('H1',len(h),h.index[0],h.index[-1],flush=True)
    desc=characterize(h)
    (OUT/'characterization.json').write_text(json.dumps(clean(desc),indent=2))
    results=[];objs=variants('H1');sigmap={}
    for j,obj in enumerate(objs):
        sig=obj.signals(h);sigmap[j]=sig
        r={'id':f'H1_{j:02d}','family':obj.family,'timeframe':'H1','source':'Dukascopy recorded BID/ASK','params':obj.params,'results':{}}
        for eq in [100,1000]:
            acc={}
            for seg,st,en in [('full',START,None),('is',START,SPLIT),('oos',SPLIT,None)]:
                x,m=execute(h,sig,obj,st,en,eq);acc[seg]=m
                if seg=='oos':
                    if eq==1000:r['bootstrap']=trade_bootstrap(x.trades)
                    pd.DataFrame(x.trades).to_csv(OUT/f'{r["id"]}_{eq}_oos_trades.csv',index=False)
            r['results'][str(eq)]=acc
        stress={}
        for name,cost in [('spread_08',replace(BASE,spread_mode='fixed',spread_pips=.8)),('spread_15',replace(BASE,spread_mode='fixed',spread_pips=1.5)),('no_commission',replace(BASE,commission_lot_side=0)),('high_slippage',replace(BASE,slippage_pips=.5,stop_slippage_pips=1.)),('zero_friction',replace(BASE,spread_mode='fixed',spread_pips=0,slippage_pips=0,stop_slippage_pips=0,commission_lot_side=0,swap_long_pa=0,swap_short_pa=0))]:
            _,m=execute(h,sig,obj,SPLIT,None,1000,cost);stress[name]=m
        r['oos_cost_sensitivity_1000']=stress
        _,guard=execute(h,sig,obj,SPLIT,None,100,BASE,risk_cap_override=2)
        r['current_guard_2pct_oos_100']=guard
        stop=obj.params['stop_pips']
        minrisk=(stop+BASE.stop_slippage_pips)*.1+BASE.commission_lot_side*.02
        r['minlot_initial_risk_dollars']=minrisk
        r['feasible_at_100_current_2pct']=bool(minrisk<=2)
        r['feasible_at_100_research_3pct']=bool(minrisk<=3)
        results.append(r)
        (OUT/'partial_results.json').write_text(json.dumps(clean(results),indent=1))
        print(r['id'],obj.family,'OOS',r['results']['100']['oos']['ending_equity'],r['results']['1000']['oos'].get('expectancy_r'),flush=True)
    # Strictly backward-looking 3y training / 1y test family selection. Min 25
    # train trades, positive net expectancy or remain in cash; one continuous
    # account, next-open closes at selection changes, no account resetting.
    wf={};chosen={}
    for family in ['SCALP','SNIPER','SWING']:
        ids=[j for j,o in enumerate(objs) if o.family==family]
        combined=Signals.blank(len(h));windows=[]
        for year in range(2021,2027):
            t=pd.Timestamp(f'{year}-01-01',tz='UTC');en=pd.Timestamp(f'{year+1}-01-01',tz='UTC');tr=t-pd.DateOffset(years=3)
            candidates=[]
            for j in ids:
                _,m=execute(h,sigmap[j],objs[j],tr,t,1000)
                if m['trade_count']>=25 and m.get('expectancy_r',-1)>0:candidates.append((m['expectancy_r'],j))
            best=max(candidates)[1] if candidates else None
            windows.append({'train_start':str(tr),'test_year':year,'chosen_id':f'H1_{best:02d}' if best is not None else 'CASH'})
            k=(h.index>=t)&(h.index<en)
            if best is not None:
                sig=sigmap[best]
                for attr in ['side','stop_pips','target_r','trail_pips','regime_exit','eod']:getattr(combined,attr)[k]=getattr(sig,attr)[k]
            # Break at the prior known close before a calendar boundary; no
            # future price enters the selection decision. Avoid year spanning rule drift.
            ix=np.where(k)[0]
            if len(ix):combined.eod[ix[-1]]=1
        rr={'windows':windows,'accounts':{}}
        for eq in [100,1000]:
            x,m=execute(h,combined,objs[ids[0]],pd.Timestamp('2021-01-01',tz='UTC'),None,eq)
            rr['accounts'][str(eq)]=m
            pd.DataFrame(x.trades).to_csv(OUT/f'walkforward_{family}_{eq}_trades.csv',index=False)
        wf[family]=rr
        # Champion chosen ONLY on IS strict-1% results, without inspecting OOS.
        eligible=[r for r in results if r['family']==family and r['results']['1000']['is']['trade_count']>=25]
        if eligible:chosen[family]=max(eligible,key=lambda r:r['results']['1000']['is'].get('expectancy_r',-999))['id']
    # Short intraday checks are not called long OOS proof; independent 70/30
    # chronological split of available stored mid-price history, fixed costs.
    intraday=[]
    for tf in ['M15','M5']:
        d=load_yahoo(ROOT,tf);split=d.index[int(.7*len(d))]
        vv=variants('M15') if tf=='M15' else [Pico(stop=st,target=tar,lookback=2,session=ses,minutes=15) for ses in ['london','ny'] for st,tar in [(4,5),(6,10)]]
        for j,obj in enumerate(vv):
            sig=obj.signals(d)
            if tf=='M5':sig.max_bars=3 # three M5 bars = 15 minutes, not 15 bars
            r={'id':f'{tf}_{j:02d}','family':obj.family,'timeframe':tf,'source':'stored Yahoo indicative mid + synthetic spread','params':obj.params,
               'data_start':str(d.index[0]),'split':str(split),'data_end':str(d.index[-1]),'results':{}}
            for eq in [100,1000]:
                r['results'][str(eq)]={}
                for seg,st,en in [('full',None,None),('is',None,split),('oos',split,None)]:
                    x,m=execute(d,sig,obj,st,en,eq,replace(BASE,spread_mode='fixed',spread_pips=1.15));r['results'][str(eq)][seg]=m
                if tf=='M5':
                    r.setdefault('cost_sensitivity',{})[str(eq)]={}
                    for sp in [.8,1.5]:
                        _,m=execute(d,sig,obj,None,None,eq,replace(BASE,spread_mode='fixed',spread_pips=sp))
                        r['cost_sensitivity'][str(eq)][str(sp)]=m
            if tf=='M5':
                _,guard=execute(d,sig,obj,split,None,100,replace(BASE,spread_mode='fixed',spread_pips=1.15),risk_cap_override=2)
                r['current_guard_2pct_oos_100']=guard
            intraday.append(r)
            print(r['id'],obj.family,'short OOS',r['results']['1000']['oos'].get('expectancy_r'),flush=True)
    out={'generated_at_CT':pd.Timestamp.now(tz='America/Chicago').isoformat(),'protocol':'experimental_protocol.md; final rules and deviations in report.md',
         'base_costs':asdict(BASE),'start':str(START),'oos_start':str(SPLIT),'data':{'H1_rows':len(h),'start':str(h.index[0]),'end':str(h.index[-1]),
         'M1_unusable':'Dukascopy download interrupted by TLS errors; stored Yahoo M1 has mostly 2-minute cadence and is not used'},
         'trial_count_final':TRIAL_COUNT,'prior_exploratory_passes':[{'completed_pass':1,'models':34,'simulation_calls_reconstructed':391,'note':'15 H1 +15 M15 +4 M5; prior-day-level bug used highest/lowest CLOSE, corrected to actual highs/lows; original full output snapshot not retained'},
         {'completed_pass':2,'models':34,'simulation_calls_reconstructed':391,'note':'Corrected highs/lows; repeated to verify accounting and cost metadata; original full output snapshot not retained'},
         {'completed_pass':3,'models':36,'simulation_calls_reconstructed':414,'note':'Added 30-pip zero-trade control and official RBA descriptive statistics; result snapshots superseded by fully logged final pass'}],
         'pristine_holdout_available':False,'holdout_note':'All available historical periods overlap earlier Zoora research. No period relabelled as untouched. A prospective frozen-rule broker-data holdout remains unperformed.',
         'characterization':desc,'h1_variants':results,'walkforward':wf,'is_selected_champions':chosen,'short_intraday_checks':intraday}
    out['total_simulation_calls_including_reconstructed_prior_passes']=TRIAL_COUNT+1196
    (OUT/'results.json').write_text(json.dumps(clean(out),indent=2,allow_nan=False))
    files=sorted((ROOT/'src/aai_fx/research').glob('audusd*.py'))+sorted((ROOT/'src/aai_fx/research/audusd_strategies').glob('*.py'))+[ROOT/'configs/audusd.yaml']
    frozen={'frozen_at_CT':pd.Timestamp.now(tz='America/Chicago').isoformat(),
            'scope':'Prospective holdout protocol only. No unseen forward observations collected; no demo task started.',
            'historical_tests_not_pristine':True,'base_costs':asdict(BASE),
            'h1_variant_parameters':[o.params for o in objs],
            'file_sha256':{str(p.relative_to(ROOT)):hashlib.sha256(p.read_bytes()).hexdigest() for p in files},
            'future_rule':'Do not retune rules, costs or pick winners after observing the prospective sample. Demo fills are operational evidence, not profit proof.'}
    (OUT/'frozen_protocol.json').write_text(json.dumps(clean(frozen),indent=2))
    from .audusd_reversal import run as run_reversal
    run_reversal(ROOT)
    from .audusd_report import write_report
    write_report(ROOT)
    print('DONE',OUT/'results.json',flush=True)
    return out
