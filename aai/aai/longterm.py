"""Long-term capital bucket (2040 Future Agent design, adopted 2026-11-01).

* Separate from trading: NOT sized by the 1-3% rule, NOT in trading open risk / daily loss / drawdown,
  and this module never reads the trading kill switch (LT-02). Nothing here executes anything.
* Output is DRAFT tickets in lt_order_tickets. Guards LT-01..LT-10 run on every draft; a FAIL blocks it.
  'pass' only means "may be shown to Zoorped". Confirmation requires his verbatim message (LT-10).
"""
from __future__ import annotations
import json, time, uuid
from pathlib import Path
from . import audit
from .store import Store, dumps

SEED = Path(__file__).parent / "schemas" / "longterm_seed.sql"
TRADING_ORIGINS = {"trading_kill_switch", "daily_loss_limit", "max_drawdown", "risk_engine", "circuit_breaker"}
FORBIDDEN_INSTRUMENTS = {"option", "options", "future", "futures", "perp", "perpetual", "margin", "leveraged"}
SIDES = {"buy", "sell", "transfer_to_cold"}
STOCK_ACCOUNT_TYPES = ("roth_ira", "taxable_brokerage")


def seed(store: Store, cfg: dict | None = None) -> dict:
    sql = SEED.read_text().replace("INSERT INTO", "INSERT OR IGNORE INTO")
    with store._lock:
        store.conn.executescript(sql)
    if cfg:
        enforce_policies(store, cfg)
    audit.record(store, "lt_seeded", actor="aai", inputs={"file": SEED.name}, outcome="ok",
                 reasons=["reference rows only (accounts, sleeves, targets, crypto core); no balances"])
    return {t: store.one(f"SELECT COUNT(*) n FROM {t}")["n"] for t in ("lt_accounts", "lt_sleeves", "lt_targets", "lt_crypto_core")}


# ---------------------------------------------------------------- account execution policy
class TicketingDisabled(ValueError):
    """Raised when an agent tries to draft an order ticket for a user-executed, audit-only account."""


def policy(store: Store, account_id: str) -> dict | None:
    return store.one("SELECT * FROM lt_account_policies WHERE account_id=?", (account_id,))


def enforce_policies(store: Store, cfg: dict) -> dict:
    """Sync config policies into the DB (tightening only; loosening is blocked by triggers) and retire any
    pre-existing draft tickets on audit-only accounts. Idempotent."""
    for acct, pol in cfg.get("longterm", {}).get("account_policies", {}).items():
        store.execute("""INSERT OR IGNORE INTO lt_account_policies(account_id,owner,executor,agent_role,ticketing,decided_by,decided_at,note)
                         VALUES(?,?,?,?,?,?,?,?)""", (acct, pol["owner"], pol["executor"], pol["agent_role"], pol["ticketing"],
                                                     "config", time.time(), "from config/default.toml"))
        cur = policy(store, acct)
        if pol["agent_role"] == "auditor" and cur["agent_role"] != "auditor":
            store.execute("UPDATE lt_account_policies SET agent_role='auditor', ticketing='disabled', executor='user' WHERE account_id=?", (acct,))
    retired = store.query("""SELECT t.ticket_id, t.account_id FROM lt_order_tickets t JOIN lt_account_policies p ON p.account_id=t.account_id
                             WHERE p.ticketing='disabled' AND t.status='draft'""")
    for t in retired:
        store.execute("UPDATE lt_order_tickets SET status='rejected' WHERE ticket_id=?", (t["ticket_id"],))
        audit.record(store, "lt_ticket_retired", actor="aai", ref=t["ticket_id"], inputs=t, outcome="rejected",
                     reasons=[f"{t['account_id']} is user-executed and audit-only; draft tickets are not allowed"])
    return {"policies": store.query("SELECT * FROM lt_account_policies"), "retired_drafts": [t["ticket_id"] for t in retired]}


# ---------------------------------------------------------------- holdings
def latest_holdings(store: Store) -> list[dict]:
    """Latest snapshot per account (append-only table)."""
    return store.query("""SELECT h.* FROM lt_holdings_snapshots h JOIN
        (SELECT account_id, MAX(as_of) m FROM lt_holdings_snapshots GROUP BY account_id) x
        ON h.account_id=x.account_id AND h.as_of=x.m""")


def ingest_snapshot(store: Store, account_id: str, rows: list[dict], source: str, as_of: float | None = None, actor="user") -> str:
    acct = store.one("SELECT * FROM lt_accounts WHERE account_id=?", (account_id,))
    if not acct or acct["capital_bucket"] != "longterm":
        raise ValueError(f"{account_id} is not a longterm account (LT-01)")
    sid, as_of = "snap_" + uuid.uuid4().hex[:10], as_of or time.time()
    with store.tx() as s:
        for r in rows:
            s.conn.execute("""INSERT INTO lt_holdings_snapshots(snapshot_id,as_of,account_id,symbol,quantity,cost_basis_usd,price_usd,value_usd,source,verified)
                              VALUES(?,?,?,?,?,?,?,?,?,?)""",
                           (sid, as_of, account_id, r["symbol"], float(r["quantity"]), r.get("cost_basis_usd"), r.get("price_usd"),
                            r.get("value_usd"), source, int(bool(r.get("verified", False)))))
    audit.record(store, "lt_snapshot_ingested", actor=actor, ref=sid, inputs={"account_id": account_id, "rows": rows, "source": source},
                 outcome="ok", reasons=[f"{len(rows)} rows"])
    return sid



# ---------------------------------------------------------------- manual CSV import (audit-only; no tickets)
# CLI writer only (`aai lt-holdings-import`). Voice / HUD / LLM never write. Append-only snapshots.
CSV_REQUIRED = ("symbol", "quantity")
CSV_OPTIONAL = ("cost_basis_usd", "price_usd", "value_usd", "verified")
CSV_MAX_ROWS = 500
CSV_ACTORS = frozenset({"cli"})  # same rule as economy-grant: only the human CLI writes
_SYM_RE = __import__("re").compile(r"^[A-Za-z0-9./\-]{1,24}$")


class HoldingsImportError(ValueError):
    """Raised when a manual holdings CSV is refused (bad shape, wrong actor, or empty)."""


def _csv_num(v, *, field: str, required: bool = False):
    if v is None or (isinstance(v, str) and not v.strip()):
        if required:
            raise HoldingsImportError(f"{field} is required")
        return None
    try:
        return float(str(v).strip().replace(",", "").replace("$", ""))
    except (TypeError, ValueError) as e:
        raise HoldingsImportError(f"{field} must be a number, got {v!r}") from e


def _csv_bool(v) -> bool:
    if v is None or (isinstance(v, str) and not v.strip()):
        return False
    if isinstance(v, bool):
        return v
    s = str(v).strip().lower()
    if s in ("1", "true", "yes", "y", "verified"):
        return True
    if s in ("0", "false", "no", "n", ""):
        return False
    raise HoldingsImportError(f"verified must be true/false, got {v!r}")


def parse_holdings_csv(src) -> list[dict]:
    """Parse a holdings CSV (path or text). Required columns: symbol, quantity.
    Optional: cost_basis_usd, price_usd, value_usd, verified. Audit-only; never tickets."""
    import csv, io
    if hasattr(src, "read"):
        raw = src.read()
        text = raw.decode("utf-8-sig") if isinstance(raw, (bytes, bytearray)) else str(raw)
    else:
        path = Path(src) if not isinstance(src, Path) else src
        if path.exists() and path.is_file():
            text = path.read_text(encoding="utf-8-sig")
        else:
            text = str(src)
    # strip UTF-8 BOM and blank lines
    lines = [ln for ln in text.splitlines() if ln.strip() and not ln.strip().startswith("#")]
    if not lines:
        raise HoldingsImportError("CSV is empty")
    reader = csv.DictReader(io.StringIO("\n".join(lines)))
    if not reader.fieldnames:
        raise HoldingsImportError("CSV has no header row")
    fields = { (f or "").strip().lower(): f for f in reader.fieldnames }
    missing = [c for c in CSV_REQUIRED if c not in fields]
    if missing:
        raise HoldingsImportError(f"CSV missing required column(s): {', '.join(missing)}")
    rows: list[dict] = []
    for i, raw in enumerate(reader, start=2):
        if len(rows) >= CSV_MAX_ROWS:
            raise HoldingsImportError(f"CSV has more than {CSV_MAX_ROWS} data rows")
        get = lambda k: (raw.get(fields[k]) if k in fields else None)
        sym = str(get("symbol") or "").strip().upper()
        if not sym:
            continue  # blank symbol row skipped
        if not _SYM_RE.match(sym):
            raise HoldingsImportError(f"line {i}: bad symbol {sym!r}")
        qty = _csv_num(get("quantity"), field="quantity", required=True)
        if qty is None or qty < 0:
            raise HoldingsImportError(f"line {i}: quantity must be >= 0")
        row = {"symbol": sym, "quantity": qty,
               "cost_basis_usd": _csv_num(get("cost_basis_usd"), field="cost_basis_usd"),
               "price_usd": _csv_num(get("price_usd"), field="price_usd"),
               "value_usd": _csv_num(get("value_usd"), field="value_usd"),
               "verified": _csv_bool(get("verified"))}
        # fill value from price * qty when value missing but price present
        if row["value_usd"] is None and row["price_usd"] is not None:
            row["value_usd"] = round(row["price_usd"] * qty, 6)
        rows.append(row)
    if not rows:
        raise HoldingsImportError("CSV has no data rows")
    # collapse duplicate symbols (sum qty/value)
    merged: dict[str, dict] = {}
    for r in rows:
        m = merged.get(r["symbol"])
        if not m:
            merged[r["symbol"]] = dict(r)
            continue
        m["quantity"] = m["quantity"] + r["quantity"]
        for k in ("cost_basis_usd", "value_usd"):
            a, b = m.get(k), r.get(k)
            if a is None and b is None:
                m[k] = None
            else:
                m[k] = (a or 0.0) + (b or 0.0)
        if r.get("price_usd") is not None:
            m["price_usd"] = r["price_usd"]
        m["verified"] = bool(m.get("verified")) and bool(r.get("verified"))
    return list(merged.values())


def import_holdings_csv(store: Store, path, account_id: str, *, source: str = "manual",
                        actor: str = "cli", as_of: float | None = None) -> dict:
    """CLI-only writer: parse a CSV and append an audit-only holdings snapshot. Never tickets."""
    if actor not in CSV_ACTORS:
        raise HoldingsImportError(f"actor {actor!r} cannot import holdings (CLI only)")
    src = str(source or "manual").strip()[:40] or "manual"
    # DB CHECK on lt_holdings_snapshots.source — keep in sync with schemas/longterm.sql
    allowed = {"manual", "plaid", "exchange_readonly_api", "onchain_public"}
    if src not in allowed:
        raise HoldingsImportError(f"source {src!r} not allowed; one of: {sorted(allowed)}")
    rows = parse_holdings_csv(path)
    sid = ingest_snapshot(store, account_id, rows, source=src, as_of=as_of, actor=actor)
    # mark the account feed as connected for the summary chips (does not enable ticketing)
    store.execute("UPDATE lt_accounts SET connected=1, feed=? WHERE account_id=?", (src, account_id))
    audit.record(store, "lt_holdings_csv_imported", actor=actor, ref=sid,
                 inputs={"account_id": account_id, "path": str(path)[:200], "n": len(rows), "source": src},
                 outcome="ok", reasons=[f"{len(rows)} holdings rows · audit only · no tickets"])
    return {"ok": True, "snapshot_id": sid, "account_id": account_id, "source": src, "rows": len(rows),
            "symbols": [r["symbol"] for r in rows], "holdings_source": holdings_source(store),
            "note": "audit only; no order tickets produced"}


def holdings_source(store: Store) -> str:
    srcs = {r["source"] for r in latest_holdings(store)}
    return "none" if not srcs else (srcs.pop() if len(srcs) == 1 else "mixed")


def stock_weights(store: Store) -> dict | None:
    """% of stock portfolio by symbol, or None when values are unknown (LT-09)."""
    accts = {a["account_id"] for a in store.query("SELECT account_id FROM lt_accounts WHERE capital_bucket='longterm' AND account_type IN (?,?)", STOCK_ACCOUNT_TYPES)}
    rows = [r for r in latest_holdings(store) if r["account_id"] in accts]
    if not rows or any(r["value_usd"] is None for r in rows):
        return None
    vals = {}
    for r in rows:
        vals[r["symbol"]] = vals.get(r["symbol"], 0.0) + r["value_usd"]
    return {"total_usd": sum(vals.values()), "values": vals}


# ---------------------------------------------------------------- guards
def _g(out, gid, status, detail):
    out.append({"id": gid, "status": status, "detail": detail})   # status: pass | fail | unknown | info


def run_guards(store: Store, cfg: dict, t: dict) -> list[dict]:
    lt = cfg["longterm"]; sc = lt["stocks_2040"]
    g: list[dict] = []
    acct = store.one("SELECT * FROM lt_accounts WHERE account_id=?", (t["account_id"],))
    # LT-01 bucket wall
    _g(g, "LT-01", "pass" if acct and acct["capital_bucket"] == "longterm" else "fail",
       f"account {t['account_id']} bucket={acct and acct['capital_bucket']}")
    # LT-02 trading risk events can never emit longterm sells
    trading_origin = t.get("origin") in TRADING_ORIGINS
    _g(g, "LT-02", "fail" if trading_origin else "pass",
       f"origin={t.get('origin')} " + ("(trading risk events may not create longterm tickets)" if trading_origin else "(not trading-derived)"))
    # LT-07 no leverage / margin / options / shorting
    bad = (t["side"] not in SIDES) or bool(t.get("leverage")) or (str(t.get("instrument_type", "spot")).lower() in FORBIDDEN_INSTRUMENTS)
    _g(g, "LT-07", "fail" if bad else "pass", f"side={t['side']} instrument_type={t.get('instrument_type', 'spot')} leverage={t.get('leverage', False)}")
    # LT-08 transfers only toward cold storage
    if t["side"] == "transfer_to_cold":
        dest = store.one("SELECT * FROM lt_accounts WHERE account_id=?", (t.get("destination") or "",))
        ok = dest and dest["account_type"] == "cold_wallet" and dest["capital_bucket"] == "longterm"
        _g(g, "LT-08", "pass" if ok else "fail", f"destination={t.get('destination')} must be a longterm cold_wallet")
    else:
        _g(g, "LT-08", "pass", "not a transfer")

    holdings = {(r["account_id"], r["symbol"]): r for r in latest_holdings(store)}
    core = store.one("SELECT * FROM lt_crypto_core WHERE symbol=?", (t["symbol"],))
    # LT-03 / LT-04 crypto core sells
    if core and t["side"] == "sell":
        h = holdings.get((t["account_id"], t["symbol"]))
        qty = t.get("quantity")
        if core["core_floor_qty"] is None:
            _g(g, "LT-03", "fail", "no core_floor_qty set -> any core sell blocked (never fully sell)")
        elif h is None or qty is None:
            _g(g, "LT-03", "fail", "holdings or sell quantity unknown -> cannot prove floor is respected")
        else:
            left = h["quantity"] - qty
            _g(g, "LT-03", "pass" if left >= core["core_floor_qty"] else "fail", f"post-sell {left:g} vs floor {core['core_floor_qty']:g}")
        cyc = store.one("SELECT * FROM lt_cycle_reads ORDER BY as_of DESC LIMIT 1")
        if not cyc or cyc["phase"] != "strength_recover_initials":
            _g(g, "LT-04", "fail", f"cycle phase={cyc and cyc['phase']} (sells only in strength_recover_initials)")
        elif core["initial_capital_usd"] is None or t.get("amount_usd") is None:
            _g(g, "LT-04", "fail", "initial_capital_usd or sell amount unknown")
        else:
            prior = store.one("""SELECT COALESCE(SUM(amount_usd),0) s FROM lt_order_tickets WHERE symbol=? AND side='sell'
                                 AND status IN ('confirmed_by_user','done_by_user')""", (t["symbol"],))["s"]
            room = core["initial_capital_usd"] - core["initials_recovered_usd"]
            _g(g, "LT-04", "pass" if prior + t["amount_usd"] <= room + 1e-9 else "fail",
               f"cumulative sells {prior + t['amount_usd']:.2f} vs initials remaining {room:.2f}")
    elif core:
        _g(g, "LT-03", "pass", f"{t['side']} of core coin (no sell)"); _g(g, "LT-04", "pass", "not a sell")

    # LT-05 / LT-06 stock weight caps (weight-dependent -> unknown when no holdings, LT-09)
    tgt = store.one("SELECT * FROM lt_targets WHERE symbol=?", (t["symbol"],))
    is_stock_acct = acct and acct["account_type"] in STOCK_ACCOUNT_TYPES
    if is_stock_acct and t["side"] == "buy":
        w = stock_weights(store)
        tier = tgt["tier"] if tgt else "growth"          # unknown names are treated as growth (5% cap)
        if w is None or t.get("amount_usd") is None:
            _g(g, "LT-05" if tier == "speculative" else "LT-06", "unknown", "holdings values unknown -> weight caps not checkable (LT-09)")
        else:
            amt = float(t["amount_usd"]); tot = w["total_usd"] + amt
            name_pct = 100 * (w["values"].get(t["symbol"], 0.0) + amt) / tot
            if tier == "speculative":
                specs = {r["symbol"] for r in store.query("SELECT symbol FROM lt_targets WHERE tier='speculative'")}
                spec_tot = 100 * (sum(v for k, v in w["values"].items() if k in specs) + amt) / tot
                name_cap = min(x for x in (sc["speculative_stop_add_pct"], tgt["stop_add_pct"] if tgt else None,
                                           tgt["max_pct"] if tgt else None) if x is not None)
                ok = spec_tot <= sc["speculative_total_max_pct"] and name_pct <= name_cap
                _g(g, "LT-05", "pass" if ok else "fail",
                   f"post-trade {t['symbol']} {name_pct:.2f}% (name cap {name_cap}%), speculative total {spec_tot:.2f}% (max {sc['speculative_total_max_pct']}%)")
            elif tier == "growth":
                cap = sc["megacap_overlap_max_pct"] if t["symbol"] in sc["megacap_overlap_symbols"] else sc["growth_single_max_pct"]
                _g(g, "LT-06", "pass" if name_pct <= cap else "fail", f"post-trade {name_pct:.2f}% vs cap {cap}% (direct holding only)")
                if t["symbol"] in sc["megacap_overlap_symbols"]:
                    _g(g, "LT-06", "unknown", "ETF look-through not computed: no fund constituent data in store")
    # trim suggestion (info only)
    w = stock_weights(store)
    if w and tgt and tgt["tier"] == "speculative" and w["total_usd"] > 0:
        pct = 100 * w["values"].get(t["symbol"], 0.0) / w["total_usd"]
        if pct > sc["speculative_trim_above_pct"]:
            _g(g, "LT-05", "info", f"{t['symbol']} at {pct:.2f}% > {sc['speculative_trim_above_pct']}% -> trim suggestion")
    return g


def draft_ticket(store: Store, cfg: dict, *, account_id: str, symbol: str, side: str, rationale: str, rule_refs: list[str],
                 amount_usd: float | None = None, quantity: float | None = None, agent: str = "2040_future", **extra) -> dict:
    if not cfg["longterm"]["enabled"]:
        raise ValueError("longterm bucket disabled")
    t = {"account_id": account_id, "symbol": symbol.upper(), "side": side, "amount_usd": amount_usd, "quantity": quantity, **extra}
    pol = policy(store, account_id)
    if pol and pol["ticketing"] == "disabled":
        audit.record(store, "lt_ticket_refused", actor=agent, inputs=t, outcome="refused",
                     reasons=[f"{account_id}: owner={pol['owner']} executor={pol['executor']} agent_role={pol['agent_role']}; "
                              "ticketing disabled (user-executed, audit-only). Use account_audit() instead."])
        raise TicketingDisabled(f"{account_id} is user-executed and audit-only; agents cannot create order tickets for it")
    if side not in SIDES:
        audit.record(store, "lt_ticket_blocked", actor=agent, inputs=t, outcome="rejected",
                     reasons=[f"FAIL LT-07: side '{side}' not allowed (buy|sell|transfer_to_cold only; no shorting)"])
        raise ValueError(f"LT-07: side '{side}' not allowed")
    guards = run_guards(store, cfg, t)
    blocked = any(x["status"] == "fail" for x in guards)
    unverified = holdings_source(store) == "none" or any(x["status"] == "unknown" for x in guards)
    tid = "ltt_" + uuid.uuid4().hex[:12]
    reasons = [f"{x['status'].upper()} {x['id']}: {x['detail']}" for x in guards] + (["UNVERIFIED: holdings unknown (LT-09)"] if unverified else [])
    store.execute("""INSERT INTO lt_order_tickets(ticket_id,created_at,agent,account_id,symbol,side,amount_usd,quantity,rationale,rule_refs,guard_result,guard_reasons,status)
                     VALUES(?,?,?,?,?,?,?,?,?,?,?,?,'draft')""",
                  (tid, time.time(), agent, account_id, t["symbol"], side, amount_usd, quantity,
                   ("[UNVERIFIED] " if unverified else "") + rationale, dumps(rule_refs), "blocked" if blocked else "pass", dumps(reasons)))
    audit.record(store, "lt_ticket_blocked" if blocked else "lt_ticket_drafted", actor=agent, ref=tid, inputs=t,
                 outcome="blocked" if blocked else "draft", reasons=reasons)
    return {"ticket_id": tid, "guard_result": "blocked" if blocked else "pass", "unverified": unverified, "guards": guards}


def account_audit(store: Store, cfg: dict, account_id: str, actor: str = "2040_future", persist: bool = True) -> dict:
    """Audit-only report for one longterm account: holdings vs target weights, off-plan names, cap breaches, drift.
    Never invents data: missing holdings / values / verification -> actual weights null, breach 'unknown', UNVERIFIED."""
    sc = cfg["longterm"]["stocks_2040"]
    acct = store.one("SELECT * FROM lt_accounts WHERE account_id=?", (account_id,))
    if not acct or acct["capital_bucket"] != "longterm":
        raise ValueError(f"{account_id} is not a longterm account")
    pol = policy(store, account_id)
    rows = [r for r in latest_holdings(store) if r["account_id"] == account_id]
    targets = {t["symbol"]: t for t in store.query("SELECT * FROM lt_targets")}
    sleeves = {x["sleeve_id"]: x for x in store.query("SELECT * FROM lt_sleeves WHERE portfolio='stocks_2040'")}
    issues = []
    if not rows:
        issues.append("no holdings snapshot for this account (no feed connected, no manual import)")
    missing_val = [r["symbol"] for r in rows if r["value_usd"] is None]
    unverified_rows = [r["symbol"] for r in rows if not r["verified"]]
    if missing_val:
        issues.append(f"value_usd missing for {missing_val}: weights cannot be computed")
    if unverified_rows:
        issues.append(f"rows not verified against a statement/feed: {unverified_rows}")
    weights_known = bool(rows) and not missing_val
    total = sum(r["value_usd"] for r in rows) if weights_known else None
    pct = (lambda v: 100 * v / total) if weights_known and total else (lambda v: None)
    by_sym = {}
    for r in rows:
        by_sym.setdefault(r["symbol"], {"quantity": 0.0, "value_usd": 0.0 if r["value_usd"] is not None else None})
        by_sym[r["symbol"]]["quantity"] += r["quantity"]
        if r["value_usd"] is not None and by_sym[r["symbol"]]["value_usd"] is not None:
            by_sym[r["symbol"]]["value_usd"] += r["value_usd"]

    def breach(actual, lo, hi):
        if actual is None:
            return "unknown"
        return "below" if actual < lo else "above" if actual > hi else "none"

    holdings = []
    for sym, h in sorted(by_sym.items()):
        t = targets.get(sym)
        holdings.append({"symbol": sym, "quantity": h["quantity"], "value_usd": h["value_usd"],
                         "actual_pct": pct(h["value_usd"]) if h["value_usd"] is not None else None,
                         "on_plan": t is not None, "tier": t["tier"] if t else None, "sleeve": t["sleeve_id"] if t else None})
    off_plan = [h["symbol"] for h in holdings if not h["on_plan"]]

    # sleeve drift (targets are % of the stocks_2040 portfolio; compared here per account)
    sleeve_actual = {k: 0.0 for k in sleeves}
    for h in holdings:
        if h["sleeve"] in sleeve_actual and h["actual_pct"] is not None:
            sleeve_actual[h["sleeve"]] += h["actual_pct"]
    drift = [{"scope": "sleeve", "key": k, "target_pct": v["target_pct"], "band": [v["band_low_pct"], v["band_high_pct"]],
              "actual_pct": round(sleeve_actual[k], 4) if weights_known else None,
              "drift_pct": round(sleeve_actual[k] - v["target_pct"], 4) if weights_known else None,
              "breach": breach(sleeve_actual[k] if weights_known else None, v["band_low_pct"], v["band_high_pct"])}
             for k, v in sleeves.items()]
    for sym, t in targets.items():
        a = next((h["actual_pct"] for h in holdings if h["symbol"] == sym), 0.0 if weights_known else None)
        drift.append({"scope": "symbol", "key": sym, "target_pct": t["target_pct"], "actual_pct": a,
                      "drift_pct": (a - t["target_pct"]) if a is not None else None, "breach": "unknown" if a is None else "none"})

    # cap breaches
    caps = []
    spec_syms = {k for k, t in targets.items() if t["tier"] == "speculative"}
    spec_total = sum(h["actual_pct"] or 0 for h in holdings if h["symbol"] in spec_syms) if weights_known else None
    spec_mode = cfg["longterm"].get("account_policies", {}).get(account_id, {}).get("speculative_total_cap", "hard")
    spec_raw = "unknown" if spec_total is None else ("above" if spec_total > sc["speculative_total_max_pct"] else "none")
    spec_entry = {"scope": "speculative_total", "key": "speculative_total", "limit_pct": sc["speculative_total_max_pct"],
                  "actual_pct": spec_total, "enforcement": spec_mode, "breach": spec_raw}
    informational = []
    if spec_mode == "informational":
        spec_entry.update(breach="informational", would_exceed=None if spec_total is None else spec_total > sc["speculative_total_max_pct"],
                          note="Pending Zoorped's decision whether the 10% total speculative cap applies to this account; "
                               "reported for information, not a hard breach (config: account_policies.<acct>.speculative_total_cap).")
        informational.append(spec_entry)
    caps.append(spec_entry)
    for h in holdings:
        a = h["actual_pct"]
        if h["tier"] == "speculative":
            t = targets[h["symbol"]]
            stop = t["stop_add_pct"] if t["stop_add_pct"] is not None else sc["speculative_stop_add_pct"]
            trim = t["trim_above_pct"] if t["stop_add_pct"] is not None else sc["speculative_trim_above_pct"]
            mx = t["max_pct"]
            b = ("unknown" if a is None else "above" if mx is not None and a > mx else "cap_trim" if trim is not None and a > trim
                 else "cap_stop_add" if a > stop else "none")
            caps.append({"scope": "symbol", "key": h["symbol"], "limit_pct": mx if mx is not None else stop, "actual_pct": a, "breach": b})
        elif h["tier"] in ("growth", None) and h["symbol"] != sc["core_symbol"]:
            lim = sc["megacap_overlap_max_pct"] if h["symbol"] in sc["megacap_overlap_symbols"] else sc["growth_single_max_pct"]
            caps.append({"scope": "symbol", "key": h["symbol"], "limit_pct": lim, "actual_pct": a,
                         "breach": "unknown" if a is None else ("above" if a > lim else "none"),
                         "note": "direct holding only; ETF look-through not computed" if h["symbol"] in sc["megacap_overlap_symbols"] else None})

    verified = weights_known and not unverified_rows
    srcs = sorted({r["source"] for r in rows})
    rep = {"account_id": account_id, "kind": "account_audit", "status": "VERIFIED" if verified else "UNVERIFIED",
           "owner": (pol or {}).get("owner"), "executor": (pol or {}).get("executor"), "agent_role": (pol or {}).get("agent_role", "drafter"),
           "ticketing": (pol or {}).get("ticketing", "draft_only"),
           "holdings_source": "none" if not srcs else (srcs[0] if len(srcs) == 1 else "mixed"),
           "holdings_as_of": max((r["as_of"] for r in rows), default=None), "total_value_usd": total,
           "holdings": holdings, "off_plan": off_plan, "cap_breaches": [c for c in caps if c["breach"] not in ("none", "informational")],
           "informational": informational,
           "caps_checked": caps, "drift": drift, "data_issues": issues,
           "note": "Audit only. No order tickets are produced for this account." if (pol or {}).get("ticketing") == "disabled" else None,
           "generated_at": time.time()}
    if persist:
        run_id = "audit_" + uuid.uuid4().hex[:10]
        rep["run_id"] = run_id
        with store.tx() as s:
            for d in drift:
                s.conn.execute("""INSERT INTO lt_drift_checks(run_id,as_of,scope,key,target_pct,actual_pct,band_low_pct,band_high_pct,breach)
                                  VALUES(?,?,?,?,?,?,?,?,?)""", (run_id, rep["generated_at"], d["scope"], f"{account_id}:{d['key']}", d["target_pct"],
                                                                 d["actual_pct"], (d.get("band") or [None, None])[0], (d.get("band") or [None, None])[1], d["breach"]))
            for c in caps:
                if c["scope"] == "speculative_total":
                    s.conn.execute("""INSERT INTO lt_drift_checks(run_id,as_of,scope,key,target_pct,actual_pct,band_low_pct,band_high_pct,breach)
                                      VALUES(?,?,?,?,?,?,?,?,?)""", (run_id, rep["generated_at"], "speculative_total",
                                                                     f"{account_id}:speculative_total" + (":informational_pending_decision" if spec_mode == "informational" else ""),
                                                                     None, c["actual_pct"], None, c["limit_pct"],
                                                                     c["breach"] if c["breach"] != "informational" else spec_raw))
        audit.record(store, "lt_account_audit", actor=actor, ref=run_id, inputs={"account_id": account_id, "rows": len(rows)},
                     outcome=rep["status"], reasons=issues + [f"off_plan={off_plan}", f"cap_breaches={[c['key'] for c in rep['cap_breaches']]}"])
    return rep


def confirm_ticket(store: Store, ticket_id: str, confirmation_quote: str, actor: str = "user") -> dict:
    """LT-10: only with Zoorped's explicit message quoted verbatim. Does NOT execute anything."""
    t = store.one("SELECT * FROM lt_order_tickets WHERE ticket_id=?", (ticket_id,))
    if not t:
        raise ValueError("unknown ticket")
    if t["status"] != "draft":
        raise ValueError(f"ticket status is {t['status']}, not draft")
    if t["guard_result"] != "pass":
        raise ValueError("blocked tickets cannot be confirmed")
    if not (confirmation_quote or "").strip():
        raise ValueError("verbatim confirmation quote required (LT-10)")
    store.execute("UPDATE lt_order_tickets SET status='confirmed_by_user', confirmed_at=?, confirmation_quote=? WHERE ticket_id=?",
                  (time.time(), confirmation_quote, ticket_id))
    audit.record(store, "lt_ticket_confirmed_by_user", actor=actor, ref=ticket_id, inputs={"confirmation_quote": confirmation_quote},
                 outcome="confirmed", reasons=["user executes the trade himself; no execution path exists"])
    return store.one("SELECT * FROM lt_order_tickets WHERE ticket_id=?", (ticket_id,))


def mark_done(store: Store, ticket_id: str, user_quote: str, actor: str = "user") -> dict:
    t = store.one("SELECT * FROM lt_order_tickets WHERE ticket_id=?", (ticket_id,))
    if not t or t["status"] != "confirmed_by_user":
        raise ValueError("only confirmed tickets can be marked done")
    if not (user_quote or "").strip():
        raise ValueError("user's own 'I executed it' message required (LT-10)")
    store.execute("UPDATE lt_order_tickets SET status='done_by_user' WHERE ticket_id=?", (ticket_id,))
    audit.record(store, "lt_ticket_done_by_user", actor=actor, ref=ticket_id, inputs={"user_quote": user_quote}, outcome="done")
    return store.one("SELECT * FROM lt_order_tickets WHERE ticket_id=?", (ticket_id,))


def expire_stale(store: Store, cfg: dict) -> int:
    cutoff = time.time() - cfg["longterm"]["ticket_expiry_days"] * 86400
    cur = store.execute("UPDATE lt_order_tickets SET status='expired' WHERE status='draft' AND created_at < ?", (cutoff,))
    return cur.rowcount


def tickets(store: Store, status: str | None = None) -> list[dict]:
    q = "SELECT * FROM lt_order_tickets" + (" WHERE status=?" if status else "") + " ORDER BY created_at DESC LIMIT 200"
    rows = store.query(q, (status,) if status else ())
    for r in rows:
        r["rule_refs"] = json.loads(r["rule_refs"]); r["guard_reasons"] = json.loads(r["guard_reasons"] or "[]")
    return rows


def summary(store: Store) -> dict:
    return {"bucket": "longterm", "mode": "draft_tickets_only", "excluded_from_trading_risk": True,
            "holdings_source": holdings_source(store), "stock_weights": stock_weights(store),
            "accounts": store.query("SELECT * FROM lt_accounts ORDER BY capital_bucket, account_id"),
            "sleeves": store.query("SELECT * FROM lt_sleeves"),
            "crypto_core": store.query("SELECT * FROM lt_crypto_core"),
            "latest_cycle_read": store.one("SELECT * FROM lt_cycle_reads ORDER BY as_of DESC LIMIT 1"),
            "account_policies": store.query("SELECT * FROM lt_account_policies"),
            "open_drafts": len(tickets(store, "draft"))}


def cross_bucket_exposure(store: Store, ledger, symbols=("BTC", "ETH", "SOL", "XRP")) -> dict:
    """Report-only (never a kill): longterm spot value + trading paper notional per coin."""
    out = {}
    for s in symbols:
        lt_val = sum(r["value_usd"] or 0 for r in latest_holdings(store) if r["symbol"] == s)
        lt_known = all(r["value_usd"] is not None for r in latest_holdings(store) if r["symbol"] == s)
        perps = sum(p["qty"] * ledger._mult(p) * (p["last_px"] or p["entry_px"]) * (1 if p["side"] == "long" else -1)
                    for p in ledger.open_positions() if p["symbol"].split("-")[0].upper() == s)
        out[s] = {"longterm_spot_usd": lt_val if lt_known else None, "trading_paper_notional_usd": perps}
    return {"note": "report only; never triggers a kill or a longterm ticket", "holdings_source": holdings_source(store), "by_coin": out}
