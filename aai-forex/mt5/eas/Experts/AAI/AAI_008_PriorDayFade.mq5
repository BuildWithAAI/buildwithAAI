/*
AAI 008: Prior-Day Liquidity Sweep Fade
Family: failed breakout reversal | Style: sniper | Signal timeframe: M15
Logic: Signal wick sweeps prior broker-D1 extreme by at least buffer, then closes back inside with reversal body. Stop beyond wick plus buffer; target 3R, max 4h.
Rationale: An unsuccessful stop-run can trap breakout traders and reverse into the range.
Failure modes: A genuine trend may resume after the rejection; structural stop can be unaffordable.
UNCOMPILED / UNTESTED research hypothesis, not a profitable or institutional-grade claim.
Strategy Tester only. No martingale, grid, averaging down, DLL or web requests.
*/
#property strict
#property version "1.00"
#define AAI_MAGIC 2601008
#define AAI_NAME "AAI_008_PriorDayFade"
#define AAI_DEFAULT_TF PERIOD_M15
#define AAI_DEFAULT_HOLD 240
#include <AAI/AAI_Common.mqh>
input group "Strategy hypothesis inputs"
input double SweepPips=1.0;
input double WickBufferPips=1.0;


bool StrategyReady(){return true;}
int OnInit()
{
 int result=CommonInit();if(result!=INIT_SUCCEEDED)return result;
 if(!(SweepPips>=0 && WickBufferPips>0)){Print("Invalid strategy inputs");return INIT_PARAMETERS_INCORRECT;}
 
 // KeepHandle does not record invalid handles, so compare registry count to expected allocations.
 if(ArraySize(aai_handles)!=1){Print("Indicator creation failed");return INIT_FAILED;}
 return INIT_SUCCEEDED;
}
void OnDeinit(const int reason){CommonDeinit();}
int StrategySignal(double &stop,double &target,double &absolute)
{
 double hi,lo;if(!PriorDay(hi,lo))return 0;MqlTick q;if(!SymbolInfoTick(_Symbol,q))return 0;
 if(bar[1].low<lo-SweepPips*Pip() && bar[1].close>lo && bar[1].close>bar[1].open)
 {stop=q.ask-(bar[1].low-WickBufferPips*Pip());target=3*stop;return 1;}
 if(bar[1].high>hi+SweepPips*Pip() && bar[1].close<hi && bar[1].close<bar[1].open)
 {stop=(bar[1].high+WickBufferPips*Pip())-q.bid;target=3*stop;return -1;}return 0;
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
