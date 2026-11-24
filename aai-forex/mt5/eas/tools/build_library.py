"""Reproducible generator for local, uncompiled MQL5 research artifacts."""
from pathlib import Path
import json
ROOT=Path(__file__).resolve().parents[1]
strategies=[]
def add(slug,name,family,style,tf,logic,rationale,failure,inputs,init,ready,signal,exitcode='',defaults=None,params='',valid='true',ranges=''):
    strategies.append(dict(slug=slug,name=name,family=family,style=style,tf=tf,logic=logic,rationale=rationale,failure=failure,inputs=inputs,init=init,ready=ready,signal=signal,exitcode=exitcode,defaults=defaults or {},params=params,valid=valid,ranges=ranges))
add('ZooraTrend','Zoora Regime Transition','EMA regime','swing','H4',
'Enter only when the completed close/EMA200/EMA800 regime changes to +1 or -1. Stop 3 ATR, no target; exit when regime no longer matches. No automatic re-entry after a stop.',
'Persistent repricing can produce multi-day directional runs; a slow regime attempts to avoid small fluctuations.',
'Lag and repeated regime flips in ranges; wide stops commonly exceed $100 minimum-lot budget.',
'input int FastEMA=200; // Alternative 198\ninput int SlowEMA=800; // Alternative 792',
'f=MA(SignalTF,FastEMA);s=MA(SignalTF,SlowEMA);',
'Ready(f,FastEMA*3) && Ready(s,SlowEMA*3)',
'''int now=Regime(f,s,SignalTF,1),prior=Regime(f,s,SignalTF,2);
 stop=3.0*ATR();target=0;
 return now!=0 && now!=prior?now:0;''',
'''int regime=Regime(f,s,SignalTF);if(aai_data_ok && regime!=side){CloseOwn();return true;}''',
{'TARGET':0,'HOLD':0},'int f,s;', 'FastEMA>=2 && SlowEMA>FastEMA && SlowEMA<=2000','EMA pairs 200/800 or 198/792 only; 3 ATR stop is fixed in code (a separate trial if changed).')
add('ZooraPullback','Zoora ATR-Band Pullback','EMA pullback','scalp/sniper','H1',
'In completed H4 Zoora regime, buy a signal bar that touches the H4 fast EMA plus a 0.25 ATR band and closes back above; short is symmetric. Stop StopATR times signal ATR; 2R target; regime-change exit.',
'Trend pullbacks may offer lower entry risk than chasing extensions.',
'An apparent pullback can become a reversal; H4 levels are deliberately delayed until completed.',
'input int FastEMA=200;\ninput int SlowEMA=800;\ninput double BandATR=0.25;',
'f=MA(PERIOD_H4,FastEMA);s=MA(PERIOD_H4,SlowEMA);',
'Ready(f,FastEMA*3) && Ready(s,SlowEMA*3)',
'''int r=Regime(f,s,PERIOD_H4);double level=Buf(f),a=ATR();stop=StopATR*a;target=2*stop;
 if(r==1 && bar[1].low<=level+BandATR*a && bar[1].high>=level-BandATR*a && bar[1].close>level && bar[1].close>bar[1].open)return 1;
 if(r==-1 && bar[1].high>=level-BandATR*a && bar[1].low<=level+BandATR*a && bar[1].close<level && bar[1].close<bar[1].open)return -1;
 return 0;''',
'''int r=Regime(f,s,PERIOD_H4);if(aai_data_ok && r!=side){CloseOwn();return true;}''',
params='int f,s;',valid='FastEMA>=2 && SlowEMA>FastEMA && SlowEMA<=2000 && BandATR>=0 && BandATR<=2',ranges='BandATR 0.1-0.5; StopATR 1-2.5; EMA pair 200/800 or 198/792.')
add('ZooraSniper','Zoora H4-Level Sniper','level plus breakout','sniper','H1',
'Completed H4 Zoora regime. Long H1 range overlaps H4 EMA200 +/-5 pips and closes above prior two H1 highs; short overlaps EMA800 and closes below prior two lows. Signal-bar opens in first three London/NY hours. 12-pip SL, 36-pip TP; completed-close BE at +1R; exit on regime change.',
'Combines directional persistence, a pullback to a slow reference level, and local confirmation. This is the least-bad earlier research hypothesis, not an edge.',
'Only 45 earlier proxy OOS trades, roughly breakeven and cost-fragile; exact execution and UTC/day definitions differ from Python.',
'input int FastEMA=200;\ninput int SlowEMA=800;\ninput double LevelBandPips=5.0;',
'f=MA(PERIOD_H4,FastEMA);s=MA(PERIOD_H4,SlowEMA);',
'Ready(f,FastEMA*3) && Ready(s,SlowEMA*3)',
'''if(!LondonSignal(bar[1].time) && !NYSignal(bar[1].time))return 0;
 int r=Regime(f,s,PERIOD_H4);double level=(r>0?Buf(f):Buf(s));double b=LevelBandPips*Pip();
 if(bar[1].low>level+b || bar[1].high<level-b)return 0;
 if(r==1 && bar[1].close>HighN(2,2))return 1;
 if(r==-1 && bar[1].close<LowN(2,2))return -1;return 0;''',
'''int r=Regime(f,s,PERIOD_H4);if(aai_data_ok && r!=side){CloseOwn();return true;}''',
{'STOP':12,'TARGET':36,'BE':1,'HOLD':0},'int f,s;', 'SignalTF==PERIOD_H1 && FastEMA>=2 && SlowEMA>FastEMA && SlowEMA<=2000 && LevelBandPips>0','Freeze 12/36 and 5-pip band first; EMA 198/792 is one separately logged sensitivity.')
add('AsianRangeBreakout','Asian Range Expansion','session range breakout','scalp','M15',
'Build complete UTC 00:00-06:00 M5 range. Between range end and first three London hours, enter a new completed-close break beyond the range plus buffer; 12-pip SL, 25-pip TP, max 6h.',
'Quiet-session inventory can unwind when London liquidity arrives.',
'False breaks and news reversals; fixed UTC Asia definition is not local Sydney time.',
'input int AsiaStartUTC=0;\ninput int AsiaEndUTC=6;\ninput double BufferPips=1.0;', '', 'true',
'''double hi,lo;if(!LondonSignal(bar[1].time) || !DayRange(AsiaStartUTC,AsiaEndUTC,hi,lo))return 0;
 double b=BufferPips*Pip();
 if(bar[1].close>hi+b && bar[2].close<=hi+b)return 1;
 if(bar[1].close<lo-b && bar[2].close>=lo-b)return -1;return 0;''',defaults={'TARGET':25},valid='AsiaStartUTC>=0 && AsiaEndUTC>AsiaStartUTC && AsiaEndUTC<=24 && BufferPips>=0',ranges='Asia end 5-7 UTC; buffer 0.5-2; stop 8-16, target 20-30 pips.')
add('LondonOpeningRange','London First-Hour ORB','opening range breakout','scalp','M15',
'Build the first full London hour from M5 bars, then trade a completed-close escape during the next two hours. Initial stop is max(StopPips, half opening-range width); target 2R.',
'The initial high-liquidity auction may define a range whose escape marks committed flow.',
'Opening-range noise and unusually broad ranges; not equivalent to the pre-London Asian breakout.',
'input double BufferPips=1.0;', '', 'true',
'''int h=HourUTC(bar[1].time);int end=LondonOpenHourUTC+1;
 if(end>23 || !InHours(h,end,(end+2)%24))return 0;
 double hi,lo;if(!DayRange(LondonOpenHourUTC,end,hi,lo))return 0;
 stop=MathMax(StopPips*Pip(),(hi-lo)*0.5);target=2*stop;double b=BufferPips*Pip();
 if(bar[1].close>hi+b && bar[2].close<=hi+b)return 1;
 if(bar[1].close<lo-b && bar[2].close>=lo-b)return -1;return 0;''',valid='BufferPips>=0',ranges='Buffer 0-2 pips; minimum stop 8-15 pips. Freeze one London/DST schedule.')
add('NYImpulse','New York Impulse Continuation','volatility impulse','scalp','M5',
'First two NY hours: a fresh candle body >=0.8 ATR, >1.5 times prior body, close in outer 20% of its range and correct side of EMA50. Enter next bar, 10-pip stop/25-pip target, max 90 min.',
'Large one-sided opening flow can continue while participants adjust inventories.',
'Exhaustion candles and news spread/slippage; no future candle confirmation is used.',
'input int TrendEMA=50;\ninput double BodyATR=0.8;', 'f=MA(SignalTF,TrendEMA);','Ready(f,TrendEMA*3)',
'''if(!NYSignal(bar[1].time,2))return 0;
 double body=bar[1].close-bar[1].open,range=bar[1].high-bar[1].low;
 if(range<=0 || MathAbs(body)<BodyATR*ATR() || MathAbs(body)<1.5*MathAbs(bar[2].close-bar[2].open))return 0;
 double e=Buf(f);
 if(body>0 && bar[1].close>e && bar[1].close>=bar[1].high-0.2*range)return 1;
 if(body<0 && bar[1].close<e && bar[1].close<=bar[1].low+0.2*range)return -1;return 0;''',defaults={'STOP':10,'TARGET':25,'HOLD':90},params='int f;',valid='TrendEMA>=5 && TrendEMA<=500 && BodyATR>0 && BodyATR<=3',ranges='BodyATR 0.6-1.2; EMA 30-80; stop 8-12, target 20-30 pips.')
add('PriorDayBreakout','Prior-Day Extreme Breakout','daily structure breakout','swing','H1',
'New completed-close break above prior broker-D1 high or below low, with EMA50 slope aligned. Stop 2 ATR, no target; 35-pip close trail after +1R; max 3 days.',
'Daily extremes can attract stop orders and signal multi-session repricing.',
'Failed breaks, broker day-boundary dependence and overnight swaps.',
'input int TrendEMA=50;\ninput double BufferPips=1.0;', 'f=MA(SignalTF,TrendEMA);','Ready(f,TrendEMA*3)',
'''double hi,lo;if(!PriorDay(hi,lo))return 0;double b=BufferPips*Pip();double e=Buf(f),old=Buf(f,0,3);
 stop=2*ATR();target=0;
 if(bar[1].close>hi+b && bar[2].close<=hi+b && e>old)return 1;
 if(bar[1].close<lo-b && bar[2].close>=lo-b && e<old)return -1;return 0;''',defaults={'TARGET':0,'TRAIL':35,'HOLD':4320},params='int f;',valid='TrendEMA>=5 && TrendEMA<=500 && BufferPips>=0',ranges='Buffer 0-3 pips; EMA 30-100; trail 25-60 pips.')
add('PriorDayFade','Prior-Day Liquidity Sweep Fade','failed breakout reversal','sniper','M15',
'Signal wick sweeps prior broker-D1 extreme by at least buffer, then closes back inside with reversal body. Stop beyond wick plus buffer; target 3R, max 4h.',
'An unsuccessful stop-run can trap breakout traders and reverse into the range.',
'A genuine trend may resume after the rejection; structural stop can be unaffordable.',
'input double SweepPips=1.0;\ninput double WickBufferPips=1.0;', '', 'true',
'''double hi,lo;if(!PriorDay(hi,lo))return 0;MqlTick q;if(!SymbolInfoTick(_Symbol,q))return 0;
 if(bar[1].low<lo-SweepPips*Pip() && bar[1].close>lo && bar[1].close>bar[1].open)
 {stop=q.ask-(bar[1].low-WickBufferPips*Pip());target=3*stop;return 1;}
 if(bar[1].high>hi+SweepPips*Pip() && bar[1].close<hi && bar[1].close<bar[1].open)
 {stop=(bar[1].high+WickBufferPips*Pip())-q.bid;target=3*stop;return -1;}return 0;''',defaults={'HOLD':240},valid='SweepPips>=0 && WickBufferPips>0',ranges='Sweep 0.5-3 and wick buffer 0.5-2 pips; fixed 3R first.')
add('DonchianTurtle','Donchian 20/10 Turtle','channel trend following','swing','H4',
'Completed close above previous 20 highs/below lows enters. Initial SL 2 ATR, no target; exit on completed close beyond the opposite prior 10-bar channel; no pyramiding.',
'Price channel escape is a simple response to directional persistence independent of EMA levels.',
'Frequent small range-bound losses and very wide stops for $100.',
'input int EntryBars=20;\ninput int ExitBars=10;', '', 'true',
'''stop=2*ATR();target=0;
 if(bar[1].close>HighN(2,EntryBars) && bar[2].close<=HighN(3,EntryBars))return 1;
 if(bar[1].close<LowN(2,EntryBars) && bar[2].close>=LowN(3,EntryBars))return -1;return 0;''',
'''if((side==1 && bar[1].close<LowN(2,ExitBars)) || (side==-1 && bar[1].close>HighN(2,ExitBars))){CloseOwn();return true;}''',
{'TARGET':0,'HOLD':0},valid='EntryBars>=3 && EntryBars<=200 && ExitBars>=2 && ExitBars<EntryBars',ranges='Entry 15-55; exit 5-20, always shorter than entry. Sparse prespecified grid only.')
add('BollingerPico','Bollinger Re-entry Pico','short-horizon mean reversion','pico','M1',
'In flat EMA50 conditions (3-bar slope <0.15 ATR), prior close outside 2-sigma Bollinger band and latest close back inside enters toward mean. 5-pip SL/8-pip TP, max 10 min.',
'Short liquidity shocks may overshoot a slowly moving local equilibrium.',
'Costs consume much of an 8-pip target; repeated band-walking in trends.',
'input int BandPeriod=20;\ninput double BandDeviation=2.0;',
'bands=KeepHandle(iBands(_Symbol,SignalTF,BandPeriod,0,BandDeviation,PRICE_CLOSE));f=MA(SignalTF,50);',
'Ready(bands,BandPeriod*3) && Ready(f,150)',
'''if(MathAbs(Buf(f)-Buf(f,0,4))>0.15*ATR())return 0;
 double upper=Buf(bands,1),lower=Buf(bands,2),pu=Buf(bands,1,2),pl=Buf(bands,2,2);
 if(bar[2].close<pl && bar[1].close>lower && bar[1].close<upper)return 1;
 if(bar[2].close>pu && bar[1].close<upper && bar[1].close>lower)return -1;return 0;''',defaults={'STOP':5,'TARGET':8,'HOLD':10},params='int bands,f;',valid='BandPeriod>=5 && BandPeriod<=100 && BandDeviation>0.5 && BandDeviation<=4',ranges='Band period 15-30; deviation 1.8-2.5; SL 4-7, TP 5-10 pips. Require real ticks.')
add('BollingerSqueeze','Bollinger-Keltner Squeeze Release','volatility compression breakout','scalp','M15',
'Prior 2-sigma Bollinger width lies inside EMA20 +/-1.5 ATR; latest close escapes current Bollinger band and width expands. SL StopATR*ATR; TP 2R; max 6h.',
'Compression followed by expansion can reveal new directional information.',
'Squeezes can persist or release falsely; expansion is not necessarily directional continuation.',
'input int BandPeriod=20;\ninput double BandDeviation=2.0;\ninput double SqueezeATR=1.5;',
'bands=KeepHandle(iBands(_Symbol,SignalTF,BandPeriod,0,BandDeviation,PRICE_CLOSE));f=MA(SignalTF,20);',
'Ready(bands,BandPeriod*3) && Ready(f,60)',
'''double u2=Buf(bands,1,2),l2=Buf(bands,2,2),e2=Buf(f,0,2),a2=ATR(2);
 if(u2>e2+SqueezeATR*a2 || l2<e2-SqueezeATR*a2)return 0;
 double u=Buf(bands,1),l=Buf(bands,2);if(u-l<=u2-l2)return 0;
 stop=StopATR*ATR();target=2*stop;
 if(bar[1].close>u)return 1;if(bar[1].close<l)return -1;return 0;''',params='int bands,f;',valid='BandPeriod>=5 && BandPeriod<=100 && BandDeviation>0.5 && BandDeviation<=4 && SqueezeATR>0 && SqueezeATR<=4',ranges='Band period 15-30; SqueezeATR 1-2; StopATR 1-2; fixed 2R.')
add('RSI2Pullback','RSI(2) Trend Pullback','oscillator pullback','swing','H1',
'Above EMA200 and prior RSI2 below 10, buy when RSI2 crosses back above 10; mirrored short at 90 below EMA200. SL 2 ATR; no target; exit at RSI2 >=70 long/<=30 short or 2 days.',
'A very short oscillator can flag temporary countertrend exhaustion within a slower drift. Connors-inspired, not a reproduction of an equity system.',
'Pullbacks become trends and RSI thresholds lack a verified forex edge.',
'input int TrendEMA=200;\ninput double Oversold=10;\ninput double Overbought=90;',
'f=MA(SignalTF,TrendEMA);rsi=KeepHandle(iRSI(_Symbol,SignalTF,2,PRICE_CLOSE));',
'Ready(f,TrendEMA*3) && Ready(rsi,30)',
'''double e=Buf(f),r=Buf(rsi),prev=Buf(rsi,0,2);stop=2*ATR();target=0;
 if(bar[1].close>e && prev<Oversold && r>=Oversold)return 1;
 if(bar[1].close<e && prev>Overbought && r<=Overbought)return -1;return 0;''',
'''double r=Buf(rsi);if(aai_data_ok && ((side==1 && r>=70) || (side==-1 && r<=30))){CloseOwn();return true;}''',
{'TARGET':0,'HOLD':2880},'int f,rsi;', 'TrendEMA>=20 && TrendEMA<=500 && Oversold>0 && Oversold<30 && Overbought>70 && Overbought<100','Oversold 5-15; overbought 85-95; EMA 100-250. Keep RSI period 2.')
add('KeltnerTrend','Keltner Channel Trend Capture','ATR envelope breakout','swing','H1',
'EMA40 slope aligned and completed close crosses EMA40 +/-2 ATR envelope. SL 2 ATR, no target; exit on crossing back through middle EMA; max 5 days.',
'Volatility-scaled escape from equilibrium may mark a persistent trend rather than a fixed-pip fluctuation.',
'Late entries and band break failures; ATR growth expands risk.',
'input int CenterEMA=40;\ninput double ChannelATR=2.0;', 'f=MA(SignalTF,CenterEMA);','Ready(f,CenterEMA*3)',
'''double e=Buf(f),old=Buf(f,0,2),a=ATR(),pa=ATR(2);stop=2*a;target=0;
 if(e>old && bar[1].close>e+ChannelATR*a && bar[2].close<=old+ChannelATR*pa)return 1;
 if(e<old && bar[1].close<e-ChannelATR*a && bar[2].close>=old-ChannelATR*pa)return -1;return 0;''',
'''double e=Buf(f);if(aai_data_ok && ((side==1 && bar[1].close<e) || (side==-1 && bar[1].close>e))){CloseOwn();return true;}''',
{'TARGET':0,'HOLD':7200},'int f;', 'CenterEMA>=5 && CenterEMA<=300 && ChannelATR>0 && ChannelATR<=5','EMA 20-60; channel 1.5-3 ATR; 2 ATR stop fixed first.')
add('MACDTrend','MACD Histogram Turn with Slow Bias','momentum crossover','scalp','M15',
'MACD(12,26,9) main crosses signal in direction of EMA200 bias and main-line sign. SL StopATR*ATR; 2R target; opposite cross exits; max 6h.',
'Momentum reacceleration after a pause can align entry timing with a larger directional drift.',
'Whipsaw and redundant lagging filters; MACD main minus signal is used, not an MT4-only histogram buffer.',
'input int BiasEMA=200;',
'f=MA(SignalTF,BiasEMA);macd=KeepHandle(iMACD(_Symbol,SignalTF,12,26,9,PRICE_CLOSE));',
'Ready(f,BiasEMA*3) && Ready(macd,100)',
'''double m=Buf(macd,0),sig=Buf(macd,1),old=Buf(macd,0,2)-Buf(macd,1,2);stop=StopATR*ATR();target=2*stop;
 if(m>sig && old<=0 && m>0 && bar[1].close>Buf(f))return 1;
 if(m<sig && old>=0 && m<0 && bar[1].close<Buf(f))return -1;return 0;''',
'''double h=Buf(macd,0)-Buf(macd,1);if(aai_data_ok && side*h<0){CloseOwn();return true;}''',
params='int f,macd;',valid='BiasEMA>=20 && BiasEMA<=500',ranges='BiasEMA 100-250; StopATR 1-2; MACD 12/26/9 fixed initially.')
add('SupertrendFlip','Supertrend Volatility Flip','recursive ATR trend','swing','H1',
'Reconstruct Supertrend(ATR14, multiplier 3) causally over last 200 completed bars. Enter only on direction flip; SL beyond current band (at least 1 ATR); no target; opposite flip exits; max 7 days.',
'An ATR-adjusted hysteresis band may stay with direction while suppressing small countertrend noise.',
'Recursive seed and finite warmup sensitivity; no universal trend persistence.',
'input double Multiplier=3.0;', '', 'true',
'''int now,prior;double bandline;SuperState(now,prior,bandline);
 if(now==prior)return 0;MqlTick q;if(!SymbolInfoTick(_Symbol,q))return 0;
 stop=MathMax(ATR(),now>0?q.ask-bandline:bandline-q.bid);target=0;return now;''',
'''int now,prior;double line;SuperState(now,prior,line);if(aai_data_ok && now!=side){CloseOwn();return true;}''',
{'TARGET':0,'HOLD':10080},valid='Multiplier>=0.5 && Multiplier<=10',ranges='Multiplier 2-4; ATRPeriod 10-20. Replay length fixed 200; assess seed stability separately.')
# helper belongs only to Supertrend EA
strategies[-1]['helper']='''void SuperState(int &now,int &prior,double &line)
{
 double upper=0,lower=0,previous_close=0;int direction=1;prior=1;now=1;line=0;
 for(int i=200;i>=1;i--)
 {
  double a=ATR(i),mid=(bar[i].high+bar[i].low)*0.5;
  double bu=mid+Multiplier*a,bl=mid-Multiplier*a;
  if(i==200){upper=bu;lower=bl;direction=(bar[i].close>=mid?1:-1);}
  else
  {
   double old_upper=upper,old_lower=lower;
   upper=(bu<old_upper || previous_close>old_upper)?bu:old_upper;
   lower=(bl>old_lower || previous_close<old_lower)?bl:old_lower;
   if(direction<0 && bar[i].close>upper)direction=1;
   else if(direction>0 && bar[i].close<lower)direction=-1;
  }
  if(i==2)prior=direction;
  previous_close=bar[i].close;
 }
 now=direction;line=(direction>0?lower:upper);
}'''
add('IchimokuCloud','Ichimoku Cloud Escape','cloud trend structure','swing','H1',
'Completed close newly escapes above/below the visible cloud, Tenkan above/below Kijun and cloud polarity aligned. SL 2 ATR; no target; close through Kijun exits; max 7 days. No future Chikou comparison.',
'Agreement of short, medium and displaced range midpoints may identify persistent directional structure.',
'Lag, false cloud escapes and sensitivity to market-specific period convention.',
'input int Tenkan=9;\ninput int Kijun=26;\ninput int SpanB=52;',
'cloud=KeepHandle(iIchimoku(_Symbol,SignalTF,Tenkan,Kijun,SpanB));',
'Ready(cloud,SpanB+Kijun+100)',
'''// Senkou buffers are read at the visible bar coordinate: positive shift 1, NOT -Kijun.
 double a=Buf(cloud,2,1),b=Buf(cloud,3,1),pa=Buf(cloud,2,2),pb=Buf(cloud,3,2);
 double ten=Buf(cloud,0),kij=Buf(cloud,1);stop=2*ATR();target=0;
 if(bar[1].close>MathMax(a,b) && bar[2].close<=MathMax(pa,pb) && ten>kij && a>b)return 1;
 if(bar[1].close<MathMin(a,b) && bar[2].close>=MathMin(pa,pb) && ten<kij && a<b)return -1;return 0;''',
'''double k=Buf(cloud,1);if(aai_data_ok && ((side==1 && bar[1].close<k) || (side==-1 && bar[1].close>k))){CloseOwn();return true;}''',
{'TARGET':0,'HOLD':10080},'int cloud;', 'Tenkan>=2 && Kijun>Tenkan && SpanB>Kijun && SpanB<=250','9/26/52 baseline; assess 8/24/48 as one separate trial. Verify cloud alignment visually.')
add('ADXAcceleration','ADX Directional Acceleration','directional-strength expansion','scalp','M15',
'ADX14 newly crosses above 25; dominant DI exceeds other by >=8; close exceeds previous candle high/low. SL StopATR*ATR, TP 2R; exit when ADX <20 or DI dominance reverses.',
'Transition from low to stronger directional movement may be more informative than high ADX alone.',
'ADX is nondirectional by itself and often peaks after much of the move.',
'input int ADXPeriod=14;\ninput double Strength=25.0;\ninput double DIGap=8.0;',
'adx=KeepHandle(iADX(_Symbol,SignalTF,ADXPeriod));','Ready(adx,ADXPeriod*5)',
'''double a=Buf(adx,0),old=Buf(adx,0,2),plus=Buf(adx,1),minus=Buf(adx,2);
 if(a<Strength || old>=Strength)return 0;stop=StopATR*ATR();target=2*stop;
 if(plus-minus>=DIGap && bar[1].close>bar[2].high)return 1;
 if(minus-plus>=DIGap && bar[1].close<bar[2].low)return -1;return 0;''',
'''double a=Buf(adx,0),p=Buf(adx,1),m=Buf(adx,2);if(aai_data_ok && (a<20 || side*(p-m)<0)){CloseOwn();return true;}''',
params='int adx;',valid='ADXPeriod>=3 && ADXPeriod<=100 && Strength>20 && Strength<60 && DIGap>=0',ranges='ADX 10-20 periods; Strength 22-30; DI gap 5-15.')
add('InsideBar','Inside-Bar Mother-Range Break','candle compression','sniper','M15',
'Bar2 lies wholly inside bar3 (mother). Bar1 closes outside mother range in direction of EMA100 slope. SL beyond mother opposite extreme plus buffer, TP 3R; max 8h.',
'A pause within a directional market can concentrate stops before continuation.',
'Outside break can exhaust; mother-bar stop often too large for minimum volume.',
'input double BufferPips=1.0;', 'f=MA(SignalTF,100);','Ready(f,300)',
'''if(bar[2].high>=bar[3].high || bar[2].low<=bar[3].low)return 0;
 double e=Buf(f),old=Buf(f,0,4);MqlTick q;if(!SymbolInfoTick(_Symbol,q))return 0;
 if(bar[1].close>bar[3].high && e>old){stop=q.ask-(bar[3].low-BufferPips*Pip());target=3*stop;return 1;}
 if(bar[1].close<bar[3].low && e<old){stop=bar[3].high+BufferPips*Pip()-q.bid;target=3*stop;return -1;}return 0;''',defaults={'HOLD':480},params='int f;',valid='BufferPips>0',ranges='Buffer 0.5-2 pips; EMA100 fixed; target 2.5-4R only in separately logged trials.')
add('PinBarLevel','Pin-Bar Rejection at Daily Level','wick rejection','sniper','H1',
'At prior broker-D1 high/low +/-3 pips, require wick >=2 bodies and close in outer 30% of range, pointing away from level. SL past wick, TP 3R; max 1 day.',
'A strong rejection of a widely watched reference may indicate depleted aggressive flow.',
'OHLC shapes do not reveal true order flow; strong trends run through levels.',
'input double LevelTolerancePips=3.0;\ninput double WickBodyRatio=2.0;', '', 'true',
'''double hi,lo;if(!PriorDay(hi,lo))return 0;
 double range=bar[1].high-bar[1].low,body=MathMax(MathAbs(bar[1].close-bar[1].open),TickSize());
 double lower=MathMin(bar[1].open,bar[1].close)-bar[1].low,upper=bar[1].high-MathMax(bar[1].open,bar[1].close);
 if(range<=0)return 0;MqlTick q;if(!SymbolInfoTick(_Symbol,q))return 0;
 if(MathAbs(bar[1].low-lo)<=LevelTolerancePips*Pip() && lower>=WickBodyRatio*body && bar[1].close>=bar[1].low+0.7*range)
 {stop=q.ask-(bar[1].low-Pip());target=3*stop;return 1;}
 if(MathAbs(bar[1].high-hi)<=LevelTolerancePips*Pip() && upper>=WickBodyRatio*body && bar[1].close<=bar[1].low+0.3*range)
 {stop=bar[1].high+Pip()-q.bid;target=3*stop;return -1;}return 0;''',defaults={'HOLD':1440},valid='LevelTolerancePips>0 && WickBodyRatio>=1',ranges='Tolerance 2-5 pips; wick/body 2-3; 3R target fixed.')
add('RoundNumberPico','Round-Number Sweep Pico','psychological level reaction','pico','M1',
'Sweep and reclaim nearest 50-pip grid level with close at least 0.5 pip back inside. Contrarian entry, 5-pip SL/8-pip TP, max 10 minutes. Grid is explicitly configurable in price-derived pips.',
'Clustered orders near 00/50 levels can create temporary overshoot/rejection.',
'Round numbers can accelerate rather than reverse price; tiny target is cost-sensitive.',
'input double GridPips=50.0;\ninput double ReclaimPips=0.5;', '', 'true',
'''double grid=GridPips*Pip(),level=MathRound(bar[1].open/grid)*grid,b=ReclaimPips*Pip();
 if(bar[1].low<level-b && bar[1].open>=level && bar[1].close>level+b && bar[1].close>bar[1].open)return 1;
 if(bar[1].high>level+b && bar[1].open<=level && bar[1].close<level-b && bar[1].close<bar[1].open)return -1;return 0;''',defaults={'STOP':5,'TARGET':8,'HOLD':10},valid='GridPips>=10 && ReclaimPips>0 && ReclaimPips<GridPips/4',ranges='Grid 50 or 100 pips; reclaim 0.3-1; SL 4-7 and TP 5-10. For gold configure grid units explicitly.')
add('NR7Expansion','NR7 Volatility Release','relative range contraction','scalp','M15',
'Bar2 is strictly the narrowest range of seven bars (2-8). Bar1 closes outside bar2 in direction of EMA50 slope. Structural stop beyond bar2, TP 2.5R; max 6h.',
'Volatility clustering can produce expansion after a local contraction; directional slope supplies a separate bias.',
'Noise in extremely narrow bars; stops may violate broker minimum distance.',
'input double BufferPips=0.5;', 'f=MA(SignalTF,50);','Ready(f,150)',
'''double narrow=bar[2].high-bar[2].low;for(int i=3;i<=8;i++)if(bar[i].high-bar[i].low<=narrow)return 0;
 double e=Buf(f),old=Buf(f,0,4);MqlTick q;if(!SymbolInfoTick(_Symbol,q))return 0;
 if(bar[1].close>bar[2].high && e>old){stop=q.ask-(bar[2].low-BufferPips*Pip());target=2.5*stop;return 1;}
 if(bar[1].close<bar[2].low && e<old){stop=bar[2].high+BufferPips*Pip()-q.bid;target=2.5*stop;return -1;}return 0;''',params='int f;',valid='BufferPips>0',ranges='Buffer 0.3-1 pips; EMA50 fixed; NR7 fixed rather than mining many lookbacks.')
add('WeeklyGapFade','Weekly Open Gap Reversion','calendar discontinuity fade','scalp','M15',
'Compare current broker-W1 opening price with the last completed H1 close before that open. If gap 5-40 pips, during first six elapsed hours require a reversal body toward the old close; target the old close; stop max(8 pips, gap size).',
'Weekend inventory imbalances can partially unwind when continuous liquidity returns.',
'Fundamental weekend news can justify the gap; weekend open and historical quotes vary by broker.',
'input double MinGapPips=5.0;\ninput double MaxGapPips=40.0;\ninput int EntryWindowHours=6;', '', 'true',
'''datetime week=iTime(_Symbol,PERIOD_W1,0);if(week<=0 || TimeCurrent()<week || TimeCurrent()-week>EntryWindowHours*3600)return 0;
 int shift=iBarShift(_Symbol,PERIOD_H1,week-1,false);if(shift<1)return 0;
 double old=iClose(_Symbol,PERIOD_H1,shift),opened=iOpen(_Symbol,PERIOD_W1,0);if(old<=0 || opened<=0)return 0;
 double gap=opened-old,gp=MathAbs(gap)/Pip();if(gp<MinGapPips || gp>MaxGapPips)return 0;
 MqlTick q;if(!SymbolInfoTick(_Symbol,q))return 0;stop=MathMax(StopPips*Pip(),MathAbs(gap));target=0;absolute=old;
 if(gap>0 && bar[1].close<bar[1].open && q.bid>old+Pip())return -1;
 if(gap<0 && bar[1].close>bar[1].open && q.ask<old-Pip())return 1;return 0;''',defaults={'STOP':8,'HOLD':720},valid='MinGapPips>0 && MaxGapPips>MinGapPips && EntryWindowHours>=1 && EntryWindowHours<=24',ranges='Gap 5-40 pips; entry window 2-6 hours; session weekday filter means Sunday signals are skipped.')
add('ATRChandelierSwing','ATR Chandelier Trend Runner','trailing trend persistence','swing','H4',
'EMA50 above/below EMA200 and completed close newly breaks prior 5-bar extreme; initial 2.5 ATR stop, no target; ratchet highest/lowest since entry minus/plus 3 ATR after +1R; exit on bias loss.',
'Combines a medium-term trend bias with a volatility-adjusted exit that allows extended runs.',
'Large initial stops and profit giveback; no claim tight entries can reliably capture 100 pips.',
'input double ChandelierATR=3.0;', 'f=MA(SignalTF,50);s=MA(SignalTF,200);','Ready(f,150) && Ready(s,600)',
'''double fast=Buf(f),slow=Buf(s);stop=2.5*ATR();target=0;
 if(fast>slow && bar[1].close>HighN(2,5) && bar[2].close<=HighN(3,5))return 1;
 if(fast<slow && bar[1].close<LowN(2,5) && bar[2].close>=LowN(3,5))return -1;return 0;''',
'''double fast=Buf(f),slow=Buf(s);if(aai_data_ok && side*(fast-slow)<=0){CloseOwn();return true;}''',
{'TARGET':0,'HOLD':0},'int f,s;', 'ChandelierATR>=1 && ChandelierATR<=6','Chandelier 2-4 ATR; fixed 50/200 bias and 5-bar trigger initially.')
strategies[-1]['custommanage']='ManageChandelier();'
strategies[-1]['helper']='''void ManageChandelier()
{
 ulong t;int side;if(!OwnPosition(t,side))return;
 datetime opened=(datetime)PositionGetInteger(POSITION_TIME);
 int entry_shift=iBarShift(_Symbol,SignalTF,opened,false);
 if(entry_shift<1)return;
 double high=-DBL_MAX,low=DBL_MAX;
 // Copy the full completed history since entry, not a moving lookback that can loosen risk.
 MqlRates r[];ArraySetAsSeries(r,true);
 if(CopyRates(_Symbol,SignalTF,1,entry_shift,r)!=entry_shift)return;
 for(int i=0;i<entry_shift;i++){high=MathMax(high,r[i].high);low=MathMin(low,r[i].low);}
 double old=PositionGetDouble(POSITION_SL),open=PositionGetDouble(POSITION_PRICE_OPEN),tp=PositionGetDouble(POSITION_TP);
 if(t!=aai_risk_ticket){aai_risk_ticket=t;aai_initial_risk=MathAbs(open-old);}
 if(side*(bar[1].close-open)<aai_initial_risk)return;
 double candidate=PriceRound(side>0?high-ChandelierATR*ATR():low+ChandelierATR*ATR(),-side);
 MqlTick q;if(!SymbolInfoTick(_Symbol,q))return;
 double ref=(side>0?q.bid:q.ask),freeze=SymbolInfoInteger(_Symbol,SYMBOL_TRADE_FREEZE_LEVEL)*SymbolInfoDouble(_Symbol,SYMBOL_POINT);
 if(!aai_data_ok || side*(candidate-old)<TickSize()*0.5 || side*(ref-candidate)<=freeze || side*(ref-old)<=freeze || !StopLevelsOK(side,candidate,tp,q))return;
 TradeResult(aai_trade.PositionModify(t,candidate,tp),"Chandelier modification");
}'''
add('MTFMomentum','Three-Horizon Momentum Agreement','multi-timeframe momentum','swing','H1',
'Completed D1 5-bar, H4 6-bar and H1 12-bar returns all agree and exceed 0.5 ATR of their respective timeframes; enter only when H1 momentum newly qualifies. Stop 2 signal ATR; no target; 40-pip close trail after +1R; exit if D1/H4 sign flips.',
'Agreement across horizons may reflect broader repricing rather than a single noisy fluctuation.',
'Correlated filters and late entries; threshold selection easily overfits.',
'input double MomentumATR=0.5;',
'datr=KeepHandle(iATR(_Symbol,PERIOD_D1,ATRPeriod));hatr=KeepHandle(iATR(_Symbol,PERIOD_H4,ATRPeriod));',
'Ready(datr,ATRPeriod*3) && Ready(hatr,ATRPeriod*3) && Bars(_Symbol,PERIOD_D1)>30 && Bars(_Symbol,PERIOD_H4)>30',
'''double d=iClose(_Symbol,PERIOD_D1,1)-iClose(_Symbol,PERIOD_D1,6);
 double h=iClose(_Symbol,PERIOD_H4,1)-iClose(_Symbol,PERIOD_H4,7);
 double m=bar[1].close-bar[13].close,old=bar[2].close-bar[14].close;
 double dt=MomentumATR*Buf(datr),ht=MomentumATR*Buf(hatr),mt=MomentumATR*ATR();
 stop=2*ATR();target=0;
 if(d>dt && h>ht && m>mt && old<=MomentumATR*ATR(2))return 1;
 if(d<-dt && h<-ht && m<-mt && old>=-MomentumATR*ATR(2))return -1;return 0;''',
'''double d=iClose(_Symbol,PERIOD_D1,1)-iClose(_Symbol,PERIOD_D1,6),h=iClose(_Symbol,PERIOD_H4,1)-iClose(_Symbol,PERIOD_H4,7);
 if(aai_data_ok && (side*d<=0 || side*h<=0)){CloseOwn();return true;}''',
{'TARGET':0,'TRAIL':40,'HOLD':10080},'int datr,hatr;', 'MomentumATR>0 && MomentumATR<=3','Momentum threshold 0.3-1 ATR; trail 30-60 pips. Horizons fixed, not interchangeable bar counts.')
add('GoldLondonRetest','Gold Asian-Range London Retest','breakout retest / metals','sniper','M5',
'Gold-oriented but symbol-generic: build UTC 00-06 M5 range, London first three hours only. Bar2 closes outside range; bar1 retests broken edge within 0.15 ATR and closes back outside. Stop beyond retest wick or StopATR*ATR, whichever wider; TP 3R; max 4h.',
'Gold can transition from Asian balance to London price discovery; retest demands acceptance beyond the broken range rather than chasing the first escape.',
'Gold volatility/spread and contract minimum often make this impossible on $100. Not a gold-only symbol check; pip override mandatory for CFDs.',
'input int AsiaStartUTC=0;\ninput int AsiaEndUTC=6;\ninput double RetestATR=0.15;', '', 'true',
'''if(!LondonSignal(bar[1].time))return 0;double hi,lo;if(!DayRange(AsiaStartUTC,AsiaEndUTC,hi,lo))return 0;
 double a=ATR(),b=RetestATR*a;MqlTick q;if(!SymbolInfoTick(_Symbol,q))return 0;
 // Both confirmation bars must be after the completed Asian range.
 if(HourUTC(bar[2].time)<AsiaEndUTC)return 0;
 if(bar[2].close>hi && bar[1].low<=hi+b && bar[1].low>=hi-b && bar[1].close>hi && bar[1].close>bar[1].open)
 {stop=MathMax(StopATR*a,q.ask-(bar[1].low-TickSize()));target=3*stop;return 1;}
 if(bar[2].close<lo && bar[1].high>=lo-b && bar[1].high<=lo+b && bar[1].close<lo && bar[1].close<bar[1].open)
 {stop=MathMax(StopATR*a,bar[1].high+TickSize()-q.bid);target=3*stop;return -1;}return 0;''',defaults={'HOLD':240},valid='AsiaStartUTC>=0 && AsiaEndUTC>AsiaStartUTC && AsiaEndUTC<=24 && RetestATR>0 && RetestATR<=1',ranges='Retest 0.1-0.3 ATR; StopATR 1-2; keep gold price-unit override fixed from specification.')
assert len(strategies)==25
for i,s in enumerate(strategies,1):
    macro='\n'.join(f'#define AAI_DEFAULT_{k} {v}' for k,v in {'TF':'PERIOD_'+s['tf'],**s['defaults']}.items())
    header=f'''/*
AAI {i:03d}: {s['name']}
Family: {s['family']} | Style: {s['style']} | Signal timeframe: {s['tf']}
Logic: {s['logic']}
Rationale: {s['rationale']}
Failure modes: {s['failure']}
UNCOMPILED / UNTESTED research hypothesis, not a profitable or institutional-grade claim.
Strategy Tester only. No martingale, grid, averaging down, DLL or web requests.
*/
#property strict
#property version "1.00"
#define AAI_MAGIC {2601000+i}
#define AAI_NAME "AAI_{i:03d}_{s['slug']}"
{macro}
#include <AAI/AAI_Common.mqh>
input group "Strategy hypothesis inputs"
{s['inputs']}
{s['params']}
{s.get('helper','')}
bool StrategyReady(){{return {s['ready']};}}
int OnInit()
{{
 int result=CommonInit();if(result!=INIT_SUCCEEDED)return result;
 if(!({s['valid']})){{Print("Invalid strategy inputs");return INIT_PARAMETERS_INCORRECT;}}
 {s['init']}
 // KeepHandle does not record invalid handles, so compare registry count to expected allocations.
 if(ArraySize(aai_handles)!={1+s['init'].count('=MA(')+s['init'].count('=KeepHandle(')}){{Print("Indicator creation failed");return INIT_FAILED;}}
 return INIT_SUCCEEDED;
}}
void OnDeinit(const int reason){{CommonDeinit();}}
int StrategySignal(double &stop,double &target,double &absolute)
{{
 {s['signal']}
}}
bool StrategyExit(int side)
{{
 {s['exitcode']}
 return false;
}}
void OnTick()
{{
 if(!DailyOK())return;
 AuditPosition();
 TimedManagement();
 if(!StrategyReady() || !NewBar())return;
 ulong ticket;int side;
 if(OwnPosition(ticket,side))
 {{
  if(StrategyExit(side))return;
  if(!aai_data_ok)return;
  {s.get('custommanage','ManageStops();')}
  return;
 }}
 double stop=StopPips*Pip(),target=TargetPips*Pip(),absolute=0;
 int direction=StrategySignal(stop,target,absolute);
 if(aai_data_ok && direction!=0)Enter(direction,stop,target,absolute);
}}
'''
    s['number']=i;s['filename']=f"AAI_{i:03d}_{s['slug']}.mq5";s['magic']=2601000+i
    (ROOT/'Experts/AAI'/s['filename']).write_text(header)
(ROOT/'strategy_manifest.json').write_text(json.dumps([{k:v for k,v in s.items() if k not in ('helper','custommanage')} for s in strategies],indent=2))
intro='''# AAI MT5 EA Library — Batch 1 (25 hypotheses)

Created November 6, 2026 (CT). **UNCOMPILED and UNTESTED MQL5 research artifacts. No claim of profitability, hedge-fund quality, or suitability for sale.** Earlier Python research found no robust edge; its results do not validate these implementations. No account accessed. EAs are hard-locked to Strategy Tester, not live or demo charts.

## Shared semantics and defaults

- Main research symbol AUDUSD+; every EA uses `_Symbol`, with no hardcoded broker suffix. Gold-oriented #25 defaults to M5 but still works on other symbols after input review.
- Timeframe below is the `SignalTF` input; the chart timeframe does not override it. Fixed lookbacks represent that stated timeframe, not equivalent durations on another timeframe. Sniper rejects non-H1 input in this batch.
- Entry is a market order on the first tick of a new signal bar, using completed bars only. No intrabar signal or guaranteed fill at the historical close. No pending orders or partial exits.
- SL always attached. `StopPips`/`TargetPips` are execution distances unless a strategy explicitly replaces them with ATR/structure. Stops are rounded outward to trade tick size and re-sized; invalid broker distances are skipped, never secretly tightened or widened to fit an account.
- `RiskPercent=1`, `MaxRiskPercent=2` (cannot exceed 2). Sizes rounded DOWN to broker step. `AllowMinimumLot=true` permits the broker minimum above the 1% target only if reserved planned risk <=2%. Disable it for strict target risk. `FixedLot=0` is off; fixed volume never bypasses max risk, spread, margin, or daily filters. Minimum lot is read from the broker, not assumed to be 0.01.
- Risk includes conservative tick-value loss, cross-checked OrderCalcProfit, account-currency round-trip commission reserve (default 7 per standard lot), and 5-point stop-slip reserve. Spread is paid through bid/ask entry/SL distance, not added twice. These defaults are NOT verified Bybit costs. Gaps/slippage/swap can still exceed any planned limit. Actual fills above reserve trigger a close, not a guaranteed 2% realized cap.
- `MaxSpreadPoints=20`, deviation 10 points. On 5-digit AUDUSD: 10 points=1 pip. Non-FX requires explicit `PipSizeOverride`; example gold 0.10 price units per user-defined pip is a convention, NOT a broker fact. All gold distances and spreads need review.
- UTC session inputs: server offset +120 minutes by default, London open 08 UTC, NY open 13 UTC (winter conventions). Change for actual broker and local DST. Generic UTC entry session defaults 00-to-00 (all weekday hours). Custom session signals refer to the signal bar OPEN; execution follows its close. No automatic holidays/news/DST feed.
- `MaxTradesPerDay=1`, keyed to EA magic/symbol and UTC date, counts unique entry orders including partial fills as one. `DailyLossLimitPercent=4`: today's realized PnL plus full current floating profit/swap, divided by reconstructed start-day account balance; breach closes this EA and latches until UTC date changes. It is NOT a global portfolio limit. Overnight floating is conservatively attributed in full, not marked from midnight. Latch is memory-only if forcibly restarted. Entry also checks remaining loss allowance; exits can gap beyond it.
- One own position per magic/symbol. On netting accounts ANY existing symbol position blocks new entries, preventing another strategy/manual trade from being merged. Do not run the same EA twice on the same symbol/magic. No martingale/grid/averaging or hidden size escalation.
- BE/trails update on completed signal closes only. Short close estimates use current spread; real ticks must verify behavior. BE at entry does not cover fees. Initial R is from actual open to SL; do not change inputs mid-position. Default timed exit is 360 elapsed minutes except where listed. A timed exit checks each tick; a market closure delays it.
- Indicator handles allocated in OnInit, CopyBuffer failures suppress signals, handles released in OnDeinit. Slow EMAs require 3x period calculated bars; load sufficient pre-test history. Common `WarmupBars=250` with at least 300 copied bars. No tick-history validity claim comes from these guards.
- Optimisation ranges below are research bounds, not recommended profitable settings. Many strategies will correctly take ZERO trades on a $100 account because minimum lots make their stops unaffordable. Do not loosen risk to manufacture activity. For $100 feasibility test after each balance change, not just initially.

'''
parts=[intro]
for s in strategies:
    parts.append(f'''## {s['number']:03d} — {s['name']}

- File: `Experts/AAI/{s['filename']}`; magic `{s['magic']}`.
- Family: {s['family']}. Style: **{s['style']}**.
- Symbol/timeframe: {'XAUUSD+ first; AUDUSD+ cross-check' if s['number']==25 else 'AUDUSD+ first; XAUUSD+ only after contract/unit review'}; **{s['tf']}** baseline.
- Entry and exit: {s['logic']}
- Why it might work: {s['rationale']}
- When it fails: {s['failure']}
- Key inputs / limited optimisation bounds: {s['ranges']}
- Status: **Untested, uncompiled hypothesis.** Defaults are starting specifications, not fitted recommendations. Shared filters can veto every signal.

''')
(ROOT/'STRATEGY_CATALOG.md').write_text(''.join(parts))
print('Generated',len(strategies),'EAs and catalog')
