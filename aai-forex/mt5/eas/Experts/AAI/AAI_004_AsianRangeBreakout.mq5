/*
AAI 004: Asian Range Expansion
Family: session range breakout | Style: scalp | Signal timeframe: M15
Logic: Build complete UTC 00:00-06:00 M5 range. Between range end and first three London hours, enter a new completed-close break beyond the range plus buffer; 12-pip SL, 25-pip TP, max 6h.
Rationale: Quiet-session inventory can unwind when London liquidity arrives.
Failure modes: False breaks and news reversals; fixed UTC Asia definition is not local Sydney time.
UNCOMPILED / UNTESTED research hypothesis, not a profitable or institutional-grade claim.
Strategy Tester only. No martingale, grid, averaging down, DLL or web requests.
*/
#property strict
#property version "1.00"
#define AAI_MAGIC 2601004
#define AAI_NAME "AAI_004_AsianRangeBreakout"
#define AAI_DEFAULT_TF PERIOD_M15
#define AAI_DEFAULT_TARGET 25
#include <AAI/AAI_Common.mqh>
input group "Strategy hypothesis inputs"
input int AsiaStartUTC=0;
input int AsiaEndUTC=6;
input double BufferPips=1.0;


bool StrategyReady(){return true;}
int OnInit()
{
 int result=CommonInit();if(result!=INIT_SUCCEEDED)return result;
 if(!(AsiaStartUTC>=0 && AsiaEndUTC>AsiaStartUTC && AsiaEndUTC<=24 && BufferPips>=0)){Print("Invalid strategy inputs");return INIT_PARAMETERS_INCORRECT;}
 
 // KeepHandle does not record invalid handles, so compare registry count to expected allocations.
 if(ArraySize(aai_handles)!=1){Print("Indicator creation failed");return INIT_FAILED;}
 return INIT_SUCCEEDED;
}
void OnDeinit(const int reason){CommonDeinit();}
int StrategySignal(double &stop,double &target,double &absolute)
{
 double hi,lo;if(!LondonSignal(bar[1].time) || !DayRange(AsiaStartUTC,AsiaEndUTC,hi,lo))return 0;
 double b=BufferPips*Pip();
 if(bar[1].close>hi+b && bar[2].close<=hi+b)return 1;
 if(bar[1].close<lo-b && bar[2].close>=lo-b)return -1;return 0;
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
