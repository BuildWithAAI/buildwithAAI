/*
AAI 011: Bollinger-Keltner Squeeze Release
Family: volatility compression breakout | Style: scalp | Signal timeframe: M15
Logic: Prior 2-sigma Bollinger width lies inside EMA20 +/-1.5 ATR; latest close escapes current Bollinger band and width expands. SL StopATR*ATR; TP 2R; max 6h.
Rationale: Compression followed by expansion can reveal new directional information.
Failure modes: Squeezes can persist or release falsely; expansion is not necessarily directional continuation.
UNCOMPILED / UNTESTED research hypothesis, not a profitable or institutional-grade claim.
Strategy Tester only. No martingale, grid, averaging down, DLL or web requests.
*/
#property strict
#property version "1.00"
#define AAI_MAGIC 2601011
#define AAI_NAME "AAI_011_BollingerSqueeze"
#define AAI_DEFAULT_TF PERIOD_M15
#include <AAI/AAI_Common.mqh>
input group "Strategy hypothesis inputs"
input int BandPeriod=20;
input double BandDeviation=2.0;
input double SqueezeATR=1.5;
int bands,f;

bool StrategyReady(){return Ready(bands,BandPeriod*3) && Ready(f,60);}
int OnInit()
{
 int result=CommonInit();if(result!=INIT_SUCCEEDED)return result;
 if(!(BandPeriod>=5 && BandPeriod<=100 && BandDeviation>0.5 && BandDeviation<=4 && SqueezeATR>0 && SqueezeATR<=4)){Print("Invalid strategy inputs");return INIT_PARAMETERS_INCORRECT;}
 bands=KeepHandle(iBands(_Symbol,SignalTF,BandPeriod,0,BandDeviation,PRICE_CLOSE));f=MA(SignalTF,20);
 // KeepHandle does not record invalid handles, so compare registry count to expected allocations.
 if(ArraySize(aai_handles)!=3){Print("Indicator creation failed");return INIT_FAILED;}
 return INIT_SUCCEEDED;
}
void OnDeinit(const int reason){CommonDeinit();}
int StrategySignal(double &stop,double &target,double &absolute)
{
 double u2=Buf(bands,1,2),l2=Buf(bands,2,2),e2=Buf(f,0,2),a2=ATR(2);
 if(u2>e2+SqueezeATR*a2 || l2<e2-SqueezeATR*a2)return 0;
 double u=Buf(bands,1),l=Buf(bands,2);if(u-l<=u2-l2)return 0;
 stop=StopATR*ATR();target=2*stop;
 if(bar[1].close>u)return 1;if(bar[1].close<l)return -1;return 0;
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
