/*
AAI 007: Prior-Day Extreme Breakout
Family: daily structure breakout | Style: swing | Signal timeframe: H1
Logic: New completed-close break above prior broker-D1 high or below low, with EMA50 slope aligned. Stop 2 ATR, no target; 35-pip close trail after +1R; max 3 days.
Rationale: Daily extremes can attract stop orders and signal multi-session repricing.
Failure modes: Failed breaks, broker day-boundary dependence and overnight swaps.
UNCOMPILED / UNTESTED research hypothesis, not a profitable or institutional-grade claim.
Strategy Tester only. No martingale, grid, averaging down, DLL or web requests.
*/
#property strict
#property version "1.00"
#define AAI_MAGIC 2601007
#define AAI_NAME "AAI_007_PriorDayBreakout"
#define AAI_DEFAULT_TF PERIOD_H1
#define AAI_DEFAULT_TARGET 0
#define AAI_DEFAULT_TRAIL 35
#define AAI_DEFAULT_HOLD 4320
#include <AAI/AAI_Common.mqh>
input group "Strategy hypothesis inputs"
input int TrendEMA=50;
input double BufferPips=1.0;
int f;

bool StrategyReady(){return Ready(f,TrendEMA*3);}
int OnInit()
{
 int result=CommonInit();if(result!=INIT_SUCCEEDED)return result;
 if(!(TrendEMA>=5 && TrendEMA<=500 && BufferPips>=0)){Print("Invalid strategy inputs");return INIT_PARAMETERS_INCORRECT;}
 f=MA(SignalTF,TrendEMA);
 // KeepHandle does not record invalid handles, so compare registry count to expected allocations.
 if(ArraySize(aai_handles)!=2){Print("Indicator creation failed");return INIT_FAILED;}
 return INIT_SUCCEEDED;
}
void OnDeinit(const int reason){CommonDeinit();}
int StrategySignal(double &stop,double &target,double &absolute)
{
 double hi,lo;if(!PriorDay(hi,lo))return 0;double b=BufferPips*Pip();double e=Buf(f),old=Buf(f,0,3);
 stop=2*ATR();target=0;
 if(bar[1].close>hi+b && bar[2].close<=hi+b && e>old)return 1;
 if(bar[1].close<lo-b && bar[2].close>=lo-b && e<old)return -1;return 0;
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
