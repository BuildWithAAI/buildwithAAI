/*
AAI 023: ATR Chandelier Trend Runner
Family: trailing trend persistence | Style: swing | Signal timeframe: H4
Logic: EMA50 above/below EMA200 and completed close newly breaks prior 5-bar extreme; initial 2.5 ATR stop, no target; ratchet highest/lowest since entry minus/plus 3 ATR after +1R; exit on bias loss.
Rationale: Combines a medium-term trend bias with a volatility-adjusted exit that allows extended runs.
Failure modes: Large initial stops and profit giveback; no claim tight entries can reliably capture 100 pips.
UNCOMPILED / UNTESTED research hypothesis, not a profitable or institutional-grade claim.
Strategy Tester only. No martingale, grid, averaging down, DLL or web requests.
*/
#property strict
#property version "1.00"
#define AAI_MAGIC 2601023
#define AAI_NAME "AAI_023_ATRChandelierSwing"
#define AAI_DEFAULT_TF PERIOD_H4
#define AAI_DEFAULT_TARGET 0
#define AAI_DEFAULT_HOLD 0
#include <AAI/AAI_Common.mqh>
input group "Strategy hypothesis inputs"
input double ChandelierATR=3.0;
int f,s;
void ManageChandelier()
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
}
bool StrategyReady(){return Ready(f,150) && Ready(s,600);}
int OnInit()
{
 int result=CommonInit();if(result!=INIT_SUCCEEDED)return result;
 if(!(ChandelierATR>=1 && ChandelierATR<=6)){Print("Invalid strategy inputs");return INIT_PARAMETERS_INCORRECT;}
 f=MA(SignalTF,50);s=MA(SignalTF,200);
 // KeepHandle does not record invalid handles, so compare registry count to expected allocations.
 if(ArraySize(aai_handles)!=3){Print("Indicator creation failed");return INIT_FAILED;}
 return INIT_SUCCEEDED;
}
void OnDeinit(const int reason){CommonDeinit();}
int StrategySignal(double &stop,double &target,double &absolute)
{
 double fast=Buf(f),slow=Buf(s);stop=2.5*ATR();target=0;
 if(fast>slow && bar[1].close>HighN(2,5) && bar[2].close<=HighN(3,5))return 1;
 if(fast<slow && bar[1].close<LowN(2,5) && bar[2].close>=LowN(3,5))return -1;return 0;
}
bool StrategyExit(int side)
{
 double fast=Buf(f),slow=Buf(s);if(aai_data_ok && side*(fast-slow)<=0){CloseOwn();return true;}
 return false;
}
void OnTick()
{
 if(!DailyOK())return;
 AuditPosition();
 TimedManagement();
 if(!StrategyReady() || !NewBar())return;
 ulong ticket;int side;
 if(OwnPosition(ticket,side))
 {
  if(StrategyExit(side))return;
  if(!aai_data_ok)return;
  ManageChandelier();
  return;
 }
 double stop=StopPips*Pip(),target=TargetPips*Pip(),absolute=0;
 int direction=StrategySignal(stop,target,absolute);
 if(aai_data_ok && direction!=0)Enter(direction,stop,target,absolute);
}
