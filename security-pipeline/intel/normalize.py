"""Rule-based normalization: category, chain, entity, loss, status. Deterministic and auditable."""
from __future__ import annotations
import re
from common.util import slug

CATEGORIES = ["exchange_hack", "bridge_exploit", "defi_exploit", "drainer_phishing", "supply_chain",
              "malware", "account_takeover", "rug_pull", "outage", "vuln_advisory", "regulatory",
              "exchange_notice", "other"]

HACKW = r"(hack(?:ed|er|ers|s)?|exploit(?:ed|s)?|breach(?:ed)?|stol(?:en|e)|drain(?:ed|s|ing)?|heist|compromis(?:ed|e)|attack(?:ed|er|ers)?|theft|lost \$|loses \$|siphon(?:ed)?)"
R = lambda p: re.compile(p, re.I)
LAW_ENF = re.compile(r"\b(sentenc\w*|extradit\w*|indict\w*|pleads? guilty|plead guilty|arrest(ed|s)?|charged with|convicted|jailed|prison)\b", re.I)
RETRO = re.compile(r"\b(launder\w*|forensic\w*|infiltrat\w*|anniversary|explained|lessons|retrospective|post[- ]?mortem|years? (ago|after|later)|months (after|later)|recap|look back|report finds|analysis|top \d+ (biggest |largest |major )?(crypto )?(hacks|heists|exploits))\b", re.I)
FRESH = re.compile(r"\b(hacked|exploited|drained|breached|compromised|suspends?|halts?|paused|freezes|loses|lost|suffers?|under attack|attacked|stolen from|warns?|urges? users|confirms? (hack|breach|exploit|attack))\b", re.I)
COMMON_WORDS = {"drop", "float", "meter", "liquid", "fence", "coffer", "bonfire", "dominion", "nesa", "virtue", "surf",
                "set", "maya", "unknown", "multiple", "aave", "tac", "usm", "ccc", "moke", "bank", "trust", "safe",
                "spark", "hedgey", "magic", "chain", "bridge", "swap", "vault", "orbit", "loopring", "fortress",
                "premia", "bitbay", "secret", "service", "core", "flow", "drift protocol", "rocket", "radiant", "visor", "harmony"}
GENERIC_SUFFIX = re.compile(r"\s+(trade|finance|protocol|v\d|network|lending|markets?|bridge|dex|amm|labs|foundation|cex|exchange|money market)$", re.I)
RULES: list[tuple[str, re.Pattern]] = [
    ("regulatory", LAW_ENF),
    ("drainer_phishing", R(r"\b(drainer|phishing|phish|address[- ]poisoning|poisoning attack|ice phishing|permit2? signature|malicious (signature|approval)|fake (site|website|app|airdrop|token|support)|impersonat\w+|social[- ]engineer\w*|wrench attack|pig[- ]butchering|approval scam|(?<!hot )wallet drain\w*)\b")),
    ("supply_chain", R(r"\b(supply[- ]chain|npm|pypi|malicious (package|library|extension|update|script|javascript|code)|front[- ]?end (compromise|hijack|attack)|dns hijack\w*|domain hijack\w*|browser extension|compromised (website|domain|front[- ]?end|extension|monitoring service|plugin|sdk)|(server host|hosting provider|vps|trading cloud|desktop cloud|cloud servers?|servers?)\b.{0,40}\b(breach\w*|hack\w*|compromis\w*)|(breach\w*|hack\w*|compromis\w*)\b.{0,40}\b(server host|hosting provider|vps|trading cloud|desktop cloud|cloud servers?|servers?))\b")),
    ("malware", R(r"\b(malware|info[- ]?stealer|stealer|trojan|clipper|keylogger|remote access trojan|backdoor\w*|ransomware|spyware|crypto[- ]?jack\w*)\b")),
    ("account_takeover", R(r"\b(sim[- ]swap\w*|account takeover|(x|twitter|social media|discord|telegram) account (was |is )?(hacked|compromised|hijacked)|account hacked|credential stuffing|2fa bypass|session hijack\w*|hijacked (x|twitter|account)|x account (hack|compromis)\w*)\b")),
    ("rug_pull", R(r"\b(rug[- ]?pull\w*|rugged|exit scam|pulled (the )?liquidity|soft rug|honeypot token)\b")),
    ("bridge_exploit", R(r"\b(bridge|cross[- ]chain)\b.*\b" + HACKW + r"\b|\b" + HACKW + r"\b.*\b(bridge|cross[- ]chain)\b")),
    ("exchange_hack", R(r"\b(exchange|cex|hot wallet)\b.*\b" + HACKW + r"\b|\b" + HACKW + r"\b.*\b(exchange|cex|hot wallet)\b")),
    ("defi_exploit", R(r"\b(flash[- ]loan|reentrancy|oracle manipulation|price manipulation|" + HACKW[1:-1] + r")\b")),
    ("outage", R(r"\b(outage|downtime|halt(?:s|ed)? (withdrawals|deposits|trading)|suspend(?:s|ed)? (withdrawals|deposits|trading)|withdrawals? (halted|paused|suspended)|degraded performance|went offline|network (halt|stall)\w*)\b")),
    ("vuln_advisory", R(r"\b(vulnerabilit\w+|cve-\d{4}-\d+|zero[- ]day|0-day|critical bug|security (patch|advisory|update)|bug bounty)\b")),
    ("regulatory", R(r"\b(charged|indict\w*|sentenc\w*|arrest\w*|sanction\w*|ofac|seiz\w*|lawsuit|sues|sued|fined|enforcement action|money laundering|extradit\w*|guilty)\b")),
]

CEX_NAMES = ["Binance", "Coinbase", "Kraken", "OKX", "Bitget", "KuCoin", "Gate.io", "HTX", "Huobi", "MEXC",
             "Bitfinex", "Bitstamp", "Upbit", "Bithumb", "Crypto.com", "Gemini", "BingX", "Phemex", "WazirX",
             "CoinDCX", "BtcTurk", "Hyperliquid", "Robinhood", "Bitpanda", "LBank", "CoinEx", "Poloniex", "Deribit",
             "Bybit", "BloFin", "Nobitex", "BigONE", "Lykke", "DMM Bitcoin", "Indodax", "Cetus", "Kiloex"]

CHAINS = [("Solana", r"solana|\bsol\b"), ("Ethereum", r"ethereum|\beth\b|erc-?20"),
          ("BNB Chain", r"bnb chain|\bbsc\b|binance smart chain"), ("Base", r"\bbase (chain|network|l2)\b|on base\b"),
          ("Arbitrum", r"arbitrum"), ("Optimism", r"optimism"), ("Polygon", r"polygon"), ("Tron", r"\btron\b"),
          ("Bitcoin", r"bitcoin|\bbtc\b"), ("Avalanche", r"avalanche"), ("Sui", r"\bsui\b"), ("Aptos", r"aptos"),
          ("TON", r"\bton\b|telegram open network"), ("Hyperliquid", r"hyperliquid|hyperevm"),
          ("XRP Ledger", r"\bxrp\b|xrpl"), ("Cardano", r"cardano"), ("Sonic", r"\bsonic\b"), ("Berachain", r"berachain"),
          ("zkSync", r"zksync"), ("Linea", r"\blinea\b"), ("Starknet", r"starknet"), ("Cosmos", r"cosmos")]
CHAINS_RE = [(n, re.compile(p, re.I)) for n, p in CHAINS]

LOSS_RE = re.compile(r"\$\s?(\d{1,3}(?:[,]\d{3})+|\d+(?:\.\d+)?)\s?(billion|bn|b|million|mln|mn|m|thousand|k)?\b", re.I)
MULT = {"billion": 1e9, "bn": 1e9, "b": 1e9, "million": 1e6, "mln": 1e6, "mn": 1e6, "m": 1e6, "thousand": 1e3, "k": 1e3}
LOSS_CTX = re.compile(r"(stol|drain|lost|loss|loses|hack|exploit|heist|theft|siphon|swindl|scam|phish|launder)", re.I)

RESOLVED = re.compile(r"\b(recover(ed|s)|returned|refund(ed|s)?|reimburs\w+|compensat\w+|resum(ed|es)|restored|fully covered|bounty (accepted|deal)|white[- ]?hat return\w*|post[- ]?mortem)\b", re.I)
ACTIVE = re.compile(r"\b(ongoing|still (active|draining|live)|paused|halt(ed|s)|suspend(ed|s)|investigat\w+|under attack|actively|warn(s|ing) users|do not (interact|sign|connect)|revoke)\b", re.I)


def classify(text: str, hint: str | None = None) -> str:
    if hint:
        return hint
    for cat, rx in RULES:
        if rx.search(text):
            return cat
    return "other"


def is_security_relevant(text: str) -> bool:
    return classify(text) != "other"


def detect_chain(text: str) -> str | None:
    found = [n for n, rx in CHAINS_RE if rx.search(text)]
    return ",".join(found[:3]) if found else None


def extract_loss(text: str) -> float | None:
    """Largest $ figure that sits within ~60 chars of a loss/theft word (avoids TVL, prices, market caps)."""
    if not LOSS_CTX.search(text):
        return None
    best = None
    for m in LOSS_RE.finditer(text):
        ctx = text[max(0, m.start() - 60): m.end() + 60]
        if not LOSS_CTX.search(ctx) or re.search(r"\b(tvl|market cap|valuation|raises?|funding|prize|reward|bounty|worth of trading)\b", ctx, re.I):
            continue
        num = float(m.group(1).replace(",", ""))
        unit = (m.group(2) or "").lower()
        v = num * MULT.get(unit, 1)
        if v < 10_000 or v > 5e10:
            continue
        best = max(best or 0, v)
    return best


def detect_status(text: str) -> str | None:
    if RESOLVED.search(text):
        return "mitigated"
    if ACTIVE.search(text):
        return "active"
    return None


def entity_slug(name: str | None) -> str | None:
    if not name:
        return None
    name = re.sub(r"\(.*?\)", " ", name)
    s = re.sub(r"\b(cex|exchange|finance|protocol|labs|international|network|v\d)\b", " ", name.lower())
    return slug(s) or slug(name)


class EntityMatcher:
    def __init__(self, exposure: dict, extra_names: list[str]):
        names: dict[str, str] = {}
        self.excludes = [re.compile(re.escape(x), re.I) for e in exposure.get("entities", []) for x in e.get("exclude", [])]
        self.ctx = {e["name"]: re.compile(r"\b(" + "|".join(e["context_required"]) + r")", re.I)
                    for e in exposure.get("entities", []) if e.get("context_required")}
        for e in exposure.get("entities", []):
            if e.get("kind") in ("chain", "topic"):   # chains are context, not incident subjects
                continue
            for a in e.get("aliases", []) + [e["name"]]:
                names[a] = e["name"]
        for n in CEX_NAMES + extra_names:
            full = re.sub(r"\s*\(.*?\)", "", n).strip()
            for n2 in {re.sub(r"\s+(CEX|Exchange)$", "", full), GENERIC_SUFFIX.sub("", full)}:
                n2 = n2.strip()
                if len(n2) >= 4 and n2.lower() not in COMMON_WORDS | {"base", "solana", "ethereum", "bitcoin"}:
                    names.setdefault(n2, re.sub(r"\s+(CEX)$", "", full))
        # longest first so "Phantom wallet" beats "Phantom"
        self.items = sorted(names.items(), key=lambda kv: -len(kv[0]))
        self.rx = [(re.compile(r"(?<![\w.])" + re.escape(a) + r"(?![\w])", re.I if a[:1].islower() else 0), canon)
                   for a, canon in self.items]

    _HACK_NEAR = re.compile(r"^.{0,30}?\b(hack|heist|breach|exploit|drain|attack|stolen|loses|lost|compromis|suffer|victim|outage|halt|suspend|phish)", re.I)
    _HACK_BEFORE = re.compile(r"(hack|heist|breach|exploit|attack|drain\w*|theft)\w*\s+(of|on|at|against|hits?)\s+(the\s+)?$", re.I)

    def match(self, title: str, body: str = "") -> str | None:
        """Pick the entity that is the *subject* of the incident, not merely mentioned.
        Preference: entity adjacent to an incident verb > earliest mention."""
        for text in (title, body):
            for ex in self.excludes:
                text = ex.sub(" ", text)
            cands = []
            for rx, canon in self.rx:
                if canon in self.ctx and not self.ctx[canon].search(title + " " + body):
                    continue
                for m in rx.finditer(text):
                    after = text[m.end():m.end() + 40]
                    before = text[max(0, m.start() - 30):m.start()]
                    near = bool(self._HACK_NEAR.search(after)) or bool(self._HACK_BEFORE.search(before)) \
                        or after.startswith("'s ") and bool(self._HACK_NEAR.search(after[3:]))
                    cands.append((0 if near else 1, m.start(), canon))
                    break
            if cands:
                return min(cands)[2]
        return None


def is_cex(name: str | None) -> bool:
    return bool(name) and name.lower() in {c.lower() for c in CEX_NAMES}
