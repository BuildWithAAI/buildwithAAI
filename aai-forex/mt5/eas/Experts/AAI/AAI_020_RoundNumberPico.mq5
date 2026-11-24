/*
AAI 020: Round-Number Sweep Pico
Family: psychological level reaction | Style: pico | Signal timeframe: M1
Logic: Sweep and reclaim nearest 50-pip grid level with close at least 0.5 pip back inside. Contrarian entry, 5-pip SL/8-pip TP, max 10 minutes. Grid is explicitly configurable in price-derived pips.
Rationale: Clustered orders near 00/50 levels can create temporary overshoot/rejection.
Failure modes: Round numbers can accelerate rather than reverse price; tiny target is cost-sensitive.
UNCOMPILED / UNTESTED research hypothesis, not a profitable or institutional-grade claim.
Strategy Tester only. No martingale, grid, averaging down, DLL or web requests.
*/
#property strict
#property version "1.00"
#define AAI_MAGIC 2601020
#define AAI_NAME "AAI_020_RoundNumberPico"
#define AAI_DEFAULT_TF PERIOD_M1
#define AAI_DEFAULT_STOP 5
#define AAI_DEFAULT_TARGET 8
#define AAI_DEFAULT_HOLD 10
#include <AAI/AAI_Common.mqh>
input group "Strategy hypothesis inputs"
input double GridPips=50.0;
input double ReclaimPips=0.5;


bool StrategyReady(){return true;}
int OnInit()
{
 int result=CommonInit();if(result!=INIT_SUCCEEDED)return result;
 if(!(GridPips>=10 && ReclaimPips>0 && ReclaimPips<GridPips/4)){Print("Invalid strategy inputs");return INIT_PARAMETERS_INCORRECT;}
 
 // KeepHandle does not record invalid handles, so compare registry count to expected allocations.
 if(ArraySize(aai_handles)!=1){Print("Indicator creation failed");return INIT_FAILED;}
 return INIT_SUCCEEDED;
}
void OnDeinit(const int reason){CommonDeinit();}
int StrategySignal(double &stop,double &target,double &absolute)
{
 double grid=GridPips*Pip(),level=MathRound(bar[1].open/grid)*grid,b=ReclaimPips*Pip();
 if(bar[1].low<level-b && bar[1].open>=level && bar[1].close>level+b && bar[1].close>bar[1].open)return 1;
 if(bar[1].high>level+b && bar[1].open<=level && bar[1].close<level-b && bar[1].close<bar[1].open)return -1;return 0;
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
