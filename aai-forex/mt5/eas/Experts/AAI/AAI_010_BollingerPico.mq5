/*
AAI 010: Bollinger Re-entry Pico
Family: short-horizon mean reversion | Style: pico | Signal timeframe: M1
Logic: In flat EMA50 conditions (3-bar slope <0.15 ATR), prior close outside 2-sigma Bollinger band and latest close back inside enters toward mean. 5-pip SL/8-pip TP, max 10 min.
Rationale: Short liquidity shocks may overshoot a slowly moving local equilibrium.
Failure modes: Costs consume much of an 8-pip target; repeated band-walking in trends.
UNCOMPILED / UNTESTED research hypothesis, not a profitable or institutional-grade claim.
Strategy Tester only. No martingale, grid, averaging down, DLL or web requests.
*/
#property strict
#property version "1.00"
#define AAI_MAGIC 2601010
#define AAI_NAME "AAI_010_BollingerPico"
#define AAI_DEFAULT_TF PERIOD_M1
#define AAI_DEFAULT_STOP 5
#define AAI_DEFAULT_TARGET 8
#define AAI_DEFAULT_HOLD 10
#include <AAI/AAI_Common.mqh>
input group "Strategy hypothesis inputs"
input int BandPeriod=20;
input double BandDeviation=2.0;
int bands,f;

bool StrategyReady(){return Ready(bands,BandPeriod*3) && Ready(f,150);}
int OnInit()
{
 int result=CommonInit();if(result!=INIT_SUCCEEDED)return result;
 if(!(BandPeriod>=5 && BandPeriod<=100 && BandDeviation>0.5 && BandDeviation<=4)){Print("Invalid strategy inputs");return INIT_PARAMETERS_INCORRECT;}
 bands=KeepHandle(iBands(_Symbol,SignalTF,BandPeriod,0,BandDeviation,PRICE_CLOSE));f=MA(SignalTF,50);
 // KeepHandle does not record invalid handles, so compare registry count to expected allocations.
 if(ArraySize(aai_handles)!=3){Print("Indicator creation failed");return INIT_FAILED;}
 return INIT_SUCCEEDED;
}
void OnDeinit(const int reason){CommonDeinit();}
int StrategySignal(double &stop,double &target,double &absolute)
{
 if(MathAbs(Buf(f)-Buf(f,0,4))>0.15*ATR())return 0;
 double upper=Buf(bands,1),lower=Buf(bands,2),pu=Buf(bands,1,2),pl=Buf(bands,2,2);
 if(bar[2].close<pl && bar[1].close>lower && bar[1].close<upper)return 1;
 if(bar[2].close>pu && bar[1].close<upper && bar[1].close>lower)return -1;return 0;
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
