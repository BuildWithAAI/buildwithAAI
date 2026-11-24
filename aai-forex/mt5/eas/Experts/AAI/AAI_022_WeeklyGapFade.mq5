/*
AAI 022: Weekly Open Gap Reversion
Family: calendar discontinuity fade | Style: scalp | Signal timeframe: M15
Logic: Compare current broker-W1 opening price with the last completed H1 close before that open. If gap 5-40 pips, during first six elapsed hours require a reversal body toward the old close; target the old close; stop max(8 pips, gap size).
Rationale: Weekend inventory imbalances can partially unwind when continuous liquidity returns.
Failure modes: Fundamental weekend news can justify the gap; weekend open and historical quotes vary by broker.
UNCOMPILED / UNTESTED research hypothesis, not a profitable or institutional-grade claim.
Strategy Tester only. No martingale, grid, averaging down, DLL or web requests.
*/
#property strict
#property version "1.00"
#define AAI_MAGIC 2601022
#define AAI_NAME "AAI_022_WeeklyGapFade"
#define AAI_DEFAULT_TF PERIOD_M15
#define AAI_DEFAULT_STOP 8
#define AAI_DEFAULT_HOLD 720
#include <AAI/AAI_Common.mqh>
input group "Strategy hypothesis inputs"
input double MinGapPips=5.0;
input double MaxGapPips=40.0;
input int EntryWindowHours=6;


bool StrategyReady(){return true;}
int OnInit()
{
 int result=CommonInit();if(result!=INIT_SUCCEEDED)return result;
 if(!(MinGapPips>0 && MaxGapPips>MinGapPips && EntryWindowHours>=1 && EntryWindowHours<=24)){Print("Invalid strategy inputs");return INIT_PARAMETERS_INCORRECT;}
 
 // KeepHandle does not record invalid handles, so compare registry count to expected allocations.
 if(ArraySize(aai_handles)!=1){Print("Indicator creation failed");return INIT_FAILED;}
 return INIT_SUCCEEDED;
}
void OnDeinit(const int reason){CommonDeinit();}
int StrategySignal(double &stop,double &target,double &absolute)
{
 datetime week=iTime(_Symbol,PERIOD_W1,0);if(week<=0 || TimeCurrent()<week || TimeCurrent()-week>EntryWindowHours*3600)return 0;
 int shift=iBarShift(_Symbol,PERIOD_H1,week-1,false);if(shift<1)return 0;
 double old=iClose(_Symbol,PERIOD_H1,shift),opened=iOpen(_Symbol,PERIOD_W1,0);if(old<=0 || opened<=0)return 0;
 double gap=opened-old,gp=MathAbs(gap)/Pip();if(gp<MinGapPips || gp>MaxGapPips)return 0;
 MqlTick q;if(!SymbolInfoTick(_Symbol,q))return 0;stop=MathMax(StopPips*Pip(),MathAbs(gap));target=0;absolute=old;
 if(gap>0 && bar[1].close<bar[1].open && q.bid>old+Pip())return -1;
 if(gap<0 && bar[1].close>bar[1].open && q.ask<old-Pip())return 1;return 0;
}
bool StrategyExit(int side)
{
 
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
