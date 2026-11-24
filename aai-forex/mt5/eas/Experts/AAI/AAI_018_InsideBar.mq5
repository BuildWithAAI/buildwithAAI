/*
AAI 018: Inside-Bar Mother-Range Break
Family: candle compression | Style: sniper | Signal timeframe: M15
Logic: Bar2 lies wholly inside bar3 (mother). Bar1 closes outside mother range in direction of EMA100 slope. SL beyond mother opposite extreme plus buffer, TP 3R; max 8h.
Rationale: A pause within a directional market can concentrate stops before continuation.
Failure modes: Outside break can exhaust; mother-bar stop often too large for minimum volume.
UNCOMPILED / UNTESTED research hypothesis, not a profitable or institutional-grade claim.
Strategy Tester only. No martingale, grid, averaging down, DLL or web requests.
*/
#property strict
#property version "1.00"
#define AAI_MAGIC 2601018
#define AAI_NAME "AAI_018_InsideBar"
#define AAI_DEFAULT_TF PERIOD_M15
#define AAI_DEFAULT_HOLD 480
#include <AAI/AAI_Common.mqh>
input group "Strategy hypothesis inputs"
input double BufferPips=1.0;
int f;

bool StrategyReady(){return Ready(f,300);}
int OnInit()
{
 int result=CommonInit();if(result!=INIT_SUCCEEDED)return result;
 if(!(BufferPips>0)){Print("Invalid strategy inputs");return INIT_PARAMETERS_INCORRECT;}
 f=MA(SignalTF,100);
 // KeepHandle does not record invalid handles, so compare registry count to expected allocations.
 if(ArraySize(aai_handles)!=2){Print("Indicator creation failed");return INIT_FAILED;}
 return INIT_SUCCEEDED;
}
void OnDeinit(const int reason){CommonDeinit();}
int StrategySignal(double &stop,double &target,double &absolute)
{
 if(bar[2].high>=bar[3].high || bar[2].low<=bar[3].low)return 0;
 double e=Buf(f),old=Buf(f,0,4);MqlTick q;if(!SymbolInfoTick(_Symbol,q))return 0;
 if(bar[1].close>bar[3].high && e>old){stop=q.ask-(bar[3].low-BufferPips*Pip());target=3*stop;return 1;}
 if(bar[1].close<bar[3].low && e<old){stop=bar[3].high+BufferPips*Pip()-q.bid;target=3*stop;return -1;}return 0;
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
