"""Reproducible public-data download, minute BID/ASK -> M1/M5/M15."""
import sys, json, time, lzma
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed
import urllib3
import pandas as pd
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'src'))
from aai_fx.data.dukascopy_provider import decode_bi5
ROOTOUT=ROOT/'data/dukascopy_m1';ROOTOUT.mkdir(parents=True,exist_ok=True)
CACHE=ROOT/'data/raw/dukascopy_m1/AUDUSD'
pool=urllib3.PoolManager(num_pools=2,maxsize=24)
# Weekends contain no regular session; Sundays include the NY reopen and are retained.
days=pd.date_range('2018-01-01','2026-10-30',tz='UTC')
jobs=[(d,s) for d in days if d.dayofweek!=5 for s in ['BID','ASK']]
errs=[]; done=0

def one(job):
 d,side=job;p=CACHE/side/f'{d:%Y}'/f'{d:%Y-%m-%d}.bi5'
 if p.exists():return d,side,p.read_bytes(),None
 u=f'https://datafeed.dukascopy.com/datafeed/AUDUSD/{d.year}/{d.month-1:02d}/{d.day:02d}/{side}_candles_min_1.bi5'
 for attempt in range(3):
  try:
   r=pool.request('GET',u,timeout=urllib3.Timeout(connect=8,read=15),retries=False)
   if r.status in [200,404]:
    raw=r.data if r.status==200 and r.data else b'EMPTY'
    p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(raw)
    return d,side,raw,None
  except Exception as e: error=str(e)
 return d,side,b'EMPTY',u
frames={'BID':[],'ASK':[]}
with ThreadPoolExecutor(24) as ex:
 for fut in as_completed([ex.submit(one,j) for j in jobs]):
  d,side,raw,error=fut.result();done+=1
  if error:errs.append(error)
  if raw and raw!=b'EMPTY':
   f=decode_bi5(raw,d,1e5)
   f=f[(f.volume>0)&(f.open>0)]
   if len(f):frames[side].append(f)
  if done%250==0: print('completed',done,'/',len(jobs),'errors',len(errs),flush=True)
(ROOTOUT/'download_errors.json').write_text(json.dumps({'requested_files':len(jobs),'failed_files':errs},indent=2))
if errs:
 raise RuntimeError(f'{len(errs)} daily downloads failed; raw cache preserved; no incomplete study dataset written')
# Retain separate OHLC sides, never synthesize raw bid/ask highs from midpoint.
bid=pd.concat(frames['BID']).sort_index();ask=pd.concat(frames['ASK']).sort_index()
bid=bid[~bid.index.duplicated()];ask=ask[~ask.index.duplicated()]
bid.to_parquet(ROOTOUT/'AUDUSD_BID_M1.parquet');ask.to_parquet(ROOTOUT/'AUDUSD_ASK_M1.parquet')
j=bid.join(ask,lsuffix='_bid',rsuffix='_ask',how='inner')
m=pd.DataFrame(index=j.index)
for c in ['open','high','low','close']:
 m[c]=(j[c+'_bid']+j[c+'_ask'])/2
 m['bid_'+c]=j[c+'_bid'];m['ask_'+c]=j[c+'_ask']
m['volume']=j.volume_bid
m['spread_pips']=(m.ask_open-m.bid_open)/.0001
m=m[m.spread_pips>=0]
m.to_parquet(ROOTOUT/'AUDUSD_M1.parquet')
for minutes in [5,15]:
 agg={}
 for prefix in ['', 'bid_', 'ask_']:
  agg.update({prefix+'open':'first',prefix+'high':'max',prefix+'low':'min',prefix+'close':'last'})
 agg['volume']='sum';agg['spread_pips']='median'
 r=m.resample(f'{minutes}min').agg(agg).dropna(subset=['open'])
 r.to_parquet(ROOTOUT/f'AUDUSD_M{minutes}.parquet')
meta={'source':'Dukascopy daily M1 BID/ASK','rows':len(m),'first':str(m.index[0]),'last':str(m.index[-1]),'errors':errs,'days_bid':len(bid.index.normalize().unique()),'days_ask':len(ask.index.normalize().unique())}
(ROOTOUT/'summary.json').write_text(json.dumps(meta,indent=2));print(meta,flush=True)
