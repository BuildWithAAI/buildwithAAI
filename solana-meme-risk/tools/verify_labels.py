"""Verify candidate Solana entity labels against a public explorer (Codex Scan) and write
data/labels/known_entities.json with a citation URL + verification timestamp per address.

Candidates come from (a) public lists (cited per entry in tools/label_candidates.json) and
(b) optionally, the most frequent funders seen in data/funding_graph.db (--from-graph N).
Only addresses that the explorer itself labels as an exchange / known service are kept;
everything else is recorded under `rejected` so the provenance is auditable.

Read-only HTTP GETs; no keys. Usage:
  python tools/verify_labels.py [--from-graph 50]
"""
import argparse, html, json, os, re, sqlite3, sys, time
import requests

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CAND = os.path.join(ROOT, "tools", "label_candidates.json")
OUT = os.path.join(ROOT, "data", "labels", "known_entities.json")
EXPLORER = "https://scan.codex.io/sol/address/{}"
CATEGORY_BY_TAG = {"exchange": "cex", "hot wallet": "cex"}
SERVICE_NAMES = {"Jupiter", "Axiom", "OKX DEX", "Raydium", "Photon", "BullX", "GMGN", "Trojan", "Phantom", "MoonPay",
                 "pump.fun", "Pump.fun", "Wormhole", "deBridge", "Mayan", "FixedFloat", "ChangeNOW", "Bitget Wallet"}


def explorer_label(addr, session):
    h = session.get(EXPLORER.format(addr), headers={"User-Agent": "Mozilla/5.0"}, timeout=25).text
    m = re.search(r'<h1[^>]*><span class="flex flex-col gap-1"><span>([^<]+)</span>', h)
    if not m:
        return None, []
    seg = h[m.end():m.end() + 3000]
    tags = sorted(set(re.findall(r'>([a-z][a-z \-]{3,40})</span>', seg)))
    return html.unescape(m.group(1)).strip(), tags


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--from-graph", type=int, default=0, help="also check the N most frequent funders in funding_graph.db")
    ap.add_argument("--sleep", type=float, default=0.7)
    a = ap.parse_args()
    cands = json.load(open(CAND))
    prev = json.load(open(OUT)) if os.path.exists(OUT) else {"entities": {}, "rejected": {}}
    if a.from_graph:
        db = sqlite3.connect(os.path.join(ROOT, "data", "funding_graph.db"))
        for (f, n) in db.execute("SELECT funder, COUNT(DISTINCT funded) n FROM edges GROUP BY funder ORDER BY n DESC LIMIT ?", (a.from_graph,)):
            cands.setdefault(f, {"candidate_source": f"funding_graph.db: funded {n} distinct traced wallets"})
    s = requests.Session()
    ents, rej = prev.get("entities", {}), prev.get("rejected", {})
    for addr, meta in cands.items():
        if addr in ents and ents[addr].get("verified_at"):
            continue
        try:
            name, tags = explorer_label(addr, s)
        except Exception as e:
            print(f"{addr}: error {e}", file=sys.stderr); continue
        time.sleep(a.sleep)
        cat = next((CATEGORY_BY_TAG[t] for t in tags if t in CATEGORY_BY_TAG), None)
        if name and not cat and (name in SERVICE_NAMES or "other" in tags):
            cat = "service"
        rec = {"name": name, "explorer_tags": tags, "category": cat, "source_url": EXPLORER.format(addr),
               "verified_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), **meta}
        if name and cat:
            ents[addr] = rec; rej.pop(addr, None)
        else:
            rej[addr] = rec
        print(f"{addr}  {name}  {cat}  {tags}")
    out = {"schema": "known_entities.v1",
           "description": "Solana addresses verified against a public explorer label. category cex = centralized-exchange hot wallet "
                          "(never used to link wallets into clusters); service = router/bot/DEX infrastructure (also never links).",
           "verification_method": "HTTP GET of source_url; label = explorer page heading; tags = explorer entity/type tags.",
           "entities": dict(sorted(ents.items(), key=lambda kv: (kv[1]['category'], kv[1]['name'] or ''))),
           "rejected": rej}
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    json.dump(out, open(OUT, "w"), indent=1)
    print(f"wrote {OUT}: {len(ents)} verified, {len(rej)} rejected")


if __name__ == "__main__":
    main()
