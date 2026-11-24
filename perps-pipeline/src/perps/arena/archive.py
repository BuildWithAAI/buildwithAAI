"""Archive positions left open in the legacy single-account paper ledger (state/paper.sqlite) so the
arena arms start clean. Each position is recorded closed at its stop price; the 1m tape is checked
to report honestly whether (and when) the stop was actually traded."""

from __future__ import annotations

import json
import shutil
import sqlite3
from pathlib import Path
from typing import Any

import pandas as pd

from ..core.costs import funding_payment, gross_pnl
from .journal import cst
from .ledger import utcnow

MIN = 60_000


def stop_touch(side: int, stop: float, entry_ms: int, bars1m: pd.DataFrame) -> dict[str, Any] | None:
    """First 1m bar after the (partial) entry minute whose range reached the stop."""
    b = bars1m[bars1m["ts"] >= (entry_ms // MIN + 1) * MIN]
    hit = b[b["high"] >= stop] if side < 0 else b[b["low"] <= stop]
    if hit.empty:
        return None
    r = hit.iloc[0]
    return {"ts": int(r["ts"]), "open": float(r["open"]), "high": float(r["high"]), "low": float(r["low"]),
            "close": float(r["close"])}


def settle_archive(pos: dict[str, Any], exit_price: float, exit_ms: int, funding: pd.DataFrame,
                   bars1m: pd.DataFrame, taker_fee: float, interval_h: float = 8.0) -> dict[str, Any]:
    side, qty, entry = int(pos["side"]), float(pos["qty"]), float(pos["entry_price"])
    entry_ms = int(pd.Timestamp(pos["entry_time"]).value // 1_000_000)
    iv = int(interval_h * 3_600_000)
    rates = dict(zip(funding["ts"].astype("int64"), funding["funding_rate"], strict=False))
    events, fund = [], 0.0
    st = (entry_ms // iv + 1) * iv
    while st < exit_ms:
        if st in rates:
            row = bars1m[bars1m["ts"] == st]
            mark = float(row["open"].iloc[0]) if len(row) else entry
            pay = funding_payment(side, qty, mark, float(rates[st]))
            events.append({"time": pd.Timestamp(st, unit="ms", tz="UTC").isoformat(), "rate": float(rates[st]),
                           "mark": mark, "payment": pay})
            fund += pay
        st += iv
    gross = gross_pnl(side, qty, entry, exit_price)
    exit_fee = qty * exit_price * taker_fee
    net = gross - float(pos["entry_fee"]) - exit_fee + fund
    return {"exit_price": exit_price, "exit_ms": exit_ms, "gross_pnl": gross, "exit_fee": exit_fee,
            "fees": float(pos["entry_fee"]) + exit_fee, "funding": fund, "funding_events": events, "net_pnl": net,
            "r_multiple": net / float(pos["risk_amount"]), "duration_min": (exit_ms - entry_ms) / MIN}


def archive_legacy(paper_db: Path, archive_dir: Path, bars1m_by_symbol: dict[str, pd.DataFrame],
                   funding_by_symbol: dict[str, pd.DataFrame], taker_fee: float, move: bool = True) -> list[dict]:
    if not paper_db.exists():
        return []
    db = sqlite3.connect(paper_db)
    db.row_factory = sqlite3.Row
    out = []
    try:
        for row in db.execute("SELECT * FROM positions WHERE status='open' ORDER BY id").fetchall():
            pos = json.loads(row["data"])
            sym, side, stop = pos["symbol"], int(pos["side"]), float(pos["stop_price"])
            entry_ms = int(pd.Timestamp(pos["entry_time"]).value // 1_000_000)
            bars = bars1m_by_symbol.get(sym, pd.DataFrame(columns=["ts", "open", "high", "low", "close"]))
            touch = stop_touch(side, stop, entry_ms, bars)
            exit_ms = touch["ts"] + MIN - 1 if touch else int(pd.Timestamp.now(tz="UTC").value // 1_000_000)
            res = settle_archive(pos, stop, exit_ms, funding_by_symbol.get(sym, pd.DataFrame(columns=["ts", "funding_rate"])),
                                 bars, taker_fee)
            verified = (f"VERIFIED on Blofin 1m candles: the stop {stop} was first traded in the 1m bar opening "
                        f"{cst(pd.Timestamp(touch['ts'], unit='ms', tz='UTC').isoformat())} (high {touch['high']}, "
                        f"low {touch['low']})." if touch else
                        f"NOT VERIFIED: no 1m bar from entry to now reached the stop {stop}; recorded at the stop "
                        f"anyway as instructed.")
            closed_at = pd.Timestamp(exit_ms, unit="ms", tz="UTC").isoformat()
            db.execute("UPDATE positions SET status='closed', closed_at=?, exit_price=?, exit_reason=?, gross_pnl=?, "
                       "fees=?, funding=?, net_pnl=?, r_multiple=? WHERE id=?",
                       (closed_at, stop, "stop (archived)", res["gross_pnl"], res["fees"], res["funding"],
                        res["net_pnl"], res["r_multiple"], row["id"]))
            cash = float(db.execute("SELECT value FROM account WHERE key='cash'").fetchone()[0])
            new_cash = cash + res["gross_pnl"] - res["exit_fee"] + res["funding"]
            db.execute("UPDATE account SET value=? WHERE key='cash'", (str(new_cash),))
            rec = {"legacy_id": row["id"], "symbol": sym, "side": side, "strategy": pos.get("strategy"),
                   "timeframe": pos.get("timeframe"), "entry_time": pos["entry_time"], "entry_price": pos["entry_price"],
                   "qty": pos["qty"], "stop": stop, "take_profit": pos.get("take_profit"),
                   "risk_amount": pos["risk_amount"], "entry_fee": pos["entry_fee"], "closed_at": closed_at,
                   **res, "stop_touch": touch, "verification": verified, "cash_before": cash, "cash_after": new_cash,
                   "archived_at": utcnow()}
            db.execute("INSERT INTO events(ts, kind, payload) VALUES (?,?,?)",
                       (utcnow(), "archived", json.dumps(rec, default=float)))
            out.append(rec)
        db.commit()
    finally:
        db.close()
    archive_dir.mkdir(parents=True, exist_ok=True)
    stamp = pd.Timestamp.now(tz="UTC").strftime("%Y%m%dT%H%M%SZ")
    if out:
        (archive_dir / f"legacy_archive_{stamp}.json").write_text(json.dumps(out, indent=2, default=float))
        md = ["# Legacy paper positions archived", ""]
        for r in out:
            md += [f"## Legacy #{r['legacy_id']} {r['strategy']} {r['timeframe']} "
                   f"{'SHORT' if r['side'] < 0 else 'LONG'} {r['symbol']}", "",
                   f"- Entry {cst(r['entry_time'])} @ {r['entry_price']:.6g}, qty {r['qty']}, stop {r['stop']}, "
                   f"TP {r['take_profit']}",
                   f"- Recorded closed at the stop {r['exit_price']} ({cst(r['closed_at'])})",
                   f"- {r['verification']}",
                   f"- Gross ${r['gross_pnl']:+.4f}, fees ${r['fees']:.4f}, funding ${r['funding']:+.4f} -> "
                   f"net ${r['net_pnl']:+.4f} ({r['r_multiple']:+.2f}R); duration {r['duration_min']:.0f} min",
                   f"- Legacy account cash {r['cash_before']:.4f} -> {r['cash_after']:.4f}", ""]
        (archive_dir / f"legacy_archive_{stamp}.md").write_text("\n".join(md))
    if move:
        shutil.move(str(paper_db), str(archive_dir / f"paper_{stamp}.sqlite"))
    return out
