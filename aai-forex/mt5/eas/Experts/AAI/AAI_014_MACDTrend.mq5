/*
AAI 014: MACD Histogram Turn with Slow Bias
Family: momentum crossover | Style: scalp | Signal timeframe: M15
Logic: MACD(12,26,9) main crosses signal in direction of EMA200 bias and main-line sign. SL StopATR*ATR; 2R target; opposite cross exits; max 6h.
Rationale: Momentum reacceleration after a pause can align entry timing with a larger directional drift.
Failure modes: Whipsaw and redundant lagging filters; MACD main minus signal is used, not an MT4-only histogram buffer.
UNCOMPILED / UNTESTED research hypothesis, not a profitable or institutional-grade claim.
Strategy Tester only. No martingale, grid, averaging down, DLL or web requests.
*/
#property strict
#property version "1.00"
#define AAI_MAGIC 2601014
#define AAI_NAME "AAI_014_MACDTrend"
#define AAI_DEFAULT_TF PERIOD_M15
#include <AAI/AAI_Common.mqh>
input group "Strategy hypothesis inputs"
input int BiasEMA=200;
int f,macd;

bool StrategyReady(){return Ready(f,BiasEMA*3) && Ready(macd,100);}
int OnInit()
{
 int result=CommonInit();if(result!=INIT_SUCCEEDED)return result;
 if(!(BiasEMA>=20 && BiasEMA<=500)){Print("Invalid strategy inputs");return INIT_PARAMETERS_INCORRECT;}
 f=MA(SignalTF,BiasEMA);macd=KeepHandle(iMACD(_Symbol,SignalTF,12,26,9,PRICE_CLOSE));
 // KeepHandle does not record invalid handles, so compare registry count to expected allocations.
 if(ArraySize(aai_handles)!=3){Print("Indicator creation failed");return INIT_FAILED;}
 return INIT_SUCCEEDED;
}
void OnDeinit(const int reason){CommonDeinit();}
int StrategySignal(double &stop,double &target,double &absolute)
{
 double m=Buf(macd,0),sig=Buf(macd,1),old=Buf(macd,0,2)-Buf(macd,1,2);stop=StopATR*ATR();target=2*stop;
 if(m>sig && old<=0 && m>0 && bar[1].close>Buf(f))return 1;
 if(m<sig && old>=0 && m<0 && bar[1].close<Buf(f))return -1;return 0;
}
bool StrategyExit(int side)
{
 double h=Buf(macd,0)-Buf(macd,1);if(aai_data_ok && side*h<0){CloseOwn();return true;}
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
