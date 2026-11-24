/*
AAI 025: Gold Asian-Range London Retest
Family: breakout retest / metals | Style: sniper | Signal timeframe: M5
Logic: Gold-oriented but symbol-generic: build UTC 00-06 M5 range, London first three hours only. Bar2 closes outside range; bar1 retests broken edge within 0.15 ATR and closes back outside. Stop beyond retest wick or StopATR*ATR, whichever wider; TP 3R; max 4h.
Rationale: Gold can transition from Asian balance to London price discovery; retest demands acceptance beyond the broken range rather than chasing the first escape.
Failure modes: Gold volatility/spread and contract minimum often make this impossible on $100. Not a gold-only symbol check; pip override mandatory for CFDs.
UNCOMPILED / UNTESTED research hypothesis, not a profitable or institutional-grade claim.
Strategy Tester only. No martingale, grid, averaging down, DLL or web requests.
*/
#property strict
#property version "1.00"
#define AAI_MAGIC 2601025
#define AAI_NAME "AAI_025_GoldLondonRetest"
#define AAI_DEFAULT_TF PERIOD_M5
#define AAI_DEFAULT_HOLD 240
#include <AAI/AAI_Common.mqh>
input group "Strategy hypothesis inputs"
input int AsiaStartUTC=0;
input int AsiaEndUTC=6;
input double RetestATR=0.15;


bool StrategyReady(){return true;}
int OnInit()
{
 int result=CommonInit();if(result!=INIT_SUCCEEDED)return result;
 if(!(AsiaStartUTC>=0 && AsiaEndUTC>AsiaStartUTC && AsiaEndUTC<=24 && RetestATR>0 && RetestATR<=1)){Print("Invalid strategy inputs");return INIT_PARAMETERS_INCORRECT;}
 
 // KeepHandle does not record invalid handles, so compare registry count to expected allocations.
 if(ArraySize(aai_handles)!=1){Print("Indicator creation failed");return INIT_FAILED;}
 return INIT_SUCCEEDED;
}
void OnDeinit(const int reason){CommonDeinit();}
int StrategySignal(double &stop,double &target,double &absolute)
{
 if(!LondonSignal(bar[1].time))return 0;double hi,lo;if(!DayRange(AsiaStartUTC,AsiaEndUTC,hi,lo))return 0;
 double a=ATR(),b=RetestATR*a;MqlTick q;if(!SymbolInfoTick(_Symbol,q))return 0;
 // Both confirmation bars must be after the completed Asian range.
 if(HourUTC(bar[2].time)<AsiaEndUTC)return 0;
 if(bar[2].close>hi && bar[1].low<=hi+b && bar[1].low>=hi-b && bar[1].close>hi && bar[1].close>bar[1].open)
 {stop=MathMax(StopATR*a,q.ask-(bar[1].low-TickSize()));target=3*stop;return 1;}
 if(bar[2].close<lo && bar[1].high>=lo-b && bar[1].high<=lo+b && bar[1].close<lo && bar[1].close<bar[1].open)
 {stop=MathMax(StopATR*a,bar[1].high+TickSize()-q.bid);target=3*stop;return -1;}return 0;
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
