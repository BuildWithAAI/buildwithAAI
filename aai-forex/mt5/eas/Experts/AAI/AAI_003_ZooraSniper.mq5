/*
AAI 003: Zoora H4-Level Sniper
Family: level plus breakout | Style: sniper | Signal timeframe: H1
Logic: Completed H4 Zoora regime. Long H1 range overlaps H4 EMA200 +/-5 pips and closes above prior two H1 highs; short overlaps EMA800 and closes below prior two lows. Signal-bar opens in first three London/NY hours. 12-pip SL, 36-pip TP; completed-close BE at +1R; exit on regime change.
Rationale: Combines directional persistence, a pullback to a slow reference level, and local confirmation. This is the least-bad earlier research hypothesis, not an edge.
Failure modes: Only 45 earlier proxy OOS trades, roughly breakeven and cost-fragile; exact execution and UTC/day definitions differ from Python.
UNCOMPILED / UNTESTED research hypothesis, not a profitable or institutional-grade claim.
Strategy Tester only. No martingale, grid, averaging down, DLL or web requests.
*/
#property strict
#property version "1.00"
#define AAI_MAGIC 2601003
#define AAI_NAME "AAI_003_ZooraSniper"
#define AAI_DEFAULT_TF PERIOD_H1
#define AAI_DEFAULT_STOP 12
#define AAI_DEFAULT_TARGET 36
#define AAI_DEFAULT_BE 1
#define AAI_DEFAULT_HOLD 0
#include <AAI/AAI_Common.mqh>
input group "Strategy hypothesis inputs"
input int FastEMA=200;
input int SlowEMA=800;
input double LevelBandPips=5.0;
int f,s;

bool StrategyReady(){return Ready(f,FastEMA*3) && Ready(s,SlowEMA*3);}
int OnInit()
{
 int result=CommonInit();if(result!=INIT_SUCCEEDED)return result;
 if(!(SignalTF==PERIOD_H1 && FastEMA>=2 && SlowEMA>FastEMA && SlowEMA<=2000 && LevelBandPips>0)){Print("Invalid strategy inputs");return INIT_PARAMETERS_INCORRECT;}
 f=MA(PERIOD_H4,FastEMA);s=MA(PERIOD_H4,SlowEMA);
 // KeepHandle does not record invalid handles, so compare registry count to expected allocations.
 if(ArraySize(aai_handles)!=3){Print("Indicator creation failed");return INIT_FAILED;}
 return INIT_SUCCEEDED;
}
void OnDeinit(const int reason){CommonDeinit();}
int StrategySignal(double &stop,double &target,double &absolute)
{
 if(!LondonSignal(bar[1].time) && !NYSignal(bar[1].time))return 0;
 int r=Regime(f,s,PERIOD_H4);double level=(r>0?Buf(f):Buf(s));double b=LevelBandPips*Pip();
 if(bar[1].low>level+b || bar[1].high<level-b)return 0;
 if(r==1 && bar[1].close>HighN(2,2))return 1;
 if(r==-1 && bar[1].close<LowN(2,2))return -1;return 0;
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
