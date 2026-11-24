"""Execute the separate pre-registered abnormal-session research hypothesis."""
from __future__ import annotations
import json,hashlib
from dataclasses import replace
from pathlib import Path
import pandas as pd
from . import audusd as a
from .audusd_data import load_h1
from .audusd_stats import trade_bootstrap
from .audusd_strategies.asian_reversal import AsianAbnormal


def excluded_dates(root):
    official=json.loads((root/'research/audusd/rba_dates.json').read_text())
    dates={pd.Timestamp(d) for rec in official for d in rec['dates']}
    c=pd.read_csv(root/'data/forex_factory_cache.csv',usecols=['DateTime','Currency','Event'])
    sel=(c.Currency=='USD')&c.Event.isin(['Non-Farm Employment Change','Core CPI m/m','CPI m/m','CPI y/y','Federal Funds Rate','FOMC Statement'])
    c=c[sel].copy();dt=pd.to_datetime(c.DateTime,utc=True,errors='coerce')
    # The source includes midnight placeholder times. For whole-day exclusion,
    # conservatively use BOTH its printed calendar date and converted London
    # date, rather than treating unknown times as precise release times.
    dates.update(pd.to_datetime(c.DateTime.str[:10],errors='coerce').dropna().tolist())
    dates.update(dt.dt.tz_convert('Europe/London').dt.tz_localize(None).dt.normalize().dropna().tolist())
    return dates


def run(root=None):
    root=root or a.ROOT;outdir=root/'research/audusd'
    prereg=json.loads((outdir/'asian_reversal_preregistration.json').read_text())
    source=root/'src/aai_fx/research/audusd_strategies/asian_reversal.py'
    if hashlib.sha256(source.read_bytes()).hexdigest()!=prereg['source_sha256']:
        raise RuntimeError('Rules changed after preregistration; freeze a new labelled hypothesis before testing')
    existing=json.loads((outdir/'results.json').read_text())
    a.LOG_TRIALS=True
    a.TRIAL_COUNT=sum(1 for _ in (outdir/'trial_ledger_final.jsonl').open())
    h=load_h1(root);exclude=excluded_dates(root);results=[]
    for cohort in ['all_to_2026','paired_all_to_Apr2025','paired_ex_news_to_Apr2025']:
        df=h if cohort=='all_to_2026' else h[h.index<pd.Timestamp('2025-04-08',tz='UTC')]
        for direction in ['fade','continue']:
            obj=AsianAbnormal(direction,cohort);sig=obj.signals(df)
            abnormal=obj.session_details
            if cohort=='paired_ex_news_to_Apr2025':
                bad=abnormal[abnormal.index.isin(exclude)].signal
                sig.side[df.index.isin(bad)]=0
            r={'id':f'ASIA_{cohort}_{direction}','params':obj.params,'results':{},
               'abnormal_eligible_sessions':int((sig.side!=0).sum()),'source':'Dukascopy H1 recorded BID/ASK; minute/tick confirmation unavailable'}
            abnormal.to_csv(outdir/f'{r["id"]}_sessions.csv')
            for eq in [100,1000]:
                r['results'][str(eq)]={}
                for seg,st,en in [('full',a.START,None),('is',a.START,a.SPLIT),('oos',a.SPLIT,None)]:
                    x,m=a.execute(df,sig,obj,st,en,eq,risk_cap_override=2 if eq==100 else 1)
                    r['results'][str(eq)][seg]=m
                    if seg=='oos':
                        pd.DataFrame(x.trades).to_csv(outdir/f'{r["id"]}_{eq}_oos_trades.csv',index=False)
                        if eq==1000:r['bootstrap']=trade_bootstrap(x.trades)
            sens={}
            for name,cost in [('allin_1pip',replace(a.BASE,spread_mode='fixed',spread_pips=.3)),('allin_1_5pip',replace(a.BASE,spread_mode='fixed',spread_pips=.8)),('high_slippage',replace(a.BASE,slippage_pips=.5,stop_slippage_pips=1.))]:
                _,m=a.execute(df,sig,obj,a.SPLIT,None,1000,cost,risk_cap_override=1);sens[name]=m
            r['oos_cost_sensitivity_1000']=sens;results.append(r)
            print(r['id'],'OOS',r['results']['1000']['oos']['trade_count'],r['results']['1000']['oos'].get('expectancy_r'),flush=True)
    extension={'status':'Pre-registered hypothesis, NOT approved live rules','preregistration':prereg,'variants':results,
        'news_filter_caveat':'Official RBA dates; secondary US dates are incomplete and midnight placeholders conservatively unioned with source dates. Paired arms end Apr 7 2025; no false news-free labels after calendar coverage.',
        'confirmation':'No untouched historical confirmation available; prospective holdout not performed. Any demo is operational evidence, not proof of profitability.'}
    existing['asian_reversal_hypothesis']=extension
    existing['trial_count_final']=a.TRIAL_COUNT
    existing['total_simulation_calls_including_reconstructed_prior_passes']=a.TRIAL_COUNT+1196
    existing['generated_at_CT']=pd.Timestamp.now(tz='America/Chicago').isoformat()
    (outdir/'results.json').write_text(json.dumps(a.clean(existing),indent=2,allow_nan=False))
    (outdir/'asian_reversal_results.json').write_text(json.dumps(a.clean(extension),indent=2,allow_nan=False))
    print('total final ledger',a.TRIAL_COUNT,flush=True)
    return extension
