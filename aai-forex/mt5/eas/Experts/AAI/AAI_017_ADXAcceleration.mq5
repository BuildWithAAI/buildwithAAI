/*
AAI 017: ADX Directional Acceleration
Family: directional-strength expansion | Style: scalp | Signal timeframe: M15
Logic: ADX14 newly crosses above 25; dominant DI exceeds other by >=8; close exceeds previous candle high/low. SL StopATR*ATR, TP 2R; exit when ADX <20 or DI dominance reverses.
Rationale: Transition from low to stronger directional movement may be more informative than high ADX alone.
Failure modes: ADX is nondirectional by itself and often peaks after much of the move.
UNCOMPILED / UNTESTED research hypothesis, not a profitable or institutional-grade claim.
Strategy Tester only. No martingale, grid, averaging down, DLL or web requests.
*/
#property strict
#property version "1.00"
#define AAI_MAGIC 2601017
#define AAI_NAME "AAI_017_ADXAcceleration"
#define AAI_DEFAULT_TF PERIOD_M15
#include <AAI/AAI_Common.mqh>
input group "Strategy hypothesis inputs"
input int ADXPeriod=14;
input double Strength=25.0;
input double DIGap=8.0;
int adx;

bool StrategyReady(){return Ready(adx,ADXPeriod*5);}
int OnInit()
{
 int result=CommonInit();if(result!=INIT_SUCCEEDED)return result;
 if(!(ADXPeriod>=3 && ADXPeriod<=100 && Strength>20 && Strength<60 && DIGap>=0)){Print("Invalid strategy inputs");return INIT_PARAMETERS_INCORRECT;}
 adx=KeepHandle(iADX(_Symbol,SignalTF,ADXPeriod));
 // KeepHandle does not record invalid handles, so compare registry count to expected allocations.
 if(ArraySize(aai_handles)!=2){Print("Indicator creation failed");return INIT_FAILED;}
 return INIT_SUCCEEDED;
}
void OnDeinit(const int reason){CommonDeinit();}
int StrategySignal(double &stop,double &target,double &absolute)
{
 double a=Buf(adx,0),old=Buf(adx,0,2),plus=Buf(adx,1),minus=Buf(adx,2);
 if(a<Strength || old>=Strength)return 0;stop=StopATR*ATR();target=2*stop;
 if(plus-minus>=DIGap && bar[1].close>bar[2].high)return 1;
 if(minus-plus>=DIGap && bar[1].close<bar[2].low)return -1;return 0;
}
bool StrategyExit(int side)
{
 double a=Buf(adx,0),p=Buf(adx,1),m=Buf(adx,2);if(aai_data_ok && (a<20 || side*(p-m)<0)){CloseOwn();return true;}
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
