/*
AAI 006: New York Impulse Continuation
Family: volatility impulse | Style: scalp | Signal timeframe: M5
Logic: First two NY hours: a fresh candle body >=0.8 ATR, >1.5 times prior body, close in outer 20% of its range and correct side of EMA50. Enter next bar, 10-pip stop/25-pip target, max 90 min.
Rationale: Large one-sided opening flow can continue while participants adjust inventories.
Failure modes: Exhaustion candles and news spread/slippage; no future candle confirmation is used.
UNCOMPILED / UNTESTED research hypothesis, not a profitable or institutional-grade claim.
Strategy Tester only. No martingale, grid, averaging down, DLL or web requests.
*/
#property strict
#property version "1.00"
#define AAI_MAGIC 2601006
#define AAI_NAME "AAI_006_NYImpulse"
#define AAI_DEFAULT_TF PERIOD_M5
#define AAI_DEFAULT_STOP 10
#define AAI_DEFAULT_TARGET 25
#define AAI_DEFAULT_HOLD 90
#include <AAI/AAI_Common.mqh>
input group "Strategy hypothesis inputs"
input int TrendEMA=50;
input double BodyATR=0.8;
int f;

bool StrategyReady(){return Ready(f,TrendEMA*3);}
int OnInit()
{
 int result=CommonInit();if(result!=INIT_SUCCEEDED)return result;
 if(!(TrendEMA>=5 && TrendEMA<=500 && BodyATR>0 && BodyATR<=3)){Print("Invalid strategy inputs");return INIT_PARAMETERS_INCORRECT;}
 f=MA(SignalTF,TrendEMA);
 // KeepHandle does not record invalid handles, so compare registry count to expected allocations.
 if(ArraySize(aai_handles)!=2){Print("Indicator creation failed");return INIT_FAILED;}
 return INIT_SUCCEEDED;
}
void OnDeinit(const int reason){CommonDeinit();}
int StrategySignal(double &stop,double &target,double &absolute)
{
 if(!NYSignal(bar[1].time,2))return 0;
 double body=bar[1].close-bar[1].open,range=bar[1].high-bar[1].low;
 if(range<=0 || MathAbs(body)<BodyATR*ATR() || MathAbs(body)<1.5*MathAbs(bar[2].close-bar[2].open))return 0;
 double e=Buf(f);
 if(body>0 && bar[1].close>e && bar[1].close>=bar[1].high-0.2*range)return 1;
 if(body<0 && bar[1].close<e && bar[1].close<=bar[1].low+0.2*range)return -1;return 0;
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
