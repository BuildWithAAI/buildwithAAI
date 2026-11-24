/*
AAI 002: Zoora ATR-Band Pullback
Family: EMA pullback | Style: scalp/sniper | Signal timeframe: H1
Logic: In completed H4 Zoora regime, buy a signal bar that touches the H4 fast EMA plus a 0.25 ATR band and closes back above; short is symmetric. Stop StopATR times signal ATR; 2R target; regime-change exit.
Rationale: Trend pullbacks may offer lower entry risk than chasing extensions.
Failure modes: An apparent pullback can become a reversal; H4 levels are deliberately delayed until completed.
UNCOMPILED / UNTESTED research hypothesis, not a profitable or institutional-grade claim.
Strategy Tester only. No martingale, grid, averaging down, DLL or web requests.
*/
#property strict
#property version "1.00"
#define AAI_MAGIC 2601002
#define AAI_NAME "AAI_002_ZooraPullback"
#define AAI_DEFAULT_TF PERIOD_H1
#include <AAI/AAI_Common.mqh>
input group "Strategy hypothesis inputs"
input int FastEMA=200;
input int SlowEMA=800;
input double BandATR=0.25;
int f,s;

bool StrategyReady(){return Ready(f,FastEMA*3) && Ready(s,SlowEMA*3);}
int OnInit()
{
 int result=CommonInit();if(result!=INIT_SUCCEEDED)return result;
 if(!(FastEMA>=2 && SlowEMA>FastEMA && SlowEMA<=2000 && BandATR>=0 && BandATR<=2)){Print("Invalid strategy inputs");return INIT_PARAMETERS_INCORRECT;}
 f=MA(PERIOD_H4,FastEMA);s=MA(PERIOD_H4,SlowEMA);
 // KeepHandle does not record invalid handles, so compare registry count to expected allocations.
 if(ArraySize(aai_handles)!=3){Print("Indicator creation failed");return INIT_FAILED;}
 return INIT_SUCCEEDED;
}
void OnDeinit(const int reason){CommonDeinit();}
int StrategySignal(double &stop,double &target,double &absolute)
{
 int r=Regime(f,s,PERIOD_H4);double level=Buf(f),a=ATR();stop=StopATR*a;target=2*stop;
 if(r==1 && bar[1].low<=level+BandATR*a && bar[1].high>=level-BandATR*a && bar[1].close>level && bar[1].close>bar[1].open)return 1;
 if(r==-1 && bar[1].high>=level-BandATR*a && bar[1].low<=level+BandATR*a && bar[1].close<level && bar[1].close<bar[1].open)return -1;
 return 0;
}
bool StrategyExit(int side)
{
 int r=Regime(f,s,PERIOD_H4);if(aai_data_ok && r!=side){CloseOwn();return true;}
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
