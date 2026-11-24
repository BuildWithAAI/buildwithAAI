"""Paper OMS + ledger. Simulated fills only; there is no code path to a real exchange.
Every action (idea, risk decision, order, fill, mark, close, kill switch) is written to the hash-chained audit log."""
from __future__ import annotations
import datetime as dt, json, time, uuid
from zoneinfo import ZoneInfo
from . import audit
from .models import Decision, Idea
from .risk import RiskEngine
from .store import Store, dumps

TZ = ZoneInfo("America/Chicago")
_GLOBAL_KILL = "/workspace/agent-guard/state/KILL_SWITCH"  # agent-guard global kill switch (SECURITY_POLICY.md)


def _global_kill_reason():
    """agent-guard integration: reason string if the box-wide kill switch flag file exists, else None."""
    import os
    f = os.environ.get("AGENT_GUARD_KILL_FILE") or _GLOBAL_KILL
    if not os.path.exists(f):
        return None
    try:
        return json.loads(open(f).read() or "{}").get("reason") or "flag file present"
    except (ValueError, OSError):
        return "flag file present"


class PaperLedger:
    def __init__(self, store: Store, cfg: dict):
        self.s, self.cfg = store, cfg
        self.risk = RiskEngine(cfg)
        self.start_equity = float(cfg["account"]["starting_equity_usd"])
        r = cfg["risk"]
        self.slip, self.fee = r["slippage_bps"] / 1e4, r["fee_bps"] / 1e4

    # ---------------- state
    def kill_switch(self) -> dict:
        ks = self.s.get_control("kill_switch", {"on": False, "reason": None})
        g = _global_kill_reason()  # agent-guard: global kill switch overrides (cannot be resumed from the HUD)
        if g and not ks.get("on"):
            return {"on": True, "reason": f"GLOBAL agent-guard kill switch: {g}", "by": "agent-guard", "global": True}
        return ks

    def set_kill_switch(self, on: bool, reason: str, actor: str = "user"):
        prev = self.kill_switch()
        val = {"on": bool(on), "reason": reason, "by": actor, "ts": time.time()}
        self.s.set_control("kill_switch", val)
        audit.record(self.s, "kill_switch", actor=actor, inputs={"previous": prev}, outcome="on" if on else "off", reasons=[reason])
        return val

    def open_positions(self) -> list[dict]:
        return self.s.query("SELECT * FROM positions WHERE status='open' ORDER BY opened_at")

    def closed_positions(self) -> list[dict]:
        return self.s.query("SELECT * FROM positions WHERE status='closed' ORDER BY closed_at")

    def _unrealized(self, p) -> float:
        px = p["last_px"] if p["last_px"] is not None else p["entry_px"]
        mult = self._mult(p)
        return (px - p["entry_px"]) * p["qty"] * mult * (1 if p["side"] == "long" else -1) - p["fees"]

    def _mult(self, p) -> float:
        inst = self.s.instrument(p["venue"], p["symbol"]) if p["venue"] else None
        return float((inst or {}).get("contract_value") or 1.0)

    def equity(self) -> dict:
        realized = sum(p["realized_pnl"] or 0 for p in self.closed_positions())
        opens = self.open_positions()
        unreal = sum(self._unrealized(p) for p in opens)
        eq = self.start_equity + realized + unreal
        return {"start_equity": self.start_equity, "realized_pnl": round(realized, 6), "unrealized_pnl": round(unreal, 6),
                "equity": round(eq, 6), "open_risk_usd": round(sum(p["risk_usd"] for p in opens), 6), "open_positions": len(opens)}

    def state(self) -> dict:
        e = self.equity()
        return {"equity": e["equity"], "mode": self.cfg["account"]["mode"], "kill_switch": self.kill_switch(),
                "open_positions": [{"sector": p["sector"], "symbol": p["symbol"], "risk_usd": p["risk_usd"]} for p in self.open_positions()]}

    def risk_summary(self) -> dict:
        e = self.equity()
        eq = e["equity"]
        r = self.cfg["risk"]
        by_sector = {}
        for p in self.open_positions():
            by_sector[p["sector"]] = by_sector.get(p["sector"], 0.0) + p["risk_usd"]
        peak = self.s.get_control("equity_peak", self.start_equity)
        day = self.s.get_control("day_start", {}) or {}
        return {**e, "kill_switch": self.kill_switch(),
                "open_risk_pct": e["open_risk_usd"] / eq if eq > 0 else None,
                "limits": {k: r[k] for k in ("min_risk_per_trade", "max_risk_per_trade", "max_total_open_risk", "max_open_positions",
                                             "daily_loss_limit", "max_drawdown_kill")},
                "sector_open_risk_usd": by_sector, "sector_caps": r["sector_caps"],
                "equity_peak": peak, "drawdown_from_peak": (peak - eq) / peak if peak else 0.0,
                "day_start_equity": day.get("equity"), "day": day.get("date")}

    # ---------------- guards
    def check_circuit_breakers(self) -> dict | None:
        """Auto-trip the kill switch on daily loss or drawdown. Returns the trip info, if tripped now."""
        eq = self.equity()["equity"]
        today = dt.datetime.now(TZ).date().isoformat()
        day = self.s.get_control("day_start")
        if not day or day.get("date") != today:
            day = {"date": today, "equity": eq}
            self.s.set_control("day_start", day)
        peak = max(self.s.get_control("equity_peak", self.start_equity), eq)
        self.s.set_control("equity_peak", peak)
        r = self.cfg["risk"]
        reason = None
        if day["equity"] > 0 and (day["equity"] - eq) / day["equity"] >= r["daily_loss_limit"]:
            reason = f"daily loss {(day['equity'] - eq) / day['equity']:.2%} >= limit {r['daily_loss_limit']:.0%}"
        elif peak > 0 and (peak - eq) / peak >= r["max_drawdown_kill"]:
            reason = f"drawdown {(peak - eq) / peak:.2%} >= limit {r['max_drawdown_kill']:.0%}"
        if reason and not self.s.get_control("kill_switch", {"on": False}).get("on"):
            return self.set_kill_switch(True, "AUTO: " + reason, actor="risk_engine")
        return None

    # ---------------- idea lifecycle
    def submit(self, idea: Idea, actor: str = "system", signal: dict | None = None, now: float | None = None) -> Decision:
        self.check_circuit_breakers()
        if signal is None and idea.sector == "solana_meme":
            signal = self.s.latest_signal("solana_meme", idea.symbol)
        inst = self.s.instrument(idea.venue, idea.symbol) if idea.venue else None
        self.s.execute("""INSERT OR REPLACE INTO ideas(id,ts,sector,source,venue,symbol,side,entry,stop,target,requested_risk,signal_id,rationale,payload,status)
                          VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'new')""",
                       (idea.id, idea.ts, idea.sector, idea.source, idea.venue, idea.symbol, idea.side, idea.entry, idea.stop, idea.target,
                        idea.requested_risk, idea.signal_id or (signal or {}).get("id"), idea.rationale, dumps(idea.payload)))
        audit.record(self.s, "idea_received", actor=actor, ref=idea.id, inputs=idea.to_dict(), outcome="received", reasons=[idea.rationale] if idea.rationale else [])
        d = self.risk.evaluate(idea, self.state(), signal=signal, instrument=inst, now=now)
        self.s.execute("INSERT INTO risk_decisions(ts,idea_id,approved,risk_frac,risk_usd,qty,notional,checks,inputs) VALUES(?,?,?,?,?,?,?,?,?)",
                       (time.time(), idea.id, int(d.approved), d.risk_frac, d.risk_usd, d.qty, d.notional,
                        dumps([c.to_dict() for c in d.checks]), dumps(d.inputs)))
        audit.record(self.s, "risk_decision", actor="risk_engine", ref=idea.id, inputs=d.inputs,
                     outcome="approved" if d.approved else "rejected", reasons=d.reasons)
        if not d.approved:
            self.s.execute("UPDATE ideas SET status='rejected' WHERE id=?", (idea.id,))
            return d
        self._fill(idea, d)
        return d

    def _fill(self, idea: Idea, d: Decision):
        oid = "ord_" + uuid.uuid4().hex[:12]
        pid = "pos_" + uuid.uuid4().hex[:12]
        now = time.time()
        mult = float((self.s.instrument(idea.venue, idea.symbol) or {}).get("contract_value") or 1.0) if idea.venue else 1.0
        fill_px = d.fill_px_est
        fee = fill_px * d.qty * mult * self.fee
        with self.s.tx() as s:
            s.conn.execute("INSERT INTO orders(id,ts,idea_id,symbol,venue,side,qty,order_type,limit_px,status,mode) VALUES(?,?,?,?,?,?,?,?,?,?, 'paper')",
                           (oid, now, idea.id, idea.symbol, idea.venue, idea.side, d.qty, "market_sim", None, "filled"))
            s.conn.execute("INSERT INTO fills(ts,order_id,px,qty,fee,slippage_bps) VALUES(?,?,?,?,?,?)",
                           (now, oid, fill_px, d.qty, fee, self.cfg["risk"]["slippage_bps"]))
            s.conn.execute("""INSERT INTO positions(id,idea_id,sector,venue,symbol,side,qty,entry_px,stop,target,risk_usd,opened_at,fees,last_px,status)
                              VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'open')""",
                           (pid, idea.id, idea.sector, idea.venue, idea.symbol, idea.side, d.qty, fill_px, idea.stop, idea.target,
                            d.risk_usd, now, fee, fill_px))
            s.conn.execute("UPDATE ideas SET status='filled' WHERE id=?", (idea.id,))
        audit.record(self.s, "paper_fill", actor="oms", ref=idea.id,
                     inputs={"order_id": oid, "position_id": pid, "px": fill_px, "qty": d.qty, "fee": fee, "mode": "paper"},
                     outcome="filled", reasons=[f"simulated market fill with {self.cfg['risk']['slippage_bps']}bps slippage"])

    def mark(self, symbol: str, px: float, actor: str = "market_data") -> list[dict]:
        """Update marks; close positions whose stop/target is crossed. Gap-through fills at the mark (worse), honestly."""
        closed = []
        for p in self.open_positions():
            if p["symbol"] != symbol:
                continue
            self.s.execute("UPDATE positions SET last_px=? WHERE id=?", (px, p["id"]))
            long = p["side"] == "long"
            if p["stop"] is not None and ((long and px <= p["stop"]) or (not long and px >= p["stop"])):
                exit_px = min(px, p["stop"]) if long else max(px, p["stop"])
                closed.append(self.close(p["id"], exit_px * ((1 - self.slip) if long else (1 + self.slip)), "stop", actor))
            elif p["stop"] is None and px <= 0:
                closed.append(self.close(p["id"], 0.0, "went_to_zero", actor))
            elif p["target"] is not None and ((long and px >= p["target"]) or (not long and px <= p["target"])):
                closed.append(self.close(p["id"], p["target"] * ((1 - self.slip) if long else (1 + self.slip)), "target", actor))
        self.check_circuit_breakers()
        return closed

    def close(self, position_id: str, px: float, reason: str, actor: str = "user") -> dict:
        p = self.s.one("SELECT * FROM positions WHERE id=?", (position_id,))
        if not p or p["status"] != "open":
            raise ValueError(f"no open position {position_id}")
        mult = self._mult(p)
        exit_fee = px * p["qty"] * mult * self.fee
        gross = (px - p["entry_px"]) * p["qty"] * mult * (1 if p["side"] == "long" else -1)
        fees = p["fees"] + exit_fee
        pnl = gross - fees
        self.s.execute("UPDATE positions SET status='closed', closed_at=?, exit_px=?, realized_pnl=?, fees=?, last_px=?, close_reason=? WHERE id=?",
                       (time.time(), px, pnl, fees, px, reason, position_id))
        r_mult = pnl / p["risk_usd"] if p["risk_usd"] else None
        audit.record(self.s, "position_closed", actor=actor, ref=p["idea_id"],
                     inputs={"position_id": position_id, "exit_px": px, "entry_px": p["entry_px"], "qty": p["qty"]},
                     outcome=reason, reasons=[f"realized {pnl:.4f} USD ({r_mult:.2f}R)" if r_mult is not None else f"realized {pnl:.4f}"]
                     + (["loss exceeded planned risk (gap through stop)"] if pnl < -p["risk_usd"] - 1e-6 else []))
        self.snapshot()
        return {**p, "status": "closed", "exit_px": px, "realized_pnl": pnl, "r_multiple": r_mult, "close_reason": reason}

    def snapshot(self):
        e = self.equity()
        self.s.execute("INSERT INTO equity_snapshots(ts,equity,cash_pnl,unrealized,open_risk) VALUES(?,?,?,?,?)",
                       (time.time(), e["equity"], e["realized_pnl"], e["unrealized_pnl"], e["open_risk_usd"]))

    def ideas(self, limit=50) -> list[dict]:
        rows = self.s.query("""SELECT i.*, d.approved, d.risk_usd, d.qty, d.checks FROM ideas i
                               LEFT JOIN risk_decisions d ON d.idea_id=i.id ORDER BY i.ts DESC LIMIT ?""", (limit,))
        for r in rows:
            r["payload"] = json.loads(r["payload"]) if r["payload"] else {}
            r["checks"] = json.loads(r["checks"]) if r["checks"] else []
        return rows
