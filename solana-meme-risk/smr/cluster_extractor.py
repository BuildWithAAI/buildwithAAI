"""Stage 3 - shared-funder clusters inside a funding time window.

Two members (early buyers + deployer) are linked when:
  * they received SOL from the same funder at hop 1, or share a hop-2 grand-funder, with the funding transfer
    inside [creation - window, as_of]; or
  * one member directly funded another (e.g. the deployer funding a bundle wallet), at any time before as_of.
Labeled CEX hot wallets / shared services (data/labels/known_entities.json) NEVER link. Unlabeled hub
funders (very active wallets) do link but are reported (`linked_via_hub_funder`) so they can be discounted.
Funding transactions that pay >=3 recipients at once (multi-send) are reported as strong evidence.
Union-find over members -> clusters with % of supply bought early and held at as_of.
"""
from __future__ import annotations
from . import config as C


class _UF:
    def __init__(self): self.p = {}
    def find(self, x):
        self.p.setdefault(x, x)
        while self.p[x] != x:
            self.p[x] = self.p[self.p[x]]; x = self.p[x]
        return x
    def union(self, a, b): self.p[self.find(a)] = self.find(b)


def _in_window(ts, create_time, as_of, window_h):
    if ts is None or create_time is None:
        return True
    return create_time - window_h * 3600 <= ts <= (as_of or create_time + 6 * 3600)


def extract_clusters(early, traces, *, window_h=72.0, balances=None, balances_complete=False):
    create_time = (early.get("creation") or {}).get("block_time")
    as_of = early.get("as_of")
    deployer = early.get("creator")
    buyers = {b["wallet"]: b for b in early.get("buyers", [])}
    members = set(buyers) | ({deployer} if deployer else set())
    if balances is None and early.get("holdings_complete"):
        balances, balances_complete = early.get("holdings_as_of") or {}, True
    balances = balances or {}
    uf = _UF()
    link = {}          # funder -> {(wallet, hop)}
    hub_funders, multisend = set(), set()
    for w in members:
        for f in (traces.get(w) or {}).get("funders", []):
            if f.get("non_linking"):
                continue
            if f["funder"] in members:   # direct member funding, any time before as_of
                uf.union(w, f["funder"]); link.setdefault(f["funder"], set()).add((w, 0))
                continue
            if not _in_window(f.get("first_block_time"), create_time, as_of, window_h):
                continue
            if f.get("funder_is_hub"):
                hub_funders.add(f["funder"])
            if (f.get("max_fanout") or 1) >= 3:
                multisend.add(f["funder"])
            link.setdefault(f["funder"], set()).add((w, 1))
            for g in f.get("hop2", []):
                if g.get("non_linking") or not _in_window(g.get("first_block_time"), create_time, as_of, window_h * 2):
                    continue
                if g["funder"] in members:
                    uf.union(w, g["funder"]); link.setdefault(g["funder"], set()).add((w, 0))
                    continue
                link.setdefault(g["funder"], set()).add((w, 2))
    for funder, ws in link.items():
        wl = sorted({w for w, _ in ws})
        if len(wl) >= 2:
            for w in wl[1:]:
                uf.union(wl[0], w)
        if funder in members and wl:
            uf.union(wl[0], funder)
    groups = {}
    for w in members:
        groups.setdefault(uf.find(w), set()).add(w)
    total = C.PUMP_TOTAL_SUPPLY_RAW
    clusters = []
    for ws in groups.values():
        if len(ws) < 2:
            continue
        shared = sorted({f for f, s in link.items() if len({w for w, _ in s} & ws) >= 2 or f in ws})
        bought = sum(buyers[w]["token_amount_raw"] for w in ws if w in buyers)
        known = [w for w in ws if w in balances or balances_complete]
        held = sum(max(0, balances.get(w, 0)) for w in known)
        clusters.append({
            "size": len(ws), "wallets": sorted(ws), "includes_deployer": deployer in ws,
            "shared_funders": shared[:10],
            "linked_via_hub_funder": sorted(set(shared) & hub_funders)[:10],
            "linked_via_multisend": sorted(set(shared) & multisend)[:10],
            "linked_via_member_funding": sorted(set(shared) & members)[:10],
            "min_hop": min((h for f in shared for (w, h) in link.get(f, ()) if w in ws), default=None),
            "pct_supply_bought_early": round(100 * bought / total, 3),
            "pct_supply_held_now": round(100 * held / total, 3) if known else None,
            "balances_known_for": len(known),
            "same_slot_buyers": sum(1 for w in ws if w in buyers and buyers[w]["same_slot_as_create"]),
        })

    def share(c): return max(c["pct_supply_bought_early"], c["pct_supply_held_now"] or 0)
    clusters.sort(key=lambda c: -share(c))
    dep = next((c for c in clusters if c["includes_deployer"]), None)
    clustered = {w for c in clusters for w in c["wallets"]}
    return {
        "clusters": clusters, "n_clusters": len(clusters),
        "clustered_buyers": len(clustered & set(buyers)),
        "clustered_buyer_ratio": round(len(clustered & set(buyers)) / max(1, len(buyers)), 3),
        "total_cluster_supply_pct": round(sum(share(c) for c in clusters), 3),
        "total_cluster_held_now_pct": round(sum(c["pct_supply_held_now"] or 0 for c in clusters), 3) if (balances or balances_complete) else None,
        "largest_cluster_supply_pct": round(max((share(c) for c in clusters), default=0), 3),
        "deployer_cluster": dep, "deployer_cluster_supply_pct": share(dep) if dep else None,
        "multisend_funders": sorted(multisend)[:10],
        "funding_window_hours": window_h,
    }
