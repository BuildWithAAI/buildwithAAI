/*
AAI 019: Pin-Bar Rejection at Daily Level
Family: wick rejection | Style: sniper | Signal timeframe: H1
Logic: At prior broker-D1 high/low +/-3 pips, require wick >=2 bodies and close in outer 30% of range, pointing away from level. SL past wick, TP 3R; max 1 day.
Rationale: A strong rejection of a widely watched reference may indicate depleted aggressive flow.
Failure modes: OHLC shapes do not reveal true order flow; strong trends run through levels.
UNCOMPILED / UNTESTED research hypothesis, not a profitable or institutional-grade claim.
Strategy Tester only. No martingale, grid, averaging down, DLL or web requests.
*/
#property strict
#property version "1.00"
#define AAI_MAGIC 2601019
#define AAI_NAME "AAI_019_PinBarLevel"
#define AAI_DEFAULT_TF PERIOD_H1
#define AAI_DEFAULT_HOLD 1440
#include <AAI/AAI_Common.mqh>
input group "Strategy hypothesis inputs"
input double LevelTolerancePips=3.0;
input double WickBodyRatio=2.0;


bool StrategyReady(){return true;}
int OnInit()
{
 int result=CommonInit();if(result!=INIT_SUCCEEDED)return result;
 if(!(LevelTolerancePips>0 && WickBodyRatio>=1)){Print("Invalid strategy inputs");return INIT_PARAMETERS_INCORRECT;}
 
 // KeepHandle does not record invalid handles, so compare registry count to expected allocations.
 if(ArraySize(aai_handles)!=1){Print("Indicator creation failed");return INIT_FAILED;}
 return INIT_SUCCEEDED;
}
void OnDeinit(const int reason){CommonDeinit();}
int StrategySignal(double &stop,double &target,double &absolute)
{
 double hi,lo;if(!PriorDay(hi,lo))return 0;
 double range=bar[1].high-bar[1].low,body=MathMax(MathAbs(bar[1].close-bar[1].open),TickSize());
 double lower=MathMin(bar[1].open,bar[1].close)-bar[1].low,upper=bar[1].high-MathMax(bar[1].open,bar[1].close);
 if(range<=0)return 0;MqlTick q;if(!SymbolInfoTick(_Symbol,q))return 0;
 if(MathAbs(bar[1].low-lo)<=LevelTolerancePips*Pip() && lower>=WickBodyRatio*body && bar[1].close>=bar[1].low+0.7*range)
 {stop=q.ask-(bar[1].low-Pip());target=3*stop;return 1;}
 if(MathAbs(bar[1].high-hi)<=LevelTolerancePips*Pip() && upper>=WickBodyRatio*body && bar[1].close<=bar[1].low+0.3*range)
 {stop=bar[1].high+Pip()-q.bid;target=3*stop;return -1;}return 0;
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
