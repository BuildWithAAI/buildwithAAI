#ifndef AAI_COMMON_MQH
#define AAI_COMMON_MQH
#include <Trade/Trade.mqh>
// LOCAL RESEARCH ARTIFACT. Trading is hard-disabled outside the Strategy Tester.
#ifndef AAI_DEFAULT_TF
#define AAI_DEFAULT_TF PERIOD_M15
#endif
#ifndef AAI_DEFAULT_STOP
#define AAI_DEFAULT_STOP 12.0
#endif
#ifndef AAI_DEFAULT_TARGET
#define AAI_DEFAULT_TARGET 24.0
#endif
#ifndef AAI_DEFAULT_BE
#define AAI_DEFAULT_BE 0.0
#endif
#ifndef AAI_DEFAULT_TRAIL
#define AAI_DEFAULT_TRAIL 0.0
#endif
#ifndef AAI_DEFAULT_HOLD
#define AAI_DEFAULT_HOLD 360
#endif
input group "Research execution and risk"
input ENUM_TIMEFRAMES SignalTF=AAI_DEFAULT_TF; // Independent of tester chart timeframe
input double RiskPercent=1.0;             // Equity risk target before lot-step flooring
input double MaxRiskPercent=2.0;          // Hard validation: cannot exceed 2 percent
input bool AllowMinimumLot=true;         // Can exceed target, NEVER the maximum risk cap
input double FixedLot=0.0;               // 0=risk sizing; fixed size still passes risk cap
input double CommissionPerLotRoundTurn=7.0; // Account-currency reserve, replace with broker costs
input int SlippageReservePoints=5;       // Additional loss-side sizing reserve, not spread twice
input int DeviationPoints=10;            // Requested execution deviation; not a loss guarantee
input int MaxSpreadPoints=20;            // Broker POINTS, not pips; gold usually needs review
input double PipSizeOverride=0.0;        // Required on non-FX symbols, e.g. gold 0.10 price/unit
input double StopPips=AAI_DEFAULT_STOP;   // Initial execution distance; not forcibly tightened
input double TargetPips=AAI_DEFAULT_TARGET; // 0=no fixed target; some strategies set structural TP
input double BreakEvenAtR=AAI_DEFAULT_BE; // 0=off; close-based, entry is NOT net-cost breakeven
input double TrailPips=AAI_DEFAULT_TRAIL; // 0=off; close-based ratchet after +1 initial R
input int MaxHoldingMinutes=AAI_DEFAULT_HOLD; // 0=unlimited, elapsed market/calendar minutes
input double DailyLossLimitPercent=4.0;  // EA/symbol realized + floating loss; latches for UTC day
input int MaxTradesPerDay=1;             // EA/symbol unique entry orders per UTC date
input group "UTC session clock (explicit offsets; no automatic DST)"
input int ServerGMTOffsetMinutes=120;    // Server timestamp minus UTC, e.g. UTC+2 = 120
input int SessionStartHourUTC=0;         // Equal start/end = all weekday hours
input int SessionEndHourUTC=0;
input int LondonOpenHourUTC=8;           // Winter 8, summer 7: split tests across DST changes
input int NewYorkOpenHourUTC=13;         // Winter 13, summer 12 (08:00 New York)
input bool CloseAtSessionEnd=false;     // Generic UTC session exit, not strategy-specific window
input group "Shared volatility and warmup"
input int ATRPeriod=14;
input double StopATR=1.5;                // Strategies using ATR ignore StopPips for initial distance
input int WarmupBars=250;               // Engine minimum on signal timeframe

CTrade aai_trade;
MqlRates bar[];
int aai_atr=INVALID_HANDLE;
int aai_handles[];
datetime aai_lastbar=0,aai_day=0;
bool aai_daily_latched=false,aai_data_ok=true;
double aai_initial_risk=0.0;
ulong aai_risk_ticket=0;

bool IsFX()
{
 string base=SymbolInfoString(_Symbol,SYMBOL_CURRENCY_BASE);
 string name=_Symbol;StringToUpper(name);StringToUpper(base);
 if(base=="XAU" || base=="XAG" || base=="XPT" || base=="XPD" || StringFind(name,"XAU")>=0 || StringFind(name,"XAG")>=0 || StringFind(name,"GOLD")>=0)return false;
 long mode=SymbolInfoInteger(_Symbol,SYMBOL_TRADE_CALC_MODE);
 return mode==SYMBOL_CALC_MODE_FOREX || mode==SYMBOL_CALC_MODE_FOREX_NO_LEVERAGE;
}
double Pip()
{
 if(PipSizeOverride>0) return PipSizeOverride;
 int digits=(int)SymbolInfoInteger(_Symbol,SYMBOL_DIGITS);
 return SymbolInfoDouble(_Symbol,SYMBOL_POINT)*((digits==3 || digits==5)?10.0:1.0);
}
double TickSize(){ return SymbolInfoDouble(_Symbol,SYMBOL_TRADE_TICK_SIZE); }
double PriceRound(double p,int direction=0)
{
 double t=TickSize();
 if(t<=0) return 0;
 double q=p/t;
 double v=(direction>0?MathCeil(q-1e-9):(direction<0?MathFloor(q+1e-9):MathRound(q)))*t;
 return NormalizeDouble(v,(int)SymbolInfoInteger(_Symbol,SYMBOL_DIGITS));
}
datetime UTC(datetime server_time){return server_time-ServerGMTOffsetMinutes*60;}
datetime UTCDay(datetime server_time)
{
 MqlDateTime d; TimeToStruct(UTC(server_time),d); d.hour=0; d.min=0; d.sec=0;
 return StructToTime(d);
}
int HourUTC(datetime server_time){MqlDateTime d;TimeToStruct(UTC(server_time),d);return d.hour;}
bool InHours(int hour,int start,int finish)
{
 if(start==finish) return true;
 if(start<finish) return hour>=start && hour<finish;
 return hour>=start || hour<finish;
}
bool SessionOK()
{
 MqlDateTime d; TimeToStruct(UTC(TimeCurrent()),d);
 return d.day_of_week!=0 && d.day_of_week!=6 && InHours(d.hour,SessionStartHourUTC,SessionEndHourUTC);
}
bool LondonSignal(datetime t,int hours=3){return InHours(HourUTC(t),LondonOpenHourUTC,(LondonOpenHourUTC+hours)%24);}
bool NYSignal(datetime t,int hours=3){return InHours(HourUTC(t),NewYorkOpenHourUTC,(NewYorkOpenHourUTC+hours)%24);}
int KeepHandle(int h)
{
 if(h==INVALID_HANDLE) return h;
 int n=ArraySize(aai_handles);ArrayResize(aai_handles,n+1);aai_handles[n]=h;return h;
}
int MA(ENUM_TIMEFRAMES tf,int n,ENUM_MA_METHOD method=MODE_EMA)
{return KeepHandle(iMA(_Symbol,tf,n,0,method,PRICE_CLOSE));}
double Buf(int handle,int buffer=0,int shift=1)
{
 double values[];ArraySetAsSeries(values,true);
 if(handle==INVALID_HANDLE || BarsCalculated(handle)<=shift || CopyBuffer(handle,buffer,shift,1,values)!=1 || !MathIsValidNumber(values[0]) || values[0]==EMPTY_VALUE)
 {aai_data_ok=false;return 0.0;}
 return values[0];
}
bool Ready(int handle,int bars){return handle!=INVALID_HANDLE && BarsCalculated(handle)>=bars;}
double ATR(int shift=1){return Buf(aai_atr,0,shift);}
double HighN(int start,int count){double v=-DBL_MAX;for(int i=start;i<start+count;i++)v=MathMax(v,bar[i].high);return v;}
double LowN(int start,int count){double v=DBL_MAX;for(int i=start;i<start+count;i++)v=MathMin(v,bar[i].low);return v;}
int Regime(int fast,int slow,ENUM_TIMEFRAMES tf,int shift=1)
{
 double f=Buf(fast,0,shift),s=Buf(slow,0,shift),c=iClose(_Symbol,tf,shift);
 if(c<=0){aai_data_ok=false;return 0;}
 if(c>s && f>s)return 1;if(c<s && f<s)return -1;return 0;
}
// Completed intraday M5 bars only; missing/partial ranges are rejected. Clock is UTC.
bool DayRange(int start_hour,int end_hour,double &hi,double &lo)
{
 if(start_hour<0 || end_hour>24 || end_hour<=start_hour)return false;
 datetime uday=UTCDay(TimeCurrent());
 datetime begin=uday+start_hour*3600+ServerGMTOffsetMinutes*60;
 datetime end=uday+end_hour*3600+ServerGMTOffsetMinutes*60;
 if(TimeCurrent()<end)return false;
 MqlRates r[];ArraySetAsSeries(r,false);
 int n=CopyRates(_Symbol,PERIOD_M5,begin,end-1,r);
 int expected=(end_hour-start_hour)*12;
 if(n<expected || n<=0 || r[0].time!=begin || r[n-1].time!=end-300)return false;
 hi=-DBL_MAX;lo=DBL_MAX;
 for(int i=0;i<n;i++)
 {
  if(r[i].time<begin || r[i].time>=end || (i>0 && r[i].time-r[i-1].time!=300))return false;
  hi=MathMax(hi,r[i].high);lo=MathMin(lo,r[i].low);
 }
 return hi>lo;
}
bool PriorDay(double &hi,double &lo)
{
 MqlRates d[];ArraySetAsSeries(d,true);
 if(CopyRates(_Symbol,PERIOD_D1,1,1,d)!=1)return false;
 hi=d[0].high;lo=d[0].low;return hi>lo;
}
// Select only this EA's position. Netting entry guard separately blocks ALL symbol positions.
bool OwnPosition(ulong &ticket,int &side)
{
 for(int i=PositionsTotal()-1;i>=0;i--)
 {
  ulong t=PositionGetTicket(i);if(t==0)continue;
  if(PositionGetString(POSITION_SYMBOL)==_Symbol && (ulong)PositionGetInteger(POSITION_MAGIC)==AAI_MAGIC)
  {ticket=t;side=(PositionGetInteger(POSITION_TYPE)==POSITION_TYPE_BUY?1:-1);return true;}
 }
 return false;
}
bool EntryBlockedByPosition()
{
 ulong t;int s;if(OwnPosition(t,s))return true;
 for(int i=OrdersTotal()-1;i>=0;i--)
 {
  ulong order=OrderGetTicket(i);if(order==0)continue;
  if(OrderGetString(ORDER_SYMBOL)==_Symbol && (ulong)OrderGetInteger(ORDER_MAGIC)==AAI_MAGIC)return true;
 }
 if(AccountInfoInteger(ACCOUNT_MARGIN_MODE)!=ACCOUNT_MARGIN_MODE_RETAIL_HEDGING)
 {
  if(PositionSelect(_Symbol)){Print("Skip: netting account already has a position on ",_Symbol);return true;}
 }
 return false;
}
bool TradeResult(bool call_ok,string operation)
{
 uint rc=aai_trade.ResultRetcode();
 bool ok=call_ok && (rc==TRADE_RETCODE_DONE || rc==TRADE_RETCODE_DONE_PARTIAL || rc==TRADE_RETCODE_PLACED || rc==TRADE_RETCODE_NO_CHANGES);
 if(!ok)Print(operation," failed retcode=",rc," ",aai_trade.ResultRetcodeDescription()," error=",GetLastError());
 return ok;
}
bool CloseOwn()
{
 ulong t;int s;if(!OwnPosition(t,s))return true;
 return TradeResult(aai_trade.PositionClose(t,DeviationPoints),"PositionClose");
}
// All deals today establish an account-balance denominator; EA-specific PnL drives the loss check.
bool DayStats(double &pnl,double &base,int &entries)
{
 datetime today=UTCDay(TimeCurrent());
 if(today!=aai_day){aai_day=today;aai_daily_latched=false;}
 datetime server_start=today+ServerGMTOffsetMinutes*60;
 if(!HistorySelect(server_start,TimeCurrent()))return false;
 pnl=0;double all_net=0;entries=0;ulong orders[];
 int deals=HistoryDealsTotal();
 for(int i=0;i<deals;i++)
 {
  ulong d=HistoryDealGetTicket(i);if(d==0)continue;
  double net=HistoryDealGetDouble(d,DEAL_PROFIT)+HistoryDealGetDouble(d,DEAL_COMMISSION)+HistoryDealGetDouble(d,DEAL_SWAP)+HistoryDealGetDouble(d,DEAL_FEE);
  long deal_type=HistoryDealGetInteger(d,DEAL_TYPE);
  // Exclude tester initial deposit and other balance/credit flows from trading PnL.
  if(deal_type==DEAL_TYPE_BUY || deal_type==DEAL_TYPE_SELL)all_net+=net;
  if(HistoryDealGetString(d,DEAL_SYMBOL)!=_Symbol || (ulong)HistoryDealGetInteger(d,DEAL_MAGIC)!=AAI_MAGIC)continue;
  pnl+=net;
  long entry=HistoryDealGetInteger(d,DEAL_ENTRY),type=HistoryDealGetInteger(d,DEAL_TYPE);
  if((entry==DEAL_ENTRY_IN || entry==DEAL_ENTRY_INOUT) && (type==DEAL_TYPE_BUY || type==DEAL_TYPE_SELL))
  {
   ulong order=HistoryDealGetInteger(d,DEAL_ORDER);bool seen=false;
   for(int j=0;j<ArraySize(orders);j++)if(orders[j]==order)seen=true;
   if(!seen){int n=ArraySize(orders);ArrayResize(orders,n+1);orders[n]=order;entries++;}
  }
 }
 base=AccountInfoDouble(ACCOUNT_BALANCE)-all_net;
 ulong ticket;int side;
 if(OwnPosition(ticket,side))pnl+=PositionGetDouble(POSITION_PROFIT)+PositionGetDouble(POSITION_SWAP);
 return base>0;
}
bool DailyOK(bool close_on_breach=true)
{
 double pnl,base;int entries;
 if(!DayStats(pnl,base,entries))return false;
 if(pnl<=-base*DailyLossLimitPercent/100.0)aai_daily_latched=true;
 if(aai_daily_latched)
 {
  if(close_on_breach)CloseOwn();
  return false;
 }
 return true;
}
// Use loss tick value conservatively and cross-check OrderCalcProfit for contract/currency conversion.
double LossPerLot(int side,double entry,double stop)
{
 double tv=SymbolInfoDouble(_Symbol,SYMBOL_TRADE_TICK_VALUE_LOSS);
 double ts=TickSize(),profit;
 if(tv<=0)tv=SymbolInfoDouble(_Symbol,SYMBOL_TRADE_TICK_VALUE);
 if(ts<=0 || tv<=0)return -1;
 ENUM_ORDER_TYPE type=(side>0?ORDER_TYPE_BUY:ORDER_TYPE_SELL);
 if(!OrderCalcProfit(type,_Symbol,1.0,entry,stop,profit))return -1;
 double movement=MathMax(MathAbs(profit),MathAbs(entry-stop)/ts*tv);
 return movement+SlippageReservePoints*SymbolInfoDouble(_Symbol,SYMBOL_POINT)/ts*tv+CommissionPerLotRoundTurn;
}
double VolumeFloor(double lots)
{
 double step=SymbolInfoDouble(_Symbol,SYMBOL_VOLUME_STEP);
 if(step<=0)return 0;
 return NormalizeDouble(MathFloor((lots+1e-12)/step)*step,8);
}
bool StopLevelsOK(int side,double sl,double tp,const MqlTick &q)
{
 double min_dist=SymbolInfoInteger(_Symbol,SYMBOL_TRADE_STOPS_LEVEL)*SymbolInfoDouble(_Symbol,SYMBOL_POINT);
 double ref=(side>0?q.bid:q.ask);
 return sl>0 && (side>0?ref-sl:sl-ref)>=min_dist && (tp==0 || (side>0?tp-ref:ref-tp)>=min_dist);
}
// distance is price units. Optional target_absolute for structural exits.
bool Enter(int side,double distance,double target_distance,double target_absolute=0.0)
{
 if(side!=1 && side!=-1)return false;
 if(EntryBlockedByPosition() || !SessionOK() || !DailyOK())return false;
 double pnl,base;int entries;if(!DayStats(pnl,base,entries) || entries>=MaxTradesPerDay)return false;
 MqlTick q;if(!SymbolInfoTick(_Symbol,q) || q.ask<=q.bid || q.bid<=0)return false;
 double point=SymbolInfoDouble(_Symbol,SYMBOL_POINT);
 if((q.ask-q.bid)/point>MaxSpreadPoints){Print("Skip: spread points ",(q.ask-q.bid)/point);return false;}
 double entry=(side>0?q.ask:q.bid);
 double sl=PriceRound(entry-side*distance,-side);
 double tp=(target_absolute>0?PriceRound(target_absolute,side):(target_distance>0?PriceRound(entry+side*target_distance,side):0));
 if(distance<=0 || !StopLevelsOK(side,sl,tp,q)){Print("Skip: invalid stop/target or broker stops-level; no automatic widening");return false;}
 if(tp!=0 && side*(tp-entry)<=0){Print("Skip: structural target behind entry");return false;}
 double loss=LossPerLot(side,entry,sl),equity=AccountInfoDouble(ACCOUNT_EQUITY);
 if(loss<=0 || equity<=0){Print("Skip: invalid tick value/profit calculation/equity");return false;}
 double cap=equity*MaxRiskPercent/100.0;
 double minlot=SymbolInfoDouble(_Symbol,SYMBOL_VOLUME_MIN),maxlot=SymbolInfoDouble(_Symbol,SYMBOL_VOLUME_MAX);
 double lots=(FixedLot>0?VolumeFloor(FixedLot):VolumeFloor(equity*RiskPercent/100.0/loss));
 if(lots<minlot)
 {
  if(FixedLot>0 || !AllowMinimumLot){Print("Skip: volume below minimum");return false;}
  lots=minlot;
 }
 lots=VolumeFloor(MathMin(lots,maxlot));
 if(lots<minlot || lots*loss>cap+1e-8){Print("Skip: minimum/requested volume exceeds max risk. lots=",lots," planned loss=",lots*loss," cap=",cap);return false;}
 // Prevent a new planned stop from crossing the remaining daily loss allowance.
 double daily_remaining=base*DailyLossLimitPercent/100.0+MathMin(pnl,0.0);
 if(lots*loss>daily_remaining){Print("Skip: remaining daily loss budget too small");return false;}
 double margin=0;
 if(!OrderCalcMargin(side>0?ORDER_TYPE_BUY:ORDER_TYPE_SELL,_Symbol,lots,entry,margin) || margin>AccountInfoDouble(ACCOUNT_MARGIN_FREE)*0.95)
 {Print("Skip: insufficient margin or margin calculation unavailable");return false;}
 bool sent=(side>0?aai_trade.Buy(lots,_Symbol,0,sl,tp,AAI_NAME):aai_trade.Sell(lots,_Symbol,0,sl,tp,AAI_NAME));
 if(!TradeResult(sent,"Entry"))return false;
 ulong ticket;int pos_side;
 if(OwnPosition(ticket,pos_side))
 {
  aai_risk_ticket=ticket;
  double fill=PositionGetDouble(POSITION_PRICE_OPEN),actual_sl=PositionGetDouble(POSITION_SL);
  aai_initial_risk=MathAbs(fill-actual_sl);
  if(actual_sl<=0 || LossPerLot(pos_side,fill,actual_sl)*PositionGetDouble(POSITION_VOLUME)>AccountInfoDouble(ACCOUNT_EQUITY)*MaxRiskPercent/100.0+1e-8)
  {Print("Emergency exit: fill has no SL or exceeds risk reserve");CloseOwn();return false;}
  Print("Entry confirmed volume=",lots," initial stop distance=",aai_initial_risk," planned risk=",lots*loss);
 }
 return true;
}
void AuditPosition()
{
 ulong ticket;int side;if(!OwnPosition(ticket,side))return;
 double sl=PositionGetDouble(POSITION_SL),open=PositionGetDouble(POSITION_PRICE_OPEN);
 if(sl<=0){Print("Emergency: absent position SL");CloseOwn();return;}
 if(ticket==aai_risk_ticket)return;
 double risk=LossPerLot(side,open,sl);
 if(risk<=0 || risk*PositionGetDouble(POSITION_VOLUME)>AccountInfoDouble(ACCOUNT_EQUITY)*MaxRiskPercent/100.0+1e-8)
 {Print("Emergency: newly observed fill exceeds risk cap or cannot be valued");CloseOwn();return;}
 aai_risk_ticket=ticket;aai_initial_risk=MathAbs(open-sl);
}
void TimedManagement()
{
 ulong t;int side;if(!OwnPosition(t,side))return;
 if(PositionGetDouble(POSITION_SL)<=0){Print("Emergency: missing SL");CloseOwn();return;}
 datetime opened=(datetime)PositionGetInteger(POSITION_TIME);
 if((MaxHoldingMinutes>0 && TimeCurrent()-opened>=MaxHoldingMinutes*60) || (CloseAtSessionEnd && !SessionOK()))CloseOwn();
}
// Monotone SL: cannot loosen. Snapshot is the just-completed close, not a retroactive intrabar trail.
void ManageStops(double atr_trail=0.0)
{
 ulong t;int side;if(!OwnPosition(t,side))return;
 double open=PositionGetDouble(POSITION_PRICE_OPEN),old=PositionGetDouble(POSITION_SL),tp=PositionGetDouble(POSITION_TP);
 if(t!=aai_risk_ticket)
 {
  aai_risk_ticket=t;
  // Tester runs never restart mid-position; conservative fallback if reinitialised.
  aai_initial_risk=MathAbs(open-old);
 }
 if(old<=0){Print("Emergency: position without stop");CloseOwn();return;}
 MqlTick q;if(!SymbolInfoTick(_Symbol,q))return;
 double point=SymbolInfoDouble(_Symbol,SYMBOL_POINT);
 double close=(side>0?bar[1].close:bar[1].close+(q.ask-q.bid));
 double profit=side*(close-open),candidate=old;
 if(aai_initial_risk<=0)return;
 if(BreakEvenAtR>0 && profit>=BreakEvenAtR*aai_initial_risk)
  candidate=(side>0?MathMax(candidate,open):MathMin(candidate,open));
 double trail=(atr_trail>0?atr_trail:TrailPips*Pip());
 if(trail>0 && profit>=aai_initial_risk)
 {
  double trailing=close-side*trail;
  candidate=(side>0?MathMax(candidate,trailing):MathMin(candidate,trailing));
 }
 candidate=PriceRound(candidate,-side);
 double freeze=SymbolInfoInteger(_Symbol,SYMBOL_TRADE_FREEZE_LEVEL)*point;
 double ref=(side>0?q.bid:q.ask);
 if(side*(candidate-old)<TickSize()*0.5 || side*(ref-candidate)<=freeze || side*(ref-old)<=freeze || !StopLevelsOK(side,candidate,tp,q))return;
 TradeResult(aai_trade.PositionModify(t,candidate,tp),"Stop modification");
}
bool NewBar()
{
 datetime t=iTime(_Symbol,SignalTF,0);
 if(t==0 || t==aai_lastbar)return false;
 int need=(int)MathMax(WarmupBars+5,300);
 ArraySetAsSeries(bar,true);
 if(CopyRates(_Symbol,SignalTF,0,need,bar)!=need)return false;
 if(!Ready(aai_atr,ATRPeriod+5))return false;
 aai_lastbar=t;aai_data_ok=true;return true;
}
int CommonInit()
{
 if(!MQLInfoInteger(MQL_TESTER)){Print("Research EAs run ONLY inside MT5 Strategy Tester. No live/demo chart execution.");return INIT_FAILED;}
 if(RiskPercent<=0 || MaxRiskPercent<=0 || MaxRiskPercent>2.0 || RiskPercent>MaxRiskPercent || FixedLot<0 || MaxSpreadPoints<=0 || SlippageReservePoints<0 || DeviationPoints<0 || CommissionPerLotRoundTurn<0 || PipSizeOverride<0 || StopPips<=0 || TargetPips<0 || StopATR<=0 || BreakEvenAtR<0 || TrailPips<0 || MaxHoldingMinutes<0 || DailyLossLimitPercent<=0 || DailyLossLimitPercent>25 || MaxTradesPerDay<1 || ATRPeriod<2 || WarmupBars<20 || MathAbs(ServerGMTOffsetMinutes)>840 || SessionStartHourUTC<0 || SessionStartHourUTC>23 || SessionEndHourUTC<0 || SessionEndHourUTC>23 || LondonOpenHourUTC<0 || LondonOpenHourUTC>23 || NewYorkOpenHourUTC<0 || NewYorkOpenHourUTC>23)
 {Print("Invalid common inputs");return INIT_PARAMETERS_INCORRECT;}
 if(!IsFX() && PipSizeOverride<=0){Print("Set PipSizeOverride explicitly for metals/CFDs; a gold pip is not universal");return INIT_PARAMETERS_INCORRECT;}
 if(TickSize()<=0 || SymbolInfoDouble(_Symbol,SYMBOL_POINT)<=0 || SymbolInfoDouble(_Symbol,SYMBOL_VOLUME_STEP)<=0 || SymbolInfoDouble(_Symbol,SYMBOL_VOLUME_MIN)<=0)
 {Print("Symbol specifications unavailable");return INIT_FAILED;}
 aai_trade.SetExpertMagicNumber(AAI_MAGIC);aai_trade.SetAsyncMode(false);
 aai_trade.SetDeviationInPoints(DeviationPoints);aai_trade.SetMarginMode();
 if(!aai_trade.SetTypeFillingBySymbol(_Symbol))return INIT_FAILED;
 aai_atr=KeepHandle(iATR(_Symbol,SignalTF,ATRPeriod));
 if(aai_atr==INVALID_HANDLE)return INIT_FAILED;
 aai_lastbar=iTime(_Symbol,SignalTF,0); // No immediate stale-entry on attaching/reinitialising
 Print(AAI_NAME," research only; point=",SymbolInfoDouble(_Symbol,SYMBOL_POINT)," tick=",TickSize()," minlot=",SymbolInfoDouble(_Symbol,SYMBOL_VOLUME_MIN)," pip=",Pip());
 return INIT_SUCCEEDED;
}
void CommonDeinit(){for(int i=0;i<ArraySize(aai_handles);i++)if(aai_handles[i]!=INVALID_HANDLE)IndicatorRelease(aai_handles[i]);}
#endif
