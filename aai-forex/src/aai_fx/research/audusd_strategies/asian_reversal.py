"""Pre-registered Asian abnormal-session fade hypothesis, NOT approved rules.

Extrapolation of Caporale & Plastun (JES-11-2019-0503), not a replication.
Tokyo 09:00 (00:00 UTC) -> London 08:00 session; H1 execution only.
"""
from __future__ import annotations
import numpy as np
import pandas as pd
from .common import Signals


class AsianAbnormal:
    family='ASIA_ABNORMAL_HYPOTHESIS'
    def __init__(self,direction:str='fade',cohort:str='all_to_2026'):
        if direction not in ['fade','continue']:raise ValueError(direction)
        self.params={'direction':direction,'cohort':cohort,'percentile':.90,'lookback_sessions':252,
                     'min_history_sessions':126,'stop_pips':10,'target_pips':16,
                     'asia_start':'00:00 UTC (09:00 Tokyo)','entry':'08:00 Europe/London',
                     'flat_by':'12:00 Europe/London','hypothesis_only':True}
        self.session_details=pd.DataFrame()

    def signals(self,df):
        # This precise alignment requires complete H1 bars; no upsampling or
        # fabricated minute history. London local date controls each session.
        if df.index.to_series().diff().median()!=pd.Timedelta(hours=1):
            raise ValueError('Pre-registered H1 study only; minute execution not validated')
        local=df.index.tz_convert('Europe/London');date=local.tz_localize(None).normalize()
        rows=[]
        for day,g in df.assign(_day=date).groupby('_day'):
            lo=pd.Timestamp(day).tz_localize('Europe/London').tz_convert('UTC')
            entry=lo+pd.Timedelta(hours=8)
            # On DST-transition Sundays there is no normal complete session;
            # calculate 08:00 as a local civil time rather than +8 elapsed h.
            entry=(pd.Timestamp(day)+pd.Timedelta(hours=8)).tz_localize('Europe/London',nonexistent='shift_forward').tz_convert('UTC')
            begin=pd.Timestamp(day).tz_localize('UTC')
            asia=g[(g.index>=begin)&(g.index<entry)]
            expected=int((entry-begin).total_seconds()/3600)
            if len(asia)!=expected or expected not in [7,8] or day.dayofweek>=5:continue
            signal=entry-pd.Timedelta(hours=1)
            lunch=(pd.Timestamp(day)+pd.Timedelta(hours=12)).tz_localize('Europe/London').tz_convert('UTC')
            if signal not in df.index or entry not in df.index:continue
            move=(asia.close.iloc[-1]-asia.open.iloc[0])/.0001
            rows.append({'day':day,'move_pips':move,'signal':signal,'entry':entry,'lunch':lunch})
        daily=pd.DataFrame(rows).set_index('day').sort_index()
        daily['threshold']=daily.move_pips.abs().shift(1).rolling(252,min_periods=126).quantile(.90)
        daily['abnormal']=daily.move_pips.abs()>daily.threshold
        self.session_details=daily
        out=Signals.blank(len(df));loc={t:i for i,t in enumerate(df.index)}
        direction=-1 if self.params['direction']=='fade' else 1
        for day,r in daily[daily.abnormal].iterrows():
            i=loc[r.signal];side=direction*int(np.sign(r.move_pips))
            if side==0:continue
            out.side[i]=side;out.stop_pips[i]=10;out.target_r[i]=16
            # Bar opening 11 London closes at noon; liquidation at next open.
            close_signal=r.lunch-pd.Timedelta(hours=1)
            if close_signal in loc:out.eod[loc[close_signal]]=1
        out.max_bars=4
        out.metadata=self.params
        return out
