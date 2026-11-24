"""Causal higher-timeframe features from existing long Dukascopy H1 data."""
from functools import lru_cache
from pathlib import Path
import numpy as np
import pandas as pd
from ..strategies.zoora import ema_warmup_bars

ROOT=Path(__file__).resolve().parents[3]
@lru_cache(8)
def load_higher_features(tf:str, fast:int=200, slow:int=800):
    h=pd.read_parquet(ROOT/'data/dukascopy/H1/AUDUSD.parquet')
    local=h.index.tz_convert('America/New_York').tz_localize(None)+pd.Timedelta(hours=7)
    hours=24 if tf=='D1' else 4
    key=local.floor(f'{hours}h')
    x=h.assign(key=key,available=h.index+pd.Timedelta(hours=1))
    g=x.groupby('key').agg(open=('open','first'),high=('high','max'),low=('low','min'),close=('close','last'),n=('close','size'),available=('available','max'))
    # Bucket availability is true NY+7 close. Reject incomplete buckets at edges;
    # 75% minimum covers holidays and feed gaps, flagged separately in report.
    g=g[g.n>=hours*.75]
    closed_local=pd.DatetimeIndex(g.index)+pd.Timedelta(hours=hours)-pd.Timedelta(hours=7)
    availability=closed_local.tz_localize('America/New_York',ambiguous='NaT',nonexistent='shift_forward').tz_convert('UTC')
    g=g[~availability.isna()];availability=availability[~availability.isna()]
    ef=g.close.ewm(span=fast,adjust=False).mean();es=g.close.ewm(span=slow,adjust=False).mean()
    reg=np.where((g.close>es)&(ef>es),1,np.where((g.close<es)&(ef<es),-1,0)).astype(float)
    reg[:ema_warmup_bars(slow)]=np.nan
    f=pd.DataFrame({'regime':reg,'ema_fast':ef.to_numpy(),'ema_slow':es.to_numpy(),'htf_close':g.close.to_numpy(),'htf_atr':(g.high-g.low).ewm(alpha=1/14,adjust=False).mean().to_numpy()},index=availability)
    return f.sort_index()
