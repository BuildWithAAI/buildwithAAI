/*
AAI 016: Ichimoku Cloud Escape
Family: cloud trend structure | Style: swing | Signal timeframe: H1
Logic: Completed close newly escapes above/below the visible cloud, Tenkan above/below Kijun and cloud polarity aligned. SL 2 ATR; no target; close through Kijun exits; max 7 days. No future Chikou comparison.
Rationale: Agreement of short, medium and displaced range midpoints may identify persistent directional structure.
Failure modes: Lag, false cloud escapes and sensitivity to market-specific period convention.
UNCOMPILED / UNTESTED research hypothesis, not a profitable or institutional-grade claim.
Strategy Tester only. No martingale, grid, averaging down, DLL or web requests.
*/
#property strict
#property version "1.00"
#define AAI_MAGIC 2601016
#define AAI_NAME "AAI_016_IchimokuCloud"
#define AAI_DEFAULT_TF PERIOD_H1
#define AAI_DEFAULT_TARGET 0
#define AAI_DEFAULT_HOLD 10080
#include <AAI/AAI_Common.mqh>
input group "Strategy hypothesis inputs"
input int Tenkan=9;
input int Kijun=26;
input int SpanB=52;
int cloud;

bool StrategyReady(){return Ready(cloud,SpanB+Kijun+100);}
int OnInit()
{
 int result=CommonInit();if(result!=INIT_SUCCEEDED)return result;
 if(!(Tenkan>=2 && Kijun>Tenkan && SpanB>Kijun && SpanB<=250)){Print("Invalid strategy inputs");return INIT_PARAMETERS_INCORRECT;}
 cloud=KeepHandle(iIchimoku(_Symbol,SignalTF,Tenkan,Kijun,SpanB));
 // KeepHandle does not record invalid handles, so compare registry count to expected allocations.
 if(ArraySize(aai_handles)!=2){Print("Indicator creation failed");return INIT_FAILED;}
 return INIT_SUCCEEDED;
}
void OnDeinit(const int reason){CommonDeinit();}
int StrategySignal(double &stop,double &target,double &absolute)
{
 // Senkou buffers are read at the visible bar coordinate: positive shift 1, NOT -Kijun.
 double a=Buf(cloud,2,1),b=Buf(cloud,3,1),pa=Buf(cloud,2,2),pb=Buf(cloud,3,2);
 double ten=Buf(cloud,0),kij=Buf(cloud,1);stop=2*ATR();target=0;
 if(bar[1].close>MathMax(a,b) && bar[2].close<=MathMax(pa,pb) && ten>kij && a>b)return 1;
 if(bar[1].close<MathMin(a,b) && bar[2].close>=MathMin(pa,pb) && ten<kij && a<b)return -1;return 0;
}
bool StrategyExit(int side)
{
 double k=Buf(cloud,1);if(aai_data_ok && ((side==1 && bar[1].close<k) || (side==-1 && bar[1].close>k))){CloseOwn();return true;}
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
