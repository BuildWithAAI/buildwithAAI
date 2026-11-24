/*
AAI 005: London First-Hour ORB
Family: opening range breakout | Style: scalp | Signal timeframe: M15
Logic: Build the first full London hour from M5 bars, then trade a completed-close escape during the next two hours. Initial stop is max(StopPips, half opening-range width); target 2R.
Rationale: The initial high-liquidity auction may define a range whose escape marks committed flow.
Failure modes: Opening-range noise and unusually broad ranges; not equivalent to the pre-London Asian breakout.
UNCOMPILED / UNTESTED research hypothesis, not a profitable or institutional-grade claim.
Strategy Tester only. No martingale, grid, averaging down, DLL or web requests.
*/
#property strict
#property version "1.00"
#define AAI_MAGIC 2601005
#define AAI_NAME "AAI_005_LondonOpeningRange"
#define AAI_DEFAULT_TF PERIOD_M15
#include <AAI/AAI_Common.mqh>
input group "Strategy hypothesis inputs"
input double BufferPips=1.0;


bool StrategyReady(){return true;}
int OnInit()
{
 int result=CommonInit();if(result!=INIT_SUCCEEDED)return result;
 if(!(BufferPips>=0)){Print("Invalid strategy inputs");return INIT_PARAMETERS_INCORRECT;}
 
 // KeepHandle does not record invalid handles, so compare registry count to expected allocations.
 if(ArraySize(aai_handles)!=1){Print("Indicator creation failed");return INIT_FAILED;}
 return INIT_SUCCEEDED;
}
void OnDeinit(const int reason){CommonDeinit();}
int StrategySignal(double &stop,double &target,double &absolute)
{
 int h=HourUTC(bar[1].time);int end=LondonOpenHourUTC+1;
 if(end>23 || !InHours(h,end,(end+2)%24))return 0;
 double hi,lo;if(!DayRange(LondonOpenHourUTC,end,hi,lo))return 0;
 stop=MathMax(StopPips*Pip(),(hi-lo)*0.5);target=2*stop;double b=BufferPips*Pip();
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
