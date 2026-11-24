/*
AAI 024: Three-Horizon Momentum Agreement
Family: multi-timeframe momentum | Style: swing | Signal timeframe: H1
Logic: Completed D1 5-bar, H4 6-bar and H1 12-bar returns all agree and exceed 0.5 ATR of their respective timeframes; enter only when H1 momentum newly qualifies. Stop 2 signal ATR; no target; 40-pip close trail after +1R; exit if D1/H4 sign flips.
Rationale: Agreement across horizons may reflect broader repricing rather than a single noisy fluctuation.
Failure modes: Correlated filters and late entries; threshold selection easily overfits.
UNCOMPILED / UNTESTED research hypothesis, not a profitable or institutional-grade claim.
Strategy Tester only. No martingale, grid, averaging down, DLL or web requests.
*/
#property strict
#property version "1.00"
#define AAI_MAGIC 2601024
#define AAI_NAME "AAI_024_MTFMomentum"
#define AAI_DEFAULT_TF PERIOD_H1
#define AAI_DEFAULT_TARGET 0
#define AAI_DEFAULT_TRAIL 40
#define AAI_DEFAULT_HOLD 10080
#include <AAI/AAI_Common.mqh>
input group "Strategy hypothesis inputs"
input double MomentumATR=0.5;
int datr,hatr;

bool StrategyReady(){return Ready(datr,ATRPeriod*3) && Ready(hatr,ATRPeriod*3) && Bars(_Symbol,PERIOD_D1)>30 && Bars(_Symbol,PERIOD_H4)>30;}
int OnInit()
{
 int result=CommonInit();if(result!=INIT_SUCCEEDED)return result;
 if(!(MomentumATR>0 && MomentumATR<=3)){Print("Invalid strategy inputs");return INIT_PARAMETERS_INCORRECT;}
 datr=KeepHandle(iATR(_Symbol,PERIOD_D1,ATRPeriod));hatr=KeepHandle(iATR(_Symbol,PERIOD_H4,ATRPeriod));
 // KeepHandle does not record invalid handles, so compare registry count to expected allocations.
 if(ArraySize(aai_handles)!=3){Print("Indicator creation failed");return INIT_FAILED;}
 return INIT_SUCCEEDED;
}
void OnDeinit(const int reason){CommonDeinit();}
int StrategySignal(double &stop,double &target,double &absolute)
{
 double d=iClose(_Symbol,PERIOD_D1,1)-iClose(_Symbol,PERIOD_D1,6);
 double h=iClose(_Symbol,PERIOD_H4,1)-iClose(_Symbol,PERIOD_H4,7);
 double m=bar[1].close-bar[13].close,old=bar[2].close-bar[14].close;
 double dt=MomentumATR*Buf(datr),ht=MomentumATR*Buf(hatr),mt=MomentumATR*ATR();
 stop=2*ATR();target=0;
 if(d>dt && h>ht && m>mt && old<=MomentumATR*ATR(2))return 1;
 if(d<-dt && h<-ht && m<-mt && old>=-MomentumATR*ATR(2))return -1;return 0;
}
bool StrategyExit(int side)
{
 double d=iClose(_Symbol,PERIOD_D1,1)-iClose(_Symbol,PERIOD_D1,6),h=iClose(_Symbol,PERIOD_H4,1)-iClose(_Symbol,PERIOD_H4,7);
 if(aai_data_ok && (side*d<=0 || side*h<=0)){CloseOwn();return true;}
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
