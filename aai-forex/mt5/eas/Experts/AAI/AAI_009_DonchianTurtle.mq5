/*
AAI 009: Donchian 20/10 Turtle
Family: channel trend following | Style: swing | Signal timeframe: H4
Logic: Completed close above previous 20 highs/below lows enters. Initial SL 2 ATR, no target; exit on completed close beyond the opposite prior 10-bar channel; no pyramiding.
Rationale: Price channel escape is a simple response to directional persistence independent of EMA levels.
Failure modes: Frequent small range-bound losses and very wide stops for $100.
UNCOMPILED / UNTESTED research hypothesis, not a profitable or institutional-grade claim.
Strategy Tester only. No martingale, grid, averaging down, DLL or web requests.
*/
#property strict
#property version "1.00"
#define AAI_MAGIC 2601009
#define AAI_NAME "AAI_009_DonchianTurtle"
#define AAI_DEFAULT_TF PERIOD_H4
#define AAI_DEFAULT_TARGET 0
#define AAI_DEFAULT_HOLD 0
#include <AAI/AAI_Common.mqh>
input group "Strategy hypothesis inputs"
input int EntryBars=20;
input int ExitBars=10;


bool StrategyReady(){return true;}
int OnInit()
{
 int result=CommonInit();if(result!=INIT_SUCCEEDED)return result;
 if(!(EntryBars>=3 && EntryBars<=200 && ExitBars>=2 && ExitBars<EntryBars)){Print("Invalid strategy inputs");return INIT_PARAMETERS_INCORRECT;}
 
 // KeepHandle does not record invalid handles, so compare registry count to expected allocations.
 if(ArraySize(aai_handles)!=1){Print("Indicator creation failed");return INIT_FAILED;}
 return INIT_SUCCEEDED;
}
void OnDeinit(const int reason){CommonDeinit();}
int StrategySignal(double &stop,double &target,double &absolute)
{
 stop=2*ATR();target=0;
 if(bar[1].close>HighN(2,EntryBars) && bar[2].close<=HighN(3,EntryBars))return 1;
 if(bar[1].close<LowN(2,EntryBars) && bar[2].close>=LowN(3,EntryBars))return -1;return 0;
}
bool StrategyExit(int side)
{
 if((side==1 && bar[1].close<LowN(2,ExitBars)) || (side==-1 && bar[1].close>HighN(2,ExitBars))){CloseOwn();return true;}
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
