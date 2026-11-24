/*
AAI 021: NR7 Volatility Release
Family: relative range contraction | Style: scalp | Signal timeframe: M15
Logic: Bar2 is strictly the narrowest range of seven bars (2-8). Bar1 closes outside bar2 in direction of EMA50 slope. Structural stop beyond bar2, TP 2.5R; max 6h.
Rationale: Volatility clustering can produce expansion after a local contraction; directional slope supplies a separate bias.
Failure modes: Noise in extremely narrow bars; stops may violate broker minimum distance.
UNCOMPILED / UNTESTED research hypothesis, not a profitable or institutional-grade claim.
Strategy Tester only. No martingale, grid, averaging down, DLL or web requests.
*/
#property strict
#property version "1.00"
#define AAI_MAGIC 2601021
#define AAI_NAME "AAI_021_NR7Expansion"
#define AAI_DEFAULT_TF PERIOD_M15
#include <AAI/AAI_Common.mqh>
input group "Strategy hypothesis inputs"
input double BufferPips=0.5;
int f;

bool StrategyReady(){return Ready(f,150);}
int OnInit()
{
 int result=CommonInit();if(result!=INIT_SUCCEEDED)return result;
 if(!(BufferPips>0)){Print("Invalid strategy inputs");return INIT_PARAMETERS_INCORRECT;}
 f=MA(SignalTF,50);
 // KeepHandle does not record invalid handles, so compare registry count to expected allocations.
 if(ArraySize(aai_handles)!=2){Print("Indicator creation failed");return INIT_FAILED;}
 return INIT_SUCCEEDED;
}
void OnDeinit(const int reason){CommonDeinit();}
int StrategySignal(double &stop,double &target,double &absolute)
{
 double narrow=bar[2].high-bar[2].low;for(int i=3;i<=8;i++)if(bar[i].high-bar[i].low<=narrow)return 0;
 double e=Buf(f),old=Buf(f,0,4);MqlTick q;if(!SymbolInfoTick(_Symbol,q))return 0;
 if(bar[1].close>bar[2].high && e>old){stop=q.ask-(bar[2].low-BufferPips*Pip());target=2.5*stop;return 1;}
 if(bar[1].close<bar[2].low && e<old){stop=bar[2].high+BufferPips*Pip()-q.bid;target=2.5*stop;return -1;}return 0;
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
