"""Relevance, incident type, evergreen topic, audience cues, subject (protocol)
extraction and reported-loss extraction. Rules are explicit regexes so every
decision can be printed as a reason.
"""

import re

from . import safety
from .textutil import MONEY_RE, clean_ws, money_value

TYPES = (
    "exploit", "phishing", "drainer", "rug", "key-compromise", "social-engineering", "bridge",
    "oracle", "governance", "other",
)
EVERGREEN = (
    "drainers", "address-poisoning", "phishing", "key-management", "bridge-security",
    "oracle-manipulation", "rug-pulls", "social-engineering", "fake-job-malware",
)
TYPE_LABEL = {
    "exploit": "smart-contract or protocol exploit",
    "phishing": "phishing",
    "drainer": "wallet drainer",
    "rug": "rug pull",
    "key-compromise": "key compromise",
    "social-engineering": "social engineering",
    "bridge": "bridge exploit",
    "oracle": "oracle manipulation",
    "governance": "governance attack",
    "other": "security incident (mechanism not classified)",
}

# ---------------------------------------------------------------- relevance

INCIDENT_RE = re.compile(
    r"\b(hack(?:s|ed|er|ers|ing)?|exploit(?:s|ed|er|ers)?|drain(?:s|ed|er|ers|ing)?|stole|"
    r"stolen|steal(?:s|ing)?|theft|thefts|heist|breach(?:es|ed)?|phish(?:ing|ed|er|ers)?|"
    r"scam(?:s|med|mer|mers)?|fraudsters?|rug[- ]?pull(?:s|ed)?|rugged|compromis(?:e|ed|es)|"
    r"malware|infostealer|drainers?|poisoning|attackers?|attacked|ransomware|siphon(?:ed|s)?|"
    r"looted|loot|ponzi|pig[- ]butcher\w*|impersonat\w+|laundered|launder(?:ing|s)?)\b",
    re.IGNORECASE,
)
SECURITY_TOPIC_RE = re.compile(
    r"\b(vulnerabilit(?:y|ies)|security (?:incident|flaw|bug|alert|breach)|bug bounty|"
    r"post-?mortem|incident report|zero-day|cve-\d+|patch(?:ed|es)? (?:a )?(?:bug|flaw)|"
    r"private keys?|seed phrases?|recovery phrases?|wallet security|frozen funds|freez\w+)\b",
    re.IGNORECASE,
)
CRYPTO_RE = re.compile(
    r"\b(crypto\w*|bitcoin|btc|ethereum|eth|ether|solana|sol|stablecoins?|usdc|usdt|tether|"
    r"defi|blockchain|on-?chain|nfts?|web3|smart contracts?|seed phrases?|recovery phrases?|"
    r"memecoins?|airdrops?|tornado cash|monero|xmr|dex|cex|binance|coinbase|kraken|bybit|okx|"
    r"wallets?|tokens?|bridges?|validators?|staking|liquidity|lending|vaults?|dao|mixers?|"
    r"exchanges?|protocols?|layer[- ]?2|rollups?|hyperliquid|tron|bnb|polygon|arbitrum|base)\b",
    re.IGNORECASE,
)
PROMO_RE = re.compile(
    r"\b(launch(?:es|ed)?|announc(?:es|ed|ing)|partners? with|partnership|selected to|webinar|"
    r"podcast|case study|completes .{0,40}verification|strengthened its security posture|"
    r"builds an institutional|join us|hiring)\b",
    re.IGNORECASE,
)


def relevance(item, source):
    """(security: bool, incident: bool, reason: str) for one parsed item."""
    title = item.get("title") or ""
    excerpt = item.get("excerpt") or ""
    url = item.get("url") or ""
    cats = [c.lower() for c in item.get("categories") or []]
    for pattern in source.get("excludeUrlPatterns", []):
        if pattern in url:
            return False, False, f"excluded: URL matches {pattern!r}"
    excluded = {c.lower() for c in source.get("excludeCategories", [])}
    if excluded & set(cats):
        return False, False, "excluded: category " + ", ".join(sorted(excluded & set(cats)))
    if source.get("role") == "vendor-blog" and PROMO_RE.search(title):
        return False, False, "excluded: promotional post"
    if item.get("kind") == "structured":
        return True, True, "incident database record"
    text = f"{title} {excerpt}"
    incident = INCIDENT_RE.search(text)
    topic = SECURITY_TOPIC_RE.search(text)
    forced = any(p in url for p in source.get("securityUrlPatterns", []))
    crypto = CRYPTO_RE.search(text)
    if not crypto and not forced:
        return False, False, "no crypto context"
    if item.get("kind") == "postmortem" and (incident or item.get("subject")):
        return True, True, "post-mortem"
    if incident:
        return True, True, f"incident term {incident.group(1)!r}"
    if topic or forced:
        why = f"security topic {topic.group(1)!r}" if topic else "security section URL"
        return True, False, why
    return False, False, "no security terms"


# ---------------------------------------------------------------- type and evergreen

_TEXT_TYPE_RULES = (
    ("social-engineering", "fake-job-malware",
     r"fake (?:job|interview|recruit\w*)|job (?:interview|offer)s?|employment fraud|it worker fraud|"
     r"hiring scam|recruit\w* scam|interview playbook"),
    ("drainer", "drainers", r"\bdrainers?\b|wallet[- ]drain\w*|permit phishing|approval phishing"),
    ("phishing", "address-poisoning", r"address[- ]poison\w*|poisoned address\w*|zero[- ]value transfers?"),
    ("phishing", "phishing",
     r"phish\w*|malvertis\w*|malicious (?:ads?|links?|sites?|websites?|extensions?)|"
     r"fake (?:websites?|sites?|apps?|extensions?|exchanges?|support)|dns hijack\w*|"
     r"front-?end (?:compromise|hijack)\w*|typosquat\w*|online ads"),
    ("social-engineering", "social-engineering",
     r"social[- ]engineer\w*|pig[- ]butcher\w*|romance scam|wrench attack|kidnap\w*|extort\w*|"
     r"sextortion|impersonation scam|impersonat\w+"),
    ("rug", "rug-pulls", r"rug[- ]?pull\w*|\brugged\b|exit scam|pulled (?:the )?liquidity"),
    ("key-compromise", "key-management",
     r"private keys?|seed phrases?|recovery phrases?|mnemonic|signing keys?|key (?:compromise|leak\w*|theft)|"
     r"compromised (?:keys?|wallets?|signers?)|leaked (?:api )?keys?|api keys?|hot wallets?|"
     r"weak (?:wallet )?seeds?|key management|nonce reuse|reused nonces"),
    ("oracle", "oracle-manipulation", r"\boracles?\b|price manipulation|manipulated (?:the )?price"),
    ("governance", None, r"governance (?:attack|exploit|takeover)|malicious proposal"),
    ("bridge", "bridge-security", r"\bbridges?\b|cross-chain"),
    ("exploit", None, r"exploit\w*|hack\w*|drain\w*|vulnerabilit\w*|flash[- ]loan\w*|reentran\w*|stolen|theft"),
)
_TEXT_TYPE_RULES = tuple((t, e, re.compile(p, re.IGNORECASE)) for t, e, p in _TEXT_TYPE_RULES)

# Priority when sources disagree: the most specific / most user-relevant mechanism wins.
TYPE_PRIORITY = (
    "social-engineering", "drainer", "phishing", "rug", "key-compromise", "oracle", "governance",
    "bridge", "exploit", "other",
)

_TECHNIQUE_MAP = {
    "Phishing": ("phishing", "phishing"),
    "Signer Phishing": ("phishing", "phishing"),
    "Address Poisoning": ("phishing", "address-poisoning"),
    "Impersonation Scam": ("social-engineering", "social-engineering"),
    "Social Account Takeover": ("phishing", "phishing"),
    "Malware": ("other", "key-management"),
    "DNS Hijack": ("phishing", "drainers"),
    "Frontend Compromise": ("phishing", "drainers"),
    "CDN Compromise": ("phishing", "drainers"),
    "Supply Chain Attack": ("other", "key-management"),
    "Database Breach": ("other", "key-management"),
    "Token Approval Abuse": ("exploit", "drainers"),
    "Liquidity Rug": ("rug", "rug-pulls"),
    "Exit Scam": ("rug", "rug-pulls"),
    "Backdoor Contract": ("rug", "rug-pulls"),
    "Treasury Misappropriation": ("rug", "rug-pulls"),
    "Malicious Proposal": ("governance", None),
    "Flashloan Governance Attack": ("governance", None),
    "Spot Price Manipulation": ("oracle", "oracle-manipulation"),
    "Oracle Misconfiguration": ("oracle", "oracle-manipulation"),
    "Stale Oracle Price": ("oracle", "oracle-manipulation"),
    "Predictable Oracle Update": ("oracle", "oracle-manipulation"),
    "Stale Price Arbitrage": ("oracle", "oracle-manipulation"),
    "Cross-Chain Message Spoofing": ("bridge", "bridge-security"),
    "Bridge Logic Flaw": ("bridge", "bridge-security"),
    "Unbacked Cross-Chain Mint": ("bridge", "bridge-security"),
    "Forged Proof": ("bridge", "bridge-security"),
    "Proof Verifier Bug": ("bridge", "bridge-security"),
    "Merkle Proof Forgery": ("bridge", "bridge-security"),
}
_KEY_TECHNIQUES = {
    "Key Leaked via Infrastructure", "API Key Compromised", "Session Key Compromised",
    "Key Stored Publicly", "Key Brute Forced", "Weak Key Generation", "Private Key Compromised",
    "Hot Wallet Key Compromised", "Deployer Key Compromised", "Validator Key Compromised",
}
_CLASS_MAP = {
    "Key Compromise": ("key-compromise", "key-management"),
    "Bridge & Cross-Chain": ("bridge", "bridge-security"),
    "Oracle Manipulation": ("oracle", "oracle-manipulation"),
    "Governance": ("governance", None),
    "Rugpull": ("rug", "rug-pulls"),
    "Social Engineering": ("social-engineering", "social-engineering"),
    "Access Control": ("exploit", None),
    "Protocol Logic": ("exploit", None),
    "Token & Share Accounting": ("exploit", None),
    "Input Validation": ("exploit", None),
    "Reentrancy": ("exploit", None),
    "Market Manipulation": ("exploit", None),
}
_SLOWMIST_METHOD = (
    (re.compile(r"phish", re.I), ("phishing", "phishing")),
    (re.compile(r"private key|key leak|key compromise", re.I), ("key-compromise", "key-management")),
    (re.compile(r"rug|exit scam", re.I), ("rug", "rug-pulls")),
    (re.compile(r"oracle|price manipulation", re.I), ("oracle", "oracle-manipulation")),
    (re.compile(r"social engineering", re.I), ("social-engineering", "social-engineering")),
    (re.compile(r"contract vulnerability|logic|reentrancy|flash", re.I), ("exploit", None)),
)


def type_from_defillama(record):
    technique = record.get("technique") or ""
    classification = record.get("classification") or ""
    if technique in _TECHNIQUE_MAP:
        return _TECHNIQUE_MAP[technique] + (f"DefiLlama technique {technique!r}",)
    if technique in _KEY_TECHNIQUES:
        return ("key-compromise", "key-management", f"DefiLlama technique {technique!r}")
    if classification in _CLASS_MAP:
        kind, topic = _CLASS_MAP[classification]
        if kind == "exploit" and record.get("bridgeHack"):
            return ("bridge", "bridge-security", f"DefiLlama classification {classification!r} + bridgeHack")
        return (kind, topic, f"DefiLlama classification {classification!r}")
    if record.get("bridgeHack"):
        return ("bridge", "bridge-security", "DefiLlama bridgeHack")
    return ("other", None, "DefiLlama record without a mapped class")


def type_from_slowmist(method):
    for pattern, (kind, topic) in _SLOWMIST_METHOD:
        if method and pattern.search(method):
            return (kind, topic, f"SlowMist attack method {method!r}")
    return None


def type_from_text(text):
    for kind, topic, pattern in _TEXT_TYPE_RULES:
        match = pattern.search(text or "")
        if match:
            return (kind, topic, f"text {match.group(0)!r}")
    return None


def fake_job_signal(text):
    return bool(_TEXT_TYPE_RULES[0][2].search(text or ""))


# ---------------------------------------------------------------- audience

_RETAIL_CUES = re.compile(
    r"\b(users?|customers?|retail|holders?|victims?|depositors?|accounts?|hardware wallets?|"
    r"seed phrases?|recovery phrases?|iphones?|android|mobile|browser extensions?|online ads|"
    r"app users|wallet app|withdrawals? (?:halted|suspended|paused)|halts? withdrawals|"
    r"suspend\w* (?:deposits|withdrawals)|universal profiles?)\b",
    re.IGNORECASE,
)
_INSTITUTIONAL_CUES = re.compile(
    r"\b(market makers?|treasury|validators?|deployer|admin (?:key|wallet|account)s?|"
    r"operational treasury|mev bots?|liquidity providers?)\b",
    re.IGNORECASE,
)
TARGET_AUDIENCE = {
    "Wallet": 0.9, "CEX": 0.8, "Prediction Market": 0.6, "Gambling Platform": 0.5, "Gaming": 0.5,
    "Token": 0.5, "Chain": 0.5, "Layer 1": 0.5, "NFTfi": 0.5, "Web Infrastructure": 0.5,
    "AI Agent": 0.5, "Payments": 0.6, "Crypto Card": 0.7, "Other": 0.4, "DeFi Protocol": 0.35,
    "Liquidity Pool": 0.3, "DAO": 0.3, "RWA": 0.35, "ICO": 0.5, "Foundation": 0.3,
    "Mining Infrastructure": 0.2,
}


def retail_cues(text):
    return sorted({m.group(1).lower() for m in _RETAIL_CUES.finditer(text or "")})


def institutional_cues(text):
    return sorted({m.group(1).lower() for m in _INSTITUTIONAL_CUES.finditer(text or "")})


# ---------------------------------------------------------------- follow-up cues

FOLLOW_UP_RE = re.compile(
    r"\b(recover\w*|freez\w*|frozen|forfeit\w*|seiz\w*|launder\w*|mixers?|bounty|post-?mortem|"
    r"reimburs\w*|compensat\w*|refund\w*|indict\w*|charged|arrest\w*|stolen in|tied to|linked to|"
    r"hack-linked|hack loot|loot|after (?:the|its|a) \w*\s?(?:hack|exploit|breach)|in the wake|"
    r"(?:days|weeks|months) after|shut down|shuts down|to shut)\b",
    re.IGNORECASE,
)


def follow_up(text):
    match = FOLLOW_UP_RE.search(text or "")
    return match.group(1).lower() if match else None


# ---------------------------------------------------------------- reported losses

# "<verb> (for) (about) $X": exploited for $3.8 million, loses $12M, withdrew $10.39 million
_LOSS_VERB_BEFORE = re.compile(
    r"\b(?:exploited|hacked|drained|robbed|loses|lost|lose|losing|stole|stolen|steal|steals|"
    r"drains|drain|siphon(?:ed|s)?|swiped|looted|extract(?:ed|ing)|withdrew|withdrawn|"
    r"totall?ing|totall?ed|loss of|losses of|theft of|heist of|hit in|hit by|hit with)\s+"
    r"(?:for\s+|of\s+)?(?:about|around|approximately|approx\.?|nearly|almost|over|more than|"
    r"at least|roughly|some|an estimated|up to)?\s*$",
    re.IGNORECASE,
)
# "$X <0-2 words> <loss noun>": $12M hack, $12.6 Million Vault Hack, $133M crypto theft,
# "$X in thefts", "$X stolen"
_LOSS_NOUN_AFTER = re.compile(
    r"^\s*(?P<between>(?:[A-Za-z][\w.\-]*\s+){0,2}?)(?:hack|hacks|exploit|exploits|theft|thefts|"
    r"heist|breach|drain|attack|loss|losses)\b"
    r"|^\s*(?:in|of)\s+(?:stolen|losses|thefts)\b"
    r"|^\s*(?:was\s+|were\s+)?(?:stolen|drained|lost|swiped|siphoned|looted)\b",
    re.IGNORECASE,
)
_BETWEEN_STOP = {"of", "in", "from", "to", "through", "with", "for", "tied", "linked", "order", "freezing", "as"}
# Context that makes a figure something other than a loss: recoveries, seizures,
# freezes, bounties, laundering flows, funding, prices.
_NOT_LOSS = re.compile(
    r"\b(recover\w*|seek\w*|seiz\w*|freez\w*|frozen|forfeit\w*|bounty|return\w*|refund\w*|"
    r"reimburs\w*|compensat\w*|raise[sd]?|fund(?:ing|ed)?|loan|price|launder\w*|mixers?|moves?|"
    r"push(?:es|ed)?|through|worth of|order|valuation|revenue|tvl|market cap|insurance|cover\w*)\b",
    re.IGNORECASE,
)


def reported_amounts(text):
    """USD figures the text states as losses: [(amount, quote)]. Strict on purpose:
    recoveries, freezes, seizures, bounties and laundering flows are not losses."""
    out = []
    text = text or ""
    for match in MONEY_RE.finditer(text):
        value = money_value(match)
        if value < 1000:
            continue
        before = text[max(0, match.start() - 60): match.start()]
        after = text[match.end(): match.end() + 50]
        is_loss = bool(_LOSS_VERB_BEFORE.search(before))
        if not is_loss:
            tail = _LOSS_NOUN_AFTER.match(after)
            if tail:
                between = (tail.group("between") or "").split()
                is_loss = not any(w.lower() in _BETWEEN_STOP for w in between)
        if is_loss and _NOT_LOSS.search(text[max(0, match.start() - 45): match.start()]):
            is_loss = False
        if is_loss:
            quote = text[match.start(): match.end()].strip()
            if all(abs(value - v) > 0.5 for v, _ in out):
                out.append((value, quote))
    return out


# ---------------------------------------------------------------- subject extraction

_STOPWORDS = {
    w.lower() for w in """US U.S. UK EU DOJ SEC CFTC FBI IRS OFAC FinCEN Treasury Police Court Judge
    Senate Congress President North South East West Korea Korean China Chinese Japan Japanese
    French France Brazil Brazilian Indian India Russia Russian Iran Iranian Czech German Germany Thai
    Australian Canadian Hong Kong Singapore Paris Dubai Abu Dhabi ADGM Reuters Bloomberg Report
    Exclusive Breaking Update Live Updated Analysis Opinion How Why What Who When Where Here This
    These That The A An Crypto Cryptocurrency Blockchain DeFi NFT Web3 AI Hackers Hacker Attackers
    Attacker Scammers Fraudsters Thieves Exploiter Exploiters Users User Investors Traders Wallets
    Weekly Daily Morning Minute Lazarus DPRK TraderTraitor January February March April May June
    July August September October November December Jan Feb Mar Apr Jun Jul Aug Sep Sept Oct Nov Dec
    Monday Tuesday Wednesday Thursday Friday Saturday Sunday Bitcoin Ethereum Solana Ether BTC ETH
    SOL USDC USDT Tether Stablecoin Stablecoins Token Tokens Exchange Exchanges Bridge Protocol Hack
    Hacks Exploit Exploits Theft Heist Scam Scams Breach Fake Major Top New Another Second First
    Largest Biggest Over Under After Before Amid Despite As In On At Of For To With By From Into
    And Or But Not Its It His Her Their Our Your We You They He She Million Billion Thousand
    Says Said Report Reports Researchers Researcher Investigators Security Firm Firms Platform
    Chain Network Ledger Hardware Wallet iPhone iPhones iPad iOS macOS Android YouTube GitHub
    Google Apple Microsoft Telegram Discord WhatsApp ChatGPT OpenAI Nvidia X Twitter""".split()
}
_TRIGGERS = {
    w for w in """exploited hacked drained breached compromised attacked rugged robbed loses lost lose
    suffers suffered halts halted pauses paused suspends suspended freezes confirms confirmed
    admits admitted suspects hit hits struck targeted targets discloses hack hacks exploit exploits
    breach theft heist attack drain drains hackers exploiter attacker attackers victims stolen""".split()
}
_ACTIVE_TRIGGERS = {
    w for w in """hacks hack hacked drains drain drained exploits exploit exploited targets targeted
    hits hit breaches breached robs robbed attacks attacked""".split()
}
_SKIPPABLE = {
    w for w in """bridge vault vaults pool pools wallet wallets exchange protocol platform contract
    contracts token app market account accounts user users user(s) customers holders treasury
    server website frontend front-end dao network lending lender dex perps funds blockchain chain
    project firm company bank marketplace game stablecoin""".split()
}
_MODIFIER_SUFFIX = re.compile(
    r"-(?:linked|backed|based|focused|owned|related|tied|led|affiliated)$", re.IGNORECASE
)
_CONNECTORS = {"and", "&", "of", "de", "du", "la", "des", "x"}
_QUOTES = "\"'‘’“”()[]!?"
AMT = "§AMT§"


def _bare(token):
    return token.strip(_QUOTES).rstrip(".")


def _cap_like(token):
    word = _bare(token)
    if not word or word == AMT:
        return False
    if word[0].isupper() or word[0].isdigit():
        return True
    return any(ch.isupper() for ch in word[1:]) or re.fullmatch(r"[A-Za-z0-9]+\.[A-Za-z]{2,}", word) is not None


def _is_stop(token):
    return _bare(_strip_possessive(token)).lower() in _STOPWORDS


def _strip_possessive(token):
    """'Binance's' -> 'Binance', "users'" -> 'users'."""
    if re.search(r"['’]s$", token):
        return token[:-2]
    if re.search(r"s['’]$", token):
        return token[:-1]
    return token


def _has_possessive(token):
    return re.search(r"['’]s$", token) is not None


def _clean_run(run):
    words = [_bare(_strip_possessive(t)) for t in run]
    words = [w for w in words if w]
    while words and (words[0].lower() in _STOPWORDS or words[0].lower() in _CONNECTORS):
        words.pop(0)
    while words and (words[-1].lower() in _GENERIC_TRAIL or words[-1].lower() in _CONNECTORS):
        words.pop()
    if not words or all(w.lower() in _STOPWORDS for w in words):
        return None
    return clean_ws(" ".join(words))


def _run_before(tokens, ends, index):
    j = index - 1
    skipped = 0
    while j >= 0 and skipped < 2 and _bare(tokens[j]).lower() in _SKIPPABLE:
        j -= 1
        skipped += 1
    run = []
    while j >= 0:
        tok = tokens[j]
        if tok == AMT or _MODIFIER_SUFFIX.search(_bare(tok)) or (ends[j] and run):
            break
        if _has_possessive(tok):
            if run:
                break
            run.insert(0, tok)
            j -= 1
            continue
        if _cap_like(tok) or (run and tok.lower() in _CONNECTORS and j > 0 and _cap_like(tokens[j - 1])):
            run.insert(0, tok)
            j -= 1
            continue
        break
    return run, j


def _run_after(tokens, ends, index):
    k = index + 1
    if k < len(tokens) and tokens[k].lower() == "the":
        k += 1
    run = []
    while k < len(tokens):
        tok = tokens[k]
        if tok == AMT:
            break
        if _cap_like(tok) or (run and tok.lower() in _CONNECTORS and k + 1 < len(tokens) and _cap_like(tokens[k + 1])):
            run.append(tok)
            if ends[k] or _has_possessive(tok):
                break
            k += 1
            continue
        break
    return run


def _possessive_owner(tokens, before_index):
    for k in range(before_index, max(-1, before_index - 4), -1):
        if k >= 0 and _has_possessive(tokens[k]):
            run = [tokens[k]]
            m = k - 1
            while m >= 0 and _cap_like(tokens[m]) and not _has_possessive(tokens[m]):
                run.insert(0, tokens[m])
                m -= 1
            return _clean_run(run)
    return None


def _ticker_like(candidate):
    return " " not in candidate and (
        (candidate.isupper() and len(candidate) <= 6)
        or re.fullmatch(r"[a-z]{1,3}[A-Z]{2,}", candidate) is not None
    )


def extract_subject(title):
    """Best-effort subject (protocol, company or campaign) of a security headline.

    Returns (subject, method) or (None, None). Precision over recall: a headline
    without a confident subject stays unclustered ("also seen") rather than
    becoming an incident with a guessed name.
    """
    if not title:
        return None, None
    text = MONEY_RE.sub(" " + AMT + " ", title.replace("’", "'"))
    raw = text.split()
    tokens = [t.rstrip(",:;") for t in raw]
    ends = [t.endswith((",", ":", ";")) for t in raw]
    for index, token in enumerate(tokens):
        word = _bare(token).lower()
        if word not in _TRIGGERS:
            continue
        run, j = _run_before(tokens, ends, index)
        candidate = _clean_run(run) if run else None
        if candidate and _ticker_like(candidate):
            candidate = _possessive_owner(tokens, j) or candidate
        if candidate:
            return candidate, "headline pattern"
        if word in _ACTIVE_TRIGGERS:
            candidate = _clean_run(_run_after(tokens, ends, index))
            if candidate:
                return candidate, "headline pattern"
    for index, token in enumerate(tokens[:-1]):
        if re.fullmatch(r"(?i)(?:hack|exploit|breach|attack|theft|heist|drain)\w*", _bare(token)) and \
                tokens[index + 1].lower() in ("of", "on", "at", "against", "from"):
            candidate = _clean_run(_run_after(tokens, ends, index + 1))
            if candidate:
                return candidate, "headline pattern"
    if len(tokens) > 1 and _cap_like(tokens[0]) and not _is_stop(tokens[0]):
        nxt = _bare(tokens[1])
        if nxt and nxt[0].islower():
            candidate = _clean_run([tokens[0]])
            if candidate:
                return candidate, "sentence-case subject"
    for token in tokens:
        word = _bare(_strip_possessive(token))
        if word == AMT or word.lower() in _STOPWORDS or len(word) < 3 or word.isdigit():
            continue
        distinctive = (word.isupper() and word.isalpha()) or (
            any(ch.isupper() for ch in word[1:]) and any(ch.islower() for ch in word)
        ) or re.fullmatch(r"[A-Za-z0-9]+\.[A-Za-z]{2,}", word) is not None
        if distinctive:
            return word, "distinctive token"
    return None, None


_GENERIC_TRAIL = {
    "bridge", "vault", "vaults", "exchange", "protocol", "wallet", "wallets", "token", "network",
    "hack", "exploit", "users", "user", "platform", "app", "pool", "contract", "hackers", "loot",
}


# ---------------------------------------------------------------- chains

_CHAIN_PATTERNS = (
    ("Ethereum", r"\bEthereum\b"), ("Bitcoin", r"\bBitcoin\b"), ("Solana", r"\bSolana\b"),
    ("BNB Chain", r"\b(?:BNB Chain|BSC|BNB Smart Chain)\b"), ("Base", r"\bBase\b(?= (?:chain|network|bridge|L2|layer)|,| and)"),
    ("Arbitrum", r"\bArbitrum\b"), ("Optimism", r"\bOptimism\b"), ("Polygon", r"\bPolygon\b"),
    ("Avalanche", r"\bAvalanche\b"), ("TRON", r"\b(?:TRON|Tron)\b"), ("TON", r"\bTON\b"),
    ("Sui", r"\bSui\b"), ("Aptos", r"\bAptos\b"), ("Hyperliquid", r"\bHyperliquid\b"),
    ("Cardano", r"\bCardano\b"), ("XRP Ledger", r"\bXRP Ledger\b"), ("Stellar", r"\bStellar\b"),
    ("Monero", r"\bMonero\b"), ("Litecoin", r"\bLitecoin\b"), ("Algorand", r"\bAlgorand\b"),
)
_CHAIN_PATTERNS = tuple((name, re.compile(p)) for name, p in _CHAIN_PATTERNS)
CHAIN_ALIASES = {"BSC": "BNB Chain", "Binance": "BNB Chain", "BNB": "BNB Chain", "Tron": "TRON", "Hyperliquid L1": "Hyperliquid"}


def chains_in_text(text):
    found = []
    for name, pattern in _CHAIN_PATTERNS:
        match = pattern.search(text or "")
        if match:
            found.append((match.start(), name))
    return [name for _, name in sorted(found)]


def normalize_chain(name):
    return CHAIN_ALIASES.get(name, name)


def legal_flags(text):
    return safety.legal_terms(text)
