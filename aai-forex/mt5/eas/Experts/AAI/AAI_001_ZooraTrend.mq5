/*
AAI 001: Zoora Regime Transition
Family: EMA regime | Style: swing | Signal timeframe: H4
Logic: Enter only when the completed close/EMA200/EMA800 regime changes to +1 or -1. Stop 3 ATR, no target; exit when regime no longer matches. No automatic re-entry after a stop.
Rationale: Persistent repricing can produce multi-day directional runs; a slow regime attempts to avoid small fluctuations.
Failure modes: Lag and repeated regime flips in ranges; wide stops commonly exceed $100 minimum-lot budget.
UNCOMPILED / UNTESTED research hypothesis, not a profitable or institutional-grade claim.
Strategy Tester only. No martingale, grid, averaging down, DLL or web requests.
*/
#property strict
#property version "1.00"
#define AAI_MAGIC 2601001
#define AAI_NAME "AAI_001_ZooraTrend"
#define AAI_DEFAULT_TF PERIOD_H4
#define AAI_DEFAULT_TARGET 0
#define AAI_DEFAULT_HOLD 0
#include <AAI/AAI_Common.mqh>
input group "Strategy hypothesis inputs"
input int FastEMA=200; // Alternative 198
input int SlowEMA=800; // Alternative 792
int f,s;

bool StrategyReady(){return Ready(f,FastEMA*3) && Ready(s,SlowEMA*3);}
int OnInit()
{
 int result=CommonInit();if(result!=INIT_SUCCEEDED)return result;
 if(!(FastEMA>=2 && SlowEMA>FastEMA && SlowEMA<=2000)){Print("Invalid strategy inputs");return INIT_PARAMETERS_INCORRECT;}
 f=MA(SignalTF,FastEMA);s=MA(SignalTF,SlowEMA);
 // KeepHandle does not record invalid handles, so compare registry count to expected allocations.
 if(ArraySize(aai_handles)!=3){Print("Indicator creation failed");return INIT_FAILED;}
 return INIT_SUCCEEDED;
}
void OnDeinit(const int reason){CommonDeinit();}
int StrategySignal(double &stop,double &target,double &absolute)
{
 int now=Regime(f,s,SignalTF,1),prior=Regime(f,s,SignalTF,2);
 stop=3.0*ATR();target=0;
 return now!=0 && now!=prior?now:0;
}
bool StrategyExit(int side)
{
 int regime=Regime(f,s,SignalTF);if(aai_data_ok && regime!=side){CloseOwn();return true;}
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
  ManageStops();
  return;
 }
 double stop=StopPips*Pip(),target=TargetPips*Pip(),absolute=0;
 int direction=StrategySignal(stop,target,absolute);
 if(aai_data_ok && direction!=0)Enter(direction,stop,target,absolute);
}
