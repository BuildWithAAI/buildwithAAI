"""Assemble only stored public candles; never contact MT5."""
from pathlib import Path
import pandas as pd
from ..data.dukascopy_provider import decode_bi5

def load_h1(root:Path):
    sides={}
    for side in ['BID','ASK']:
        frames=[]
        for pp in sorted((root/'data/raw/dukascopy/AUDUSD'/side).glob('*.bi5')):
            if pp.stem>'2026-10':continue
            raw=pp.read_bytes()
            if raw and raw!=b'EMPTY':frames.append(decode_bi5(raw,pd.Timestamp(pp.stem+'-01',tz='UTC'),1e5))
        x=pd.concat(frames).sort_index();x=x[(x.volume>0)&(~x.index.duplicated())]
        sides[side]=x
    j=sides['BID'].join(sides['ASK'],lsuffix='_bid',rsuffix='_ask',how='inner')
    out=pd.DataFrame(index=j.index)
    for c in ['open','high','low','close']:
        out[c]=(j[c+'_bid']+j[c+'_ask'])/2
        out['bid_'+c]=j[c+'_bid'];out['ask_'+c]=j[c+'_ask']
    out['volume']=j.volume_bid;out['spread_pips']=(out.ask_open-out.bid_open)/.0001
    return out[(out.spread_pips>=0)&(out.index<'2026-11-01')]

def load_yahoo(root:Path,tf:str,spread:float=1.15):
    d=pd.read_parquet(root/f'data/yfinance/{tf}/AUDUSD.parquet').copy()
    for c in ['open','high','low','close']:
        d['bid_'+c]=d[c]-spread*.00005;d['ask_'+c]=d[c]+spread*.00005
    d['spread_pips']=spread
    return d
