"""Granted-stage registry + sign-off log (ECONOMY.md E2). PAPER ONLY.

`aai/economy.py` computes the stage a strategy is *eligible* for. This module records the stage a human actually
*granted*, in an append-only table (`economy_stage_grants`, DB triggers forbid UPDATE/DELETE). Rules:
  * Only a human CLI command with `--confirm GRANT` and a verbatim quote can write a grant (or revoke). The HUD, Zoora
    voice/text, LLM output and other agents' reports can never call `grant()`: it refuses any non-CLI actor.
  * A grant can never exceed the stage the strategy is currently eligible for (after auto-demotion), and a killed
    strategy can only be granted stage 0.
  * `reconcile()` (explicit CLI command, never on a read) appends an `auto_demotion` row when the granted stage sits
    above what the strategy is now eligible for.
  * The *effective* paper stage is min(granted, eligible). Nothing here touches real money: every stage is paper and
    `real_money_allowed` stays False. A real-money stage still needs Zoorped's written sign-off + an L0 approval token.
"""
from __future__ import annotations
import time
from . import audit, economy

HUMAN_ACTORS = ("cli",)          # the only actor allowed to write a grant/revoke
CONFIRM_WORD = "GRANT"
ACTIONS = ("grant", "revoke", "auto_demotion")

SCHEMA = """
CREATE TABLE IF NOT EXISTS economy_stage_grants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts REAL NOT NULL,
  strategy TEXT NOT NULL,
  stage INTEGER NOT NULL CHECK (stage BETWEEN 0 AND 3),
  action TEXT NOT NULL CHECK (action IN ('grant','revoke','auto_demotion')),
  granted_by TEXT NOT NULL,
  quote TEXT NOT NULL,
  eligible_stage INTEGER,
  prev_stage INTEGER,
  CHECK (action <> 'grant' OR length(trim(quote)) > 0),
  CHECK (action <> 'revoke' OR stage = 0));
CREATE INDEX IF NOT EXISTS economy_stage_grants_strategy ON economy_stage_grants(strategy, id);
CREATE TRIGGER IF NOT EXISTS economy_grants_no_update BEFORE UPDATE ON economy_stage_grants
  BEGIN SELECT RAISE(ABORT, 'economy_stage_grants is append-only'); END;
CREATE TRIGGER IF NOT EXISTS economy_grants_no_delete BEFORE DELETE ON economy_stage_grants
  BEGIN SELECT RAISE(ABORT, 'economy_stage_grants is append-only'); END;
"""


class GrantError(ValueError):
    pass


def ensure(store) -> None:
    with store._lock:
        store.conn.executescript(SCHEMA)


def current(store) -> dict[str, dict]:
    """Latest registry row per strategy (read-only). Missing table -> {} (nothing granted, everything stage 0)."""
    try:
        rows = store.query("""SELECT g.* FROM economy_stage_grants g
                              JOIN (SELECT strategy, MAX(id) AS id FROM economy_stage_grants GROUP BY strategy) m ON m.id = g.id""")
    except Exception:
        return {}
    return {r["strategy"]: r for r in rows}


def history(store, strategy: str | None = None, n: int = 50) -> list[dict]:
    try:
        q, p = "SELECT * FROM economy_stage_grants", ()
        if strategy:
            q, p = q + " WHERE strategy=?", (strategy,)
        return store.query(q + " ORDER BY id DESC LIMIT ?", p + (int(n),))
    except Exception:
        return []


def annotate(sc: dict, granted: dict[str, dict]) -> dict:
    """Pure: add granted / effective stage + grant_status to each scorecard row. Does not change weights (E5 will).
    grant_status: 'none' (never granted, stage 0), 'ok' (granted == eligible), 'eligible_above_grant' (eligible for more
    than granted; a human may promote), 'pending_demotion' (granted above current eligibility; effective is capped and
    `aai economy-reconcile` will log the demotion)."""
    for r in sc.get("strategies") or []:
        g = granted.get(r["id"])
        gs = int(g["stage"]) if g else 0
        el = int((r.get("ladder") or {}).get("stage", 0))
        eff = min(gs, el)
        status = ("pending_demotion" if gs > el else "ok" if gs == el and g else
                  "eligible_above_grant" if el > gs else "none")
        r["grant"] = {"granted_stage": gs, "effective_stage": eff, "status": status,
                      "granted_by": g["granted_by"] if g else None, "granted_at": g["ts"] if g else None,
                      "action": g["action"] if g else None, "quote": (g["quote"] or "")[:200] if g else None}
    rows = sc.get("strategies") or []
    sc["grants"] = {"granted": sum(1 for r in rows if r["grant"]["granted_stage"] > 0),
                    "pending_demotion": sum(1 for r in rows if r["grant"]["status"] == "pending_demotion"),
                    "eligible_above_grant": sum(1 for r in rows if r["grant"]["status"] == "eligible_above_grant"),
                    "how": "aai economy-grant STRATEGY STAGE --by NAME --quote 'VERBATIM SIGN-OFF' --confirm GRANT (CLI only)"}
    return sc


def _row(sc: dict, strategy: str) -> dict:
    for r in sc.get("strategies") or []:
        if r["id"] == strategy:
            return r
    raise GrantError(f"unknown strategy {strategy!r}; see `aai economy` for ids")


def grant(store, cfg: dict, strategy: str, stage: int, *, by: str, quote: str, confirm: str, actor: str = "cli",
          sc: dict | None = None) -> dict:
    """Append a human grant (stage >= 1) or revoke (stage 0). Paper only. Raises GrantError when refused."""
    if actor not in HUMAN_ACTORS:
        raise GrantError(f"actor {actor!r} cannot grant stages; only a human CLI command can")
    if confirm != CONFIRM_WORD:
        raise GrantError(f"refusing: --confirm {CONFIRM_WORD} required")
    by, quote = (by or "").strip(), (quote or "").strip()
    if not by:
        raise GrantError("refusing: --by <human name> required")
    if not quote:
        raise GrantError("refusing: --quote with the verbatim sign-off is required")
    if not isinstance(stage, int) or stage not in economy.STAGES:
        raise GrantError(f"stage must be one of {sorted(economy.STAGES)}")
    ensure(store)
    sc = sc or economy.scorecard(store, cfg)
    r = _row(sc, strategy)
    el = int(r["ladder"]["stage"])
    if r.get("killed") and stage > 0:
        raise GrantError(f"{strategy} is killed/benched; only stage 0 can be granted")
    if stage > el:
        raise GrantError(f"{strategy} is only eligible for stage {el} right now; cannot grant stage {stage}")
    prev = current(store).get(strategy)
    prev_stage = int(prev["stage"]) if prev else 0
    action = "revoke" if stage == 0 else "grant"
    ts = time.time()
    store.execute("""INSERT INTO economy_stage_grants(ts,strategy,stage,action,granted_by,quote,eligible_stage,prev_stage)
                     VALUES(?,?,?,?,?,?,?,?)""", (ts, strategy, stage, action, by[:80], quote[:1000], el, prev_stage))
    audit.record(store, f"economy_stage_{action}", actor=actor, ref=strategy,
                 inputs={"stage": stage, "granted_by": by[:80], "quote": quote[:1000], "eligible_stage": el, "prev_stage": prev_stage},
                 outcome=action, reasons=["paper only; real money still needs Zoorped sign-off + L0 approval token"])
    return {"ok": True, "strategy": strategy, "action": action, "stage": stage, "prev_stage": prev_stage,
            "eligible_stage": el, "paper_only": True, "real_money_allowed": False}


def reconcile(store, cfg: dict, *, actor: str = "cli", sc: dict | None = None) -> dict:
    """Append an auto_demotion row for every strategy whose granted stage is above its current eligibility."""
    ensure(store)
    sc = sc or economy.scorecard(store, cfg)
    cur = current(store)
    done = []
    for r in sc.get("strategies") or []:
        g = cur.get(r["id"])
        if not g:
            continue
        gs, el = int(g["stage"]), int(r["ladder"]["stage"])
        if gs > el:
            why = "; ".join(r["ladder"].get("demotion_reasons") or []) or (
                "killed/benched" if r.get("killed") else f"no longer eligible above stage {el}")
            store.execute("""INSERT INTO economy_stage_grants(ts,strategy,stage,action,granted_by,quote,eligible_stage,prev_stage)
                             VALUES(?,?,?,?,?,?,?,?)""", (time.time(), r["id"], el, "auto_demotion", "economy-reconcile",
                                                          why[:1000], el, gs))
            audit.record(store, "economy_stage_auto_demotion", actor=actor, ref=r["id"],
                         inputs={"from": gs, "to": el}, outcome="demoted", reasons=[why[:400]])
            done.append({"strategy": r["id"], "from": gs, "to": el, "reason": why})
    return {"ok": True, "demotions": done, "checked": len(cur)}
