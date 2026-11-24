/*
AAI 012: RSI(2) Trend Pullback
Family: oscillator pullback | Style: swing | Signal timeframe: H1
Logic: Above EMA200 and prior RSI2 below 10, buy when RSI2 crosses back above 10; mirrored short at 90 below EMA200. SL 2 ATR; no target; exit at RSI2 >=70 long/<=30 short or 2 days.
Rationale: A very short oscillator can flag temporary countertrend exhaustion within a slower drift. Connors-inspired, not a reproduction of an equity system.
Failure modes: Pullbacks become trends and RSI thresholds lack a verified forex edge.
UNCOMPILED / UNTESTED research hypothesis, not a profitable or institutional-grade claim.
Strategy Tester only. No martingale, grid, averaging down, DLL or web requests.
*/
#property strict
#property version "1.00"
#define AAI_MAGIC 2601012
#define AAI_NAME "AAI_012_RSI2Pullback"
#define AAI_DEFAULT_TF PERIOD_H1
#define AAI_DEFAULT_TARGET 0
#define AAI_DEFAULT_HOLD 2880
#include <AAI/AAI_Common.mqh>
input group "Strategy hypothesis inputs"
input int TrendEMA=200;
input double Oversold=10;
input double Overbought=90;
int f,rsi;

bool StrategyReady(){return Ready(f,TrendEMA*3) && Ready(rsi,30);}
int OnInit()
{
 int result=CommonInit();if(result!=INIT_SUCCEEDED)return result;
 if(!(TrendEMA>=20 && TrendEMA<=500 && Oversold>0 && Oversold<30 && Overbought>70 && Overbought<100)){Print("Invalid strategy inputs");return INIT_PARAMETERS_INCORRECT;}
 f=MA(SignalTF,TrendEMA);rsi=KeepHandle(iRSI(_Symbol,SignalTF,2,PRICE_CLOSE));
 // KeepHandle does not record invalid handles, so compare registry count to expected allocations.
 if(ArraySize(aai_handles)!=3){Print("Indicator creation failed");return INIT_FAILED;}
 return INIT_SUCCEEDED;
}
void OnDeinit(const int reason){CommonDeinit();}
int StrategySignal(double &stop,double &target,double &absolute)
{
 double e=Buf(f),r=Buf(rsi),prev=Buf(rsi,0,2);stop=2*ATR();target=0;
 if(bar[1].close>e && prev<Oversold && r>=Oversold)return 1;
 if(bar[1].close<e && prev>Overbought && r<=Overbought)return -1;return 0;
}
bool StrategyExit(int side)
{
 double r=Buf(rsi);if(aai_data_ok && ((side==1 && r>=70) || (side==-1 && r<=30))){CloseOwn();return true;}
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
