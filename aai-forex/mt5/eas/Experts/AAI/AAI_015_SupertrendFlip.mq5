/*
AAI 015: Supertrend Volatility Flip
Family: recursive ATR trend | Style: swing | Signal timeframe: H1
Logic: Reconstruct Supertrend(ATR14, multiplier 3) causally over last 200 completed bars. Enter only on direction flip; SL beyond current band (at least 1 ATR); no target; opposite flip exits; max 7 days.
Rationale: An ATR-adjusted hysteresis band may stay with direction while suppressing small countertrend noise.
Failure modes: Recursive seed and finite warmup sensitivity; no universal trend persistence.
UNCOMPILED / UNTESTED research hypothesis, not a profitable or institutional-grade claim.
Strategy Tester only. No martingale, grid, averaging down, DLL or web requests.
*/
#property strict
#property version "1.00"
#define AAI_MAGIC 2601015
#define AAI_NAME "AAI_015_SupertrendFlip"
#define AAI_DEFAULT_TF PERIOD_H1
#define AAI_DEFAULT_TARGET 0
#define AAI_DEFAULT_HOLD 10080
#include <AAI/AAI_Common.mqh>
input group "Strategy hypothesis inputs"
input double Multiplier=3.0;

void SuperState(int &now,int &prior,double &line)
{
 double upper=0,lower=0,previous_close=0;int direction=1;prior=1;now=1;line=0;
 for(int i=200;i>=1;i--)
 {
  double a=ATR(i),mid=(bar[i].high+bar[i].low)*0.5;
  double bu=mid+Multiplier*a,bl=mid-Multiplier*a;
  if(i==200){upper=bu;lower=bl;direction=(bar[i].close>=mid?1:-1);}
  else
  {
   double old_upper=upper,old_lower=lower;
   upper=(bu<old_upper || previous_close>old_upper)?bu:old_upper;
   lower=(bl>old_lower || previous_close<old_lower)?bl:old_lower;
   if(direction<0 && bar[i].close>upper)direction=1;
   else if(direction>0 && bar[i].close<lower)direction=-1;
  }
  if(i==2)prior=direction;
  previous_close=bar[i].close;
 }
 now=direction;line=(direction>0?lower:upper);
}
bool StrategyReady(){return true;}
int OnInit()
{
 int result=CommonInit();if(result!=INIT_SUCCEEDED)return result;
 if(!(Multiplier>=0.5 && Multiplier<=10)){Print("Invalid strategy inputs");return INIT_PARAMETERS_INCORRECT;}
 
 // KeepHandle does not record invalid handles, so compare registry count to expected allocations.
 if(ArraySize(aai_handles)!=1){Print("Indicator creation failed");return INIT_FAILED;}
 return INIT_SUCCEEDED;
}
void OnDeinit(const int reason){CommonDeinit();}
int StrategySignal(double &stop,double &target,double &absolute)
{
 int now,prior;double bandline;SuperState(now,prior,bandline);
 if(now==prior)return 0;MqlTick q;if(!SymbolInfoTick(_Symbol,q))return 0;
 stop=MathMax(ATR(),now>0?q.ask-bandline:bandline-q.bid);target=0;return now;
}
bool StrategyExit(int side)
{
 int now,prior;double line;SuperState(now,prior,line);if(aai_data_ok && now!=side){CloseOwn();return true;}
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
