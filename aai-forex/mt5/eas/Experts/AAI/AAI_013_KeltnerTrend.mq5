/*
AAI 013: Keltner Channel Trend Capture
Family: ATR envelope breakout | Style: swing | Signal timeframe: H1
Logic: EMA40 slope aligned and completed close crosses EMA40 +/-2 ATR envelope. SL 2 ATR, no target; exit on crossing back through middle EMA; max 5 days.
Rationale: Volatility-scaled escape from equilibrium may mark a persistent trend rather than a fixed-pip fluctuation.
Failure modes: Late entries and band break failures; ATR growth expands risk.
UNCOMPILED / UNTESTED research hypothesis, not a profitable or institutional-grade claim.
Strategy Tester only. No martingale, grid, averaging down, DLL or web requests.
*/
#property strict
#property version "1.00"
#define AAI_MAGIC 2601013
#define AAI_NAME "AAI_013_KeltnerTrend"
#define AAI_DEFAULT_TF PERIOD_H1
#define AAI_DEFAULT_TARGET 0
#define AAI_DEFAULT_HOLD 7200
#include <AAI/AAI_Common.mqh>
input group "Strategy hypothesis inputs"
input int CenterEMA=40;
input double ChannelATR=2.0;
int f;

bool StrategyReady(){return Ready(f,CenterEMA*3);}
int OnInit()
{
 int result=CommonInit();if(result!=INIT_SUCCEEDED)return result;
 if(!(CenterEMA>=5 && CenterEMA<=300 && ChannelATR>0 && ChannelATR<=5)){Print("Invalid strategy inputs");return INIT_PARAMETERS_INCORRECT;}
 f=MA(SignalTF,CenterEMA);
 // KeepHandle does not record invalid handles, so compare registry count to expected allocations.
 if(ArraySize(aai_handles)!=2){Print("Indicator creation failed");return INIT_FAILED;}
 return INIT_SUCCEEDED;
}
void OnDeinit(const int reason){CommonDeinit();}
int StrategySignal(double &stop,double &target,double &absolute)
{
 double e=Buf(f),old=Buf(f,0,2),a=ATR(),pa=ATR(2);stop=2*a;target=0;
 if(e>old && bar[1].close>e+ChannelATR*a && bar[2].close<=old+ChannelATR*pa)return 1;
 if(e<old && bar[1].close<e-ChannelATR*a && bar[2].close>=old-ChannelATR*pa)return -1;return 0;
}
bool StrategyExit(int side)
{
 double e=Buf(f);if(aai_data_ok && ((side==1 && bar[1].close<e) || (side==-1 && bar[1].close>e))){CloseOwn();return true;}
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
