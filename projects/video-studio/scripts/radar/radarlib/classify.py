"""Relevance, incident type, evergreen topic, audience cues, subject (protocol)
extraction and reported-loss extraction. Rules are explicit regexes so every
decision can be printed as a reason.
"""

import json
import os
import re
import urllib.parse

from . import safety
from .textutil import ANY_DOLLAR_RE, MONEY_RE, clean_ws, core_name, money_value

CRYPTO_TYPES = (
    "exploit", "phishing", "drainer", "rug", "key-compromise", "social-engineering", "bridge",
    "oracle", "governance", "other",
)
# AI-security incident types (the AI lane). They never replace a crypto mechanism a source states.
AI_TYPES = (
    "prompt-injection", "ai-agent-exploit", "malicious-ai-tool", "model-supply-chain", "ai-data-exposure",
    "ai-assisted-attack", "deepfake-fraud", "ai-phishing", "ai-washing",
)
TYPES = CRYPTO_TYPES + AI_TYPES
AI_EVERGREEN = ("ai-security", "ai-scams")
EVERGREEN = (
    "drainers", "address-poisoning", "phishing", "key-management", "bridge-security",
    "oracle-manipulation", "rug-pulls", "social-engineering", "fake-job-malware",
) + AI_EVERGREEN
TYPE_LABEL = {
    "exploit": "exploit",
    "phishing": "phishing",
    "drainer": "wallet drainer",
    "rug": "rug pull",
    "key-compromise": "key compromise",
    "social-engineering": "social engineering",
    "bridge": "bridge exploit",
    "oracle": "oracle manipulation",
    "governance": "governance attack",
    "other": "security incident (mechanism not classified)",
    "prompt-injection": "prompt injection",
    "ai-agent-exploit": "AI agent exploit",
    "malicious-ai-tool": "malicious AI tool",
    "model-supply-chain": "AI model supply-chain attack",
    "ai-data-exposure": "data exposure through an AI tool",
    "ai-assisted-attack": "AI-assisted attack",
    "deepfake-fraud": "deepfake or voice-clone fraud",
    "ai-phishing": "AI-generated phishing",
    "ai-washing": "AI-washing fraud",
}
LANES = ("crypto", "ai", "both")

# ---------------------------------------------------------------- relevance

INCIDENT_RE = re.compile(
    r"\b(hack(?:s|ed|er|ers|ing)?|exploit(?:s|ed|er|ers)?|drain(?:s|ed|er|ers|ing)?|stole|"
    r"stolen|steal(?:s|ing)?|theft|thefts|heist|breach(?:es|ed)?|phish(?:ing|ed|er|ers)?|"
    r"scam(?:s|med|mer|mers)?|fraudsters?|rug[- ]?pull(?:s|ed)?|rugged|compromis(?:e|ed|es)|"
    r"malware|infostealer|drainers?|poisoning|attackers?|attacked|ransomware|siphon(?:ed|s)?|"
    r"looted|loot|ponzi|pig[- ]butcher\w*|impersonat\w+|incident analysis|post-?mortem)\b",
    re.IGNORECASE,
)
SECURITY_TOPIC_RE = re.compile(
    r"\b(vulnerabilit(?:y|ies)|security (?:incident|flaw|bug|alert|breach)|bug bounty|"
    r"post-?mortem|incident report|zero-day|cve-\d+|patch(?:ed|es)? (?:a )?(?:bug|flaw)|"
    r"private keys?|seed phrases?|recovery phrases?|wallet security|frozen funds|freez\w+)\b",
    re.IGNORECASE,
)
CRYPTO_RE = re.compile(
    # "cryptography" and "cryptographic keys" are not cryptocurrency (general security outlets write about both)
    r"\b(crypto(?!graph)\w*|bitcoin|btc|ethereum|eth|ether|solana|sol|stablecoins?|usdc|usdt|tether|"
    r"defi|blockchain|on-?chain|nfts?|web3|smart contracts?|seed phrases?|recovery phrases?|"
    r"memecoins?|airdrops?|tornado cash|monero|xmr|dex|cex|binance|coinbase|kraken|bybit|okx|"
    r"wallets?|tokens?|bridges?|validators?|staking|liquidity|lending|vaults?|dao|mixers?|"
    r"exchanges?|protocols?|layer[- ]?2|rollups?|hyperliquid|tron|bnb|polygon|arbitrum|base)\b",
    re.IGNORECASE,
)
# General security outlets write "access tokens", "Microsoft Exchange", "Apple Wallet" and "protocol": for a source
# with "cryptoContext": "strict" only unambiguous crypto words count as crypto context.
STRICT_CRYPTO_RE = re.compile(
    r"\b(crypto(?!graph)\w*|bitcoin|btc|ethereum|solana|stablecoins?|usdc|usdt|tether|defi|blockchains?|on-?chain|"
    r"nfts?|web3|smart contracts?|seed phrases?|recovery phrases?|memecoins?|airdrops?|tornado cash|monero|binance|"
    r"coinbase|kraken|bybit|okx|hyperliquid|metamask|wallet drainers?|crypto wallets?|hardware wallets?|exchange hack|"
    r"hot wallets?|cold wallets?|multi-?sig(?:nature)? wallets?|recovery seeds?|seed words|ether(?![\w-])|"
    r"cross-chain bridges?)\b"
    # case-sensitive tickers and crypto-only brands; "ETH Zurich" is a university, not ether. Bare "Ledger", "Safe",
    # "Gemini" or "Vertex" are not here: they are ordinary words or AI products on these outlets
    r"|(?-i:\bETH\b(?!\s+Z(?:u|\u00fc|ue)rich))|(?-i:\b(?:XRP|BNB)\b)"
    r"|(?-i:\b(?:Upbit|Bithumb|Coinone|Korbit|WazirX|CoinDCX|BingX|Phemex|KuCoin|Bitget|Bitfinex|Bitstamp|BitMEX|"
    r"Poloniex|Huobi|MEXC|Coincheck|bitFlyer|Trezor|Ledger (?:Live|Nano|Stax|Flex|Connect Kit|Recover)|Trust Wallet|"
    r"Atomic Wallet|Fireblocks|Stake\.com|Ronin (?:Bridge|Network)|Harmony Horizon|Horizon Bridge|Poly Network|"
    r"Orbit (?:Bridge|Chain))\b)",
    re.IGNORECASE,
)
PROMO_RE = re.compile(
    r"\b(launch(?:es|ed)?|announc(?:es|ed|ing)|partners? with|partnership|selected to|webinar|"
    r"podcast|case study|completes .{0,40}verification|strengthened its security posture|"
    r"builds an institutional|join us|hiring)\b",
    re.IGNORECASE,
)


_NEGATION = re.compile(
    r"\b(?:no|not|never|without|denie[sd]|deny|ruled out|no evidence of|no sign of|isn't|wasn't|"
    r"weren't|unaffected by)\b[^.;:]{0,40}$",
    re.IGNORECASE,
)


def _first_unnegated(pattern, text):
    for match in pattern.finditer(text):
        if not _NEGATION.search(text[max(0, match.start() - 60): match.start()]):
            return match
    return None


def source_lanes(source):
    """The lanes a source carries: "crypto" (the default), "ai" or "both"."""
    lane = source.get("lane") or "crypto"
    return {"crypto", "ai"} if lane == "both" else {lane}


def _exclusion(item, source):
    """Why a source's own rules drop an item (URL, category, title pattern, promotional or sponsored post, a press
    release without a byline), or None."""
    title = item.get("title") or ""
    url = item.get("url") or ""
    cats = [c.lower() for c in item.get("categories") or []]
    for pattern in source.get("excludeUrlPatterns", []):
        if pattern in url:
            return f"excluded: URL matches {pattern!r}"
    excluded = {c.lower() for c in source.get("excludeCategories", [])}
    if excluded & set(cats):
        return "excluded: category " + ", ".join(sorted(excluded & set(cats)))
    for pattern in source.get("excludeTitlePatterns", []):
        if re.search(pattern, title, re.IGNORECASE):
            return f"excluded: title matches {pattern!r}"
    if source.get("role") == "vendor-blog" and PROMO_RE.search(title):
        return "excluded: promotional post"
    if source.get("excludeSponsored") and item.get("sponsored"):
        return "excluded: sponsored post"
    if source.get("bylineRequired") and item.get("byline") is False:
        return "excluded: no author line (a wire press release)"
    return None


def assess(item, source):
    """Relevance in both lanes for one parsed item: {security, incident, reason, lane, aiVote}.

    A source carries the lanes its "lane" names (crypto when absent). An item is kept when a lane its source carries
    accepts it; its own lane is "both" when it passes both rules, whatever the source carries."""
    why = _exclusion(item, source)
    if why:
        return {"security": False, "incident": False, "reason": why, "lane": None, "aiVote": None}
    if item.get("kind") == "structured":
        return {"security": True, "incident": True, "reason": "incident database record", "lane": "crypto", "aiVote": None}
    lanes = source_lanes(source)
    # a sexual-abuse or intimate-image story is held for the owner whatever lane would take it: "Hackers steal nude
    # photos from Replika users, demand Bitcoin ransom" is never a crypto candidate either (never dropped unseen: the
    # owner gets a count, the reason and a type, never the item's words)
    hold = sensitive_hold_any(item)
    if hold:
        return {"security": False, "incident": False, "reason": SENSITIVE_REASON, "lane": None, "aiVote": None,
                "hold": hold}
    crypto = _crypto_relevance(item, source)
    ai = ai_relevance(item)
    crypto_ok, ai_ok = crypto[0], ai[0]
    if not ((crypto_ok and "crypto" in lanes) or (ai_ok and "ai" in lanes)):
        reasons = ([crypto[2]] if "crypto" in lanes else []) + ([ai[2]] if "ai" in lanes else [])
        found = {"security": False, "incident": False, "reason": "; ".join(reasons), "lane": None, "aiVote": None}
        if "ai" in lanes and ai[2] == SENSITIVE_REASON:
            found["hold"] = sensitive_hold(f"{item.get('title') or ''}. {item.get('excerpt') or ''}")
        return found
    lane = "both" if crypto_ok and ai_ok else "crypto" if crypto_ok else "ai"
    incident = bool((crypto_ok and crypto[1]) or (ai_ok and ai[1]))
    reason = "; ".join(r for ok, r in ((crypto_ok, crypto[2]), (ai_ok, ai[2])) if ok)
    return {"security": True, "incident": incident, "reason": reason, "lane": lane, "aiVote": ai[3] if ai_ok else None}


def relevance(item, source):
    """(security: bool, incident: bool, reason: str) for one parsed item, in every lane its source carries."""
    found = assess(item, source)
    return found["security"], found["incident"], found["reason"]


def _crypto_relevance(item, source):
    """The crypto lane: crypto context and an incident term or a security topic. (security, incident, reason)."""
    title = item.get("title") or ""
    excerpt = item.get("excerpt") or ""
    url = item.get("url") or ""
    cats = [c.lower() for c in item.get("categories") or []]
    text = f"{title}. {excerpt}"
    incident = _first_unnegated(INCIDENT_RE, text)
    topic = _first_unnegated(SECURITY_TOPIC_RE, text)
    forced = any(p in url for p in source.get("securityUrlPatterns", []))
    path = urllib.parse.urlsplit(url).path  # not the host: every crypto.news URL says "crypto"
    context = f"{text} {' '.join(cats)} {re.sub(r'[^A-Za-z0-9]+', ' ', path)}"
    # strict on general security outlets and on AI-only sources ("access tokens" there are not crypto)
    strict = source.get("cryptoContext") == "strict" or (source.get("lane") or "crypto") != "crypto"
    words = STRICT_CRYPTO_RE if strict else CRYPTO_RE
    crypto = words.search(context) or re.search(r"\b0x[0-9a-fA-F]{40}\b", text)
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


# ---------------------------------------------------------------- AI lane
#
# An AI-security item needs AI context (an LLM, a chatbot, an AI agent or coding agent, an MCP server, model weights,
# a deepfake or cloned voice, a named AI product) AND an AI-security incident or topic (one of the AI type rules
# below). Negated mentions, vendor marketing, launches, deals, funding, events and opinion never count.

# AI products and AI-native companies, longest first: AI context, and the subjects of AI incidents. Bare "Gemini" is
# also a crypto exchange: it is a subject in the AI lane only, never AI context on its own.
AI_PRODUCTS = (
    "Claude Code", "Claude Desktop", "Claude for Chrome", "Claude Opus", "Claude Sonnet", "Claude Haiku",
    "GitHub Copilot", "Microsoft 365 Copilot", "M365 Copilot", "Microsoft Copilot", "Copilot Studio",
    "Security Copilot", "Visual Studio Copilot", "Copilot Chat", "Gemini CLI", "Gemini Code Assist", "Google Gemini",
    "Google Jules", "Google Antigravity", "Amazon Q Developer", "Amazon Q", "AWS Kiro", "Amazon Bedrock",
    "Azure OpenAI", "Vertex AI", "OpenAI Codex", "Codex CLI", "ChatGPT Atlas", "ChatGPT Operator", "Perplexity Comet",
    "Hugging Face", "Mistral AI", "Meta AI", "Character.AI", "Stable Diffusion", "Fireworks AI", "Together AI",
    "Google DeepMind", "Roo Code", "ChatGPT", "Claude", "Copilot", "Gemini", "Codex", "Cursor", "Windsurf", "Cline",
    "OpenRouter", "LiteLLM", "LangChain", "LangGraph", "LlamaIndex", "Ollama", "DeepSeek", "Qwen", "Grok", "Llama",
    "Kiro", "Antigravity", "OpenClaw", "Clawdbot", "Moltbot", "Midjourney", "ElevenLabs", "Sora", "Replit",
    "Lovable", "Perplexity", "DeepMind", "Anthropic", "OpenAI", "xAI",
    # qualified names only: a bare "Ray", "Devin", "Bard", "Manus" or "Amp" can be a person
    "Amp Code", "Devin AI", "Google Bard", "Bing Chat", "NotebookLM", "Langflow", "OpenHands", "Manus AI", "OmniGPT",
    "Anyscale Ray",
)
AI_PRODUCTS = tuple(sorted(AI_PRODUCTS, key=len, reverse=True))
_AI_CONTEXT_ONLY_IN_LANE = {"Gemini"}
# a vendor named next to one of its own products is not the subject: the product is
_VENDOR_PRODUCTS = {
    "Anthropic": ("Claude",), "OpenAI": ("ChatGPT", "Codex", "Sora"), "Google DeepMind": ("Gemini",),
    "DeepMind": ("Gemini",), "xAI": ("Grok",), "Perplexity": ("Comet",), "Meta AI": ("Llama",),
}
_PRODUCT_ALT = "|".join(re.escape(p) for p in AI_PRODUCTS if p not in _AI_CONTEXT_ONLY_IN_LANE)
_PRODUCTS_RE = re.compile(r"(?<![\w.-])(?:" + "|".join(re.escape(p) for p in AI_PRODUCTS) + r")(?![\w-])")
# AI words, for the anchors inside the type rules (case-sensitive "AI"; the rest in any case)
_AI_X = (
    r"(?:(?-i:\bAI\b|\bA\.I\.)|\bartificial intelligence\b|\bLLMs?\b|\blarge language models?\b|\bgenerative AI\b|"
    r"\bgen ?AI\b|\bchat ?bots?\b|\bagentic\b|\b(?:AI|coding|autonomous|computer[- ]use) agents?\b|\bMCP\b|"
    r"\bmodel context protocol\b|(?-i:(?<![\w.-])(?:" + _PRODUCT_ALT + r")(?![\w-])))"
)
AI_CONTEXT_RE = re.compile(
    _AI_X + r"|\bdeep[- ]?fakes?\b|\bvoice[- ]?clon\w*|\bclon(?:e|es|ed|ing) (?:\w+ )?voices?\b|\bface[- ]?swap\w*|"
    r"\bsynthetic (?:voices?|videos?|media|identit\w+)\b|\bprompt[- ]injection\w*|\bpromptware\b|\bmodel weights\b|"
    r"\bopen[- ]weights?\b|\bneural networks?\b|\bmachine learning\b",
    re.IGNORECASE,
)
# what an AI agent exploit targets: an AI agent, assistant, tool, MCP server or named product (bare "Gemini" counts
# here, because these rules only run once an item has AI context)
_AGENTISH = (
    r"(?:\b(?:AI|coding|autonomous|computer[- ]use) agents?\b|\bAI coding (?:tools?|assistants?)\b|"
    r"\bAI (?:assistants?|IDEs?|browsers?|tools?|apps?|"
    r"platforms?|gateways?|models?|systems?|services?|features?|chatbots?)\b|\bagentic (?:\w+ )?(?:tools?|systems?|"
    r"browsers?|AI)\b|\bMCP(?: servers?)?\b|\bchat ?bots?\b|\bLLMs?\b|(?-i:(?<![\w.-])(?:"
    + "|".join(re.escape(p) for p in AI_PRODUCTS) + r")(?![\w-])))"
)
_VULN = (
    r"(?:vulnerab\w+|flaws?|bugs?|CVE-\d{4}-\d{3,7}|RCE|remote code execution|(?:arbitrary )?code execution|"
    r"command injection|sandbox (?:escapes?|bypass\w*)|privilege escalation|auth(?:entication|orization)? bypass\w*|"
    r"zero[- ]click|zero[- ]day|exploit\w*|hijack\w*|hack(?:s|ed|ing)?|takeovers?|compromis\w+|exfiltrat\w+|"
    r"insecure|unauthenticated|missing (?:security )?(?:controls|checks|authentication)|bypass\w*|"
    r"(?:path|directory) traversal|(?:accessible )?without authenticat\w+)"
)
_TOOL_NOUN = (
    r"(?:apps?|extensions?|plugins?|add-ons?|skills?|servers?|tools?|packages?|libraries|browsers?|installers?|"
    r"clients?|wrappers?|sites?|websites?|repos?|repositories|bots?|integrations?|versions?|downloads?|ads?|IDEs?)"
)
_MALWARE = r"(?:malware|infostealers?|stealers?|trojans?|backdoors?|RATs?|ransomware|spyware)"
_DATA = (
    r"(?:secrets?|prompts?|credentials?|api keys?|access keys?|tokens?|passwords?|chats?|chat (?:histor\w+|logs?)|"
    r"conversations?|data|information|PII|records|files|source code|repositor\w+|memor(?:y|ies)|emails?|calendars?)"
)

# the words between an AI agent or product and a flaw word: never a capability, attempt or use ("X is able to exploit",
# "X can now exploit", "X attempted exploits", "attackers used X to hack"): there the agent is the attacker, not the
# target of the flaw
_ACTOR_GAP = (r"(?!(?:can|could|will|would|may|might|able|capable|attempt\w*|tri(?:ed|es)|try(?:ing)?|manag\w+|"
              r"learn\w*|now|to|used|uses|using)\b)")
# the words between a claim and the AI word it is about: never "by", "through", "from", "via", "in", "using" or
# "with", which make the AI the speaker of the falsehood ("false claims through Grok"), not its subject
_WASH_GAP = r"(?:(?!\b(?:by|through|from|via|in|using|with)\b)[^.;]){0,40}?"
_AI_MALWARE_TARGETS = (
    r"(?:AI coding (?:tools?|assistants?|agents?)|coding agents?|AI (?:tools?|assistants?|IDEs?|agents?)|"
    r"MCP servers?|(?-i:(?<![\w.-])(?:" + _PRODUCT_ALT + r")(?![\w-])))"
)

# (type, explainer topic, pattern, needs an AI word within 160 characters of the match), in matching order: the
# most specific mechanism first (a prompt injection that leaks secrets is a prompt injection)
_AI_TYPE_RULES = (
    ("deepfake-fraud", "ai-scams",
     r"\bdeep[- ]?fake\w*|\bvoice[- ]?clon\w+|\bclon(?:ed|ing|es?)\s+(?:\w+\s+){0,2}voices?\b|\bvoice clones?\b|"
     r"\bface[- ]?swap\w*|\bsynthetic (?:voices?|videos?|identit\w+)\b|"
     r"\bAI[- ](?:generated|made|created)\s+(?:\w+\s+){0,2}?(?:videos?|voices?|images?|photos?|likeness\w*|personas?|"
     r"profiles?|celebrit\w+|endorsements?|ads?)\b|"
     r"(?-i:\b(?:AI|A\.I\.))[- ]?(?:(?:powered|driven|generated|enabled)\s)?(?:romance |investment |crypto |"
     r"impersonation |voice )?(?:scams?|fraud\w*|swindles?)\b(?!\s+(?:detection|prevention|protection|tools?|"
     r"platforms?|teams?|filters?|models?|systems?|solutions?|checks?|scores?|controls?|defen[cs]es?))", False),
    ("ai-washing", None,
     r"\bAI[- ]washing\b|\bOperation AI Comply\b|"
     r"\b(?:false(?:ly)?|misleading(?:ly)?|deceptive(?:ly)?|bogus|inflated|exaggerat\w+|overstat\w+|unsubstantiated)"
     r"\b[^.;]{0,40}?\b(?:(?:claim\w*|statements?|representations?|said|says)\s+(?:about|regarding|concerning|over|"
     r"on|of|involving|that|to|its|their)\b|(?:marketing|marketed|advertis\w+|promis\w+|touted)\b)"
     + _WASH_GAP + _AI_X + r"|\bmisle\w*\b[^.;]{0,40}?\babout\b" + _WASH_GAP + _AI_X, False),
    # the AI must PRODUCE the lure: phishing that impersonates an AI brand or targets AI users is not AI-generated
    # phishing ("Phishing campaign impersonates OpenAI", "device code phishing ... AI coding agents")
    ("ai-phishing", "ai-scams",
     r"\b(?:AI|LLM|GenAI)[- ](?:generated|written|crafted|powered|personali[sz]ed|assisted|enhanced|driven)\s+"
     r"(?:\w+\s+){0,2}?(?:phish\w*|emails?|messages?|lures?|texts?|spam|smish\w*|vish\w*)\b|"
     + _AI_X + r"[^.;]{0,80}?\b(?:to|that|which|can|could)\s+(?:\w+\s+){0,2}?(?:write|wrote|written|writes|"
     r"generat\w+|craft\w*|creat\w+|compos\w+|draft\w*|personali[sz]\w+|tailor\w*|polish\w*|translat\w+)\b"
     r"[^.;]{0,40}?\b(?:phish\w*|lures?|scam emails?|smish\w*)\b|"
     r"\bphish\w*\s+(?:kits?|campaigns?|operations?|services?|platforms?|tools?)\b[^.;]{0,40}?\b(?:uses?|using|"
     r"powered by|built on|driven by|puts?|leverag\w+|relies on|with)\s+(?:[\w-]+\s+){0,3}?" + _AI_X, False),
    ("prompt-injection", "ai-security",
     r"\bprompt[- ]injection\w*|\bpromptware\b|\b(?:indirect|invisible|hidden|cross[- ]agent|zero[- ]click)\s+"
     r"(?:prompts?|instructions?)\b|\binjected (?:prompts?|instructions?)\b|\bhidden (?:unicode |text )?"
     r"instructions?\b|\bmalicious (?:prompts?|instructions?)\b", False),
    ("prompt-injection", "ai-security", r"\bjailbr(?:eak|oke|eaking|eaks|oken)\w*", True),
    ("malicious-ai-tool", "ai-security",
     r"\b(?:malicious|fake|rogue|trojani[sz]ed|backdoored|counterfeit|look-?alike|impostor|imposter|typosquatt\w*|"
     r"weaponi[sz]ed|bogus|copycat|spoofed)\s+(?:[\w.-]+\s+){0,3}?" + _AI_X + r"\s+(?:[\w.-]+\s+){0,2}?"
     + _TOOL_NOUN + r"\b|" + _AI_X + r"\s+(?:[\w.-]+\s+){0,2}?" + _TOOL_NOUN
     + r"\b[^.;]{0,40}?\b(?:laced with|bundl\w+|deliver\w*|drop\w*|install\w*|carr\w+|hid\w*|spread\w*|push\w*|"
     r"serv(?:e|es|ed|ing))\s+(?:\w+\s+){0,2}?" + _MALWARE + r"\b|\b" + _MALWARE
     + r"\b[^.;]{0,40}?\b(?:posing as|disguised as|masquerad\w+ as|impersonat\w+)\s+(?:\w+\s+){0,2}?" + _AI_X
     + r"|\b(?:malware|campaigns?|worms?|stealers?|infostealers?|trojans?|botnets?)\b[^.;]{0,40}?\btarget\w*\s+"
     r"(?:[\w-]+\s+){0,2}?" + _AI_MALWARE_TARGETS, False),
    ("model-supply-chain", "ai-security",
     r"\b(?:poison\w*|backdoor\w*|trojan\w*|tamper\w*|booby[- ]trapped|sleeper[- ]agents?|hidden payloads?)\b"
     r"[^.;]{0,50}?\b(?:models?|weights|checkpoints?|datasets?|training data|fine[- ]tun\w+|post[- ]training|"
     r"open[- ]weights?|model hubs?|safetensors|pickles?|neurons?)\b|"
     r"\b(?:models?|weights|checkpoints?|datasets?|training data|open[- ]weights?)\b[^.;]{0,50}?\b(?:poison\w*|"
     r"backdoor\w*|payloads?|malware|sleeper[- ]agents?|tamper\w*)\b|\bslopsquat\w*|"
     r"\b(?:malicious|rogue|trojani[sz]ed|backdoored|weaponi[sz]ed)\s+(?:[\w-]+\s+){0,2}?(?:models?|checkpoints?)\b|"
     r"\bsupply[- ]chain (?:attacks?|compromises?|poisoning)\b[^.;]{0,60}?" + _AI_X + r"|"
     + _AI_X + r"[^.;]{0,40}?\bsupply[- ]chain (?:attacks?|compromises?|poisoning)\b", True),
    ("ai-assisted-attack", None,
     r"(?:(?-i:\b(?:AI|A\.I\.))|\bLLM)[- ]?(?:(?:assisted|driven|powered|enabled|orchestrated|fu[e]?led|generated|"
     r"written|based|led|automated)[- ])?(?:[\w-]+\s){0,2}?(?:attacks?|cyber[- ]?attacks?|campaigns?|intrusions?|"
     r"breach\w*|hacking|hacks?|espionage|exploitation|malware|ransomware)\b|"
     r"\b(?:attackers?|hackers?|threat actors?|actors?|criminals?|cybercriminals?|crooks|gangs?|groups?|APTs?|"
     r"operators?|adversar(?:y|ies)|scammers?|fraudsters?|spies)\b[^.;]{0,60}?\b(?:use[sd]?|using|leverag\w+|"
     r"deploy\w*|harness\w*|turn(?:ed|s|ing)? to|abus\w+|weaponi[sz]\w+|rel(?:y|ied|ies) on|tapp\w+|enlist\w*|"
     r"employ\w*|misus\w+|with)\b[^.;]{0,40}?" + _AI_X + r"|"
     r"\b(?:AI|autonomous|agentic)\s+agents?\b(?:\s+[\w'’-]+){0,8}?\s+(?:root access|lateral movement|"
     r"privilege escalation|breach\w*|intrusions?|hack(?:ed|ing|s)?|compromis\w+|exfiltrat\w+|ransomware|attacks?)\b|"
     r"\b(?:AI|autonomous|agentic)\s+(?:agents?|models?)\b\s+(?:attempt\w*|tri(?:ed|es) to|launch\w*|carri\w+ out|"
     r"conduct\w*|perform\w*)\s+(?:\w+\s+){0,2}?(?:exploit\w*|hack\w*|attacks?|intrusions?)\b|"
     r"\bautonomous (?:AI )?(?:attacks?|intrusions?|hacking|breach\w*|cyber[- ]?attacks?)\b|"
     r"(?-i:\b(?:AI|LLM))\b[^.;]{0,40}?\b(?:tools?|agents?|models?|frameworks?|pen[- ]?test\w*)\b[^.;]{0,40}?"
     r"\b(?:weaponi[sz]\w+|turned into (?:a |an )?weapons?|abused by|misused by)\b", False),
    ("ai-agent-exploit", "ai-security",
     _AGENTISH + r"(?:['’]s)?[\s(:,!-]+(?:" + _ACTOR_GAP + r"[\w.!:,'’-]+\s+){0,4}?\(?" + _VULN + r"|\b" + _VULN
     + r"\b\s+(?:\w+\s+){0,1}?(?:in|affecting|impacting|of|against|targeting|on|via)\s+(?:the\s+|an?\s+)?"
     r"(?:[\w.'’-]+\s+){0,3}?" + _AGENTISH + r"|\b" + _VULN + r"\s+(?:[\w'’-]+\s+){0,4}?" + _AGENTISH, False),
    ("ai-data-exposure", "ai-security",
     r"\b(?:leak\w*|expos\w+|spill\w*|exfiltrat\w+|stole|stolen|steal\w*|dump\w*|cop(?:y|ies|ied|ying))\b[^.;]{0,40}?"
     r"\b" + _DATA + r"\b|"
     r"\b" + _DATA + r"\b[^.;]{0,40}?\b(?:leak\w*|expos\w+|spill\w*|exfiltrat\w+|stolen|stole)\b|"
     r"\b" + _DATA + r"\b[^.;]{0,60}?\b(?:without (?:\w+\s+)?(?:authori[sz]ation|consent|permission|approval)|"
     r"improperly|unauthori[sz]ed)\b|\bdata (?:leaks?|breach\w*|exposures?)\b", True),
)
_AI_TYPE_RULES = tuple((t, e, re.compile(p, re.IGNORECASE), near) for t, e, p, near in _AI_TYPE_RULES)
_AI_ANCHOR_RE = re.compile(_AI_X + r"|\bdeep[- ]?fakes?\b|\bvoice[- ]?clon\w*|\bmachine learning\b|(?-i:\bML\b)",
                           re.IGNORECASE)
# what makes an AI-security item an incident report rather than a topic (research, trends, risks)
_AI_EVENT_RE = re.compile(
    r"\b(?:hack(?:ed|s|ing)?|breach(?:ed|es)?|attack(?:ed|s)?|cyber[- ]?attacks?|exploit(?:ed|s|ing|ation)?|"
    r"compromis(?:e|ed|es|ing)|leak(?:ed|s|ing)?|expos(?:ed|es|ing|ure)|spill\w*|stole|stolen|steal\w*|theft|"
    r"scam(?:s|med)?|fraud\w*|defraud\w*|indict\w*|charg(?:ed|es)|sued|sues|lawsuit|fined|settle(?:d|s|ment)|"
    r"arrest\w*|malicious|hijack\w*|poisoned|backdoor(?:ed|s)?|abus(?:ed|ing)|misus(?:ed|ing)|impersonat\w+|"
    r"exfiltrat\w+|vulnerab\w+|flaws?|cve-\d{4}-\d+|rce|patch(?:ed|es)|campaigns?|intrusions?|penetrated|"
    r"drop(?:s|ped)|removed|pulled|disclos(?:es|ed)|attempt\w* to (?:access|hack|exploit|steal|breach)|"
    # a disclosed flaw named by what it lets an attacker do ("Directory Access Bypass", "Accessible Without
    # Authentication", "path traversal")
    r"bypass(?:ed|es|ing)?|(?:path|directory) traversal|accessible without authenticat\w+)\b",
    re.IGNORECASE,
)
# vendor marketing and other noise: never an AI-security item (titles), and excerpt cues of a video, event or ad
_AI_NOISE_TITLE = re.compile(
    r"\b(?:launch(?:es|ed|ing)?|unveil(?:s|ed|ing)?|debut(?:s|ed|ing)?|introduc(?:es|ed|ing)|roll(?:s|ed)? out|"
    r"rolling out|expands?|expanded|now available|generally available|general availability)\b(?:\s+[\w.'’&,-]+){0,5}?"
    r"\s+(?:tools?|platforms?|products?|features?|services?|solutions?|programs?|initiatives?|frameworks?|suites?|"
    r"safeguards?|protections?|capabilit\w+|offerings?|models?|agents?|apps?|integrations?|standards?|beta)\b|"
    r"^new\s+\S+\s+(?:tool|platform|feature|service|framework)\b|"
    r"\b(?:partners? with|partnership|acquir(?:es|ed|ing)|acquisition|to acquire|to buy|merger|deal|"
    r"rais(?:es|ed|ing) \$|funding|series [a-e]\b|seed round|valuation|earnings|quarterly results|"
    r"webinar|virtual (?:event|summit)|podcast|video series|livestream|magic quadrant|named a leader|"
    r"recognized as a leader|award|appoints?|appointed|weigh in|op-ed|opinion|commentary|"
    r"(?:in|for) the (?:age|era) of ai|ai era|era of ai|age of ai|powered by microsoft)\b",
    re.IGNORECASE,
)
_AI_NOISE_TEXT = re.compile(
    r"\b(?:in this video|this installment|video series|webinar|sponsored (?:by|content|post|article)|paid post|"
    r"register (?:now|today|here)|(?:era|age) of ai(?:-driven)?)\b",
    re.IGNORECASE,
)


# Research output, talks, explainers, guides and trend pieces: an AI-security TOPIC, never an incident report on their
# own ("... Paper", "(39C3 Video + Slides)", "What Defenders Need to Know", "Protect Your Copilots", "Lessons from")
_AI_TOPIC_TITLE = re.compile(
    r"\b(?:(?:white ?)?papers?|talks?|keynote|slides|tutorial|trip report|wrap[- ]?up|explain(?:s|ed|er|ers)?|"
    r"protect(?:ing)? your|prevent(?:ing)?|how to (?:protect|prevent|defend|detect|catch|stop)|lessons (?:from|learned)|"
    r"trends?|tactics|predictions?|outlook|peak season|learn about|"
    r"what (?:defenders|you|teams|security teams|cisos) (?:need|should) (?:to )?know)\b|^video\b|\(video\b|\bvideo\s*\+",
    re.IGNORECASE,
)
# ...unless its text states real-world harm (exploitation in the wild, victims, users or data actually affected, a
# vendor fix or a CVE)
_AI_REAL_HARM_RE = re.compile(
    r"\b(?:cve-\d{4}-\d+|vulnerable to|(?:was|were|been|now|quickly) (?:fixed|patched)|in the wild|actively exploited|"
    r"active exploitation|used in (?:real )?attacks|victims?|"
    r"(?:attackers?|hackers?|threat actors?|criminals?|scammers?)\b[^.;]{0,40}?\b(?:used|exploited|abused|breached|"
    r"compromised|stole|hijacked|targeted)|(?:was|were|been) (?:breached|hacked|compromised|stolen|exposed|leaked)|"
    r"\d[\d,.]*\s*(?:million|thousand|k)?\s+(?:users?|customers?|people|victims?|organi[sz]ations|companies|accounts|"
    r"records))\b",
    re.IGNORECASE,
)
# Child sexual abuse and non-consensual intimate imagery made with AI: not a security story for this channel, and never
# "deepfake fraud" with a scam fix. Kept out of the AI lane for the owner to judge.
_AI_SENSITIVE = re.compile(
    r"\b(?:CSAM|child (?:sexual )?(?:abuse|exploitation)|sexual(?:ly)? (?:abus\w*|explicit|exploit\w*)|sexuali[sz]ed|"
    r"nudes?|nudify\w*|undress\w*|naked|porn\w*|non-?consensual|sextortion|"
    r"(?:explicit|intimate)\b[^.;]{0,24}?\b(?:images?|imagery|photos?|pictures?|videos?|content|deepfakes?))\b",
    re.IGNORECASE,
)
SENSITIVE_REASON = "AI lane: sexual-abuse or intimate-image story (owner decision)"
# ...a completed breach of an AI app that took its users' private images is still a data exposure: held for the owner
# with that type, never dropped unseen ("Hackers steal nude photos from AI companion app users")
_SENSITIVE_BREACH = re.compile(
    r"\b(?:steal\w*|stole|stolen|expos(?:e|ed|es|ing)|leak\w*|breach\w*|hack(?:ed|ers?)|dump(?:ed|s)?|exfiltrat\w+|"
    r"scraped)\b[^.;]{0,80}?\b(?:users?|customers?|subscribers?|members?|accounts?|database)\b|"
    r"\b(?:users?|customers?|subscribers?|members?|accounts?)['’]?\s+(?:[\w-]+\s+){0,3}?(?:photos?|images?|pictures?|"
    r"videos?|chats?|data)\b[^.;]{0,40}?\b(?:stolen|exposed|leaked|dumped)\b",
    re.IGNORECASE,
)
# ...unless it involves children, or someone made the images (a creation case is the owner's call, with no type). Making
# is read as a verb with what was made after it ("generated nude images", "made deepfakes of ..."), never an app's name
# ("AI Image Generator App Leaked Users' Private Photos In Breach" is a breach)
_SENSITIVE_NOT_BREACH = re.compile(
    r"\b(?:CSAM|child\w*|minors?|kids?|underage|classmates?|students?|pupils?|teen\w*|schools?)\b|"
    r"\b(?:creat(?:e|es|ed|ing)|generat(?:e|es|ed|ing)|made|mak(?:e|es|ing)|produc(?:e|es|ed|ing)|us(?:e|ed|ing) AI to "
    r"(?:create|make|generate))\s+(?:[\w-]+\s+){0,3}?(?:images?|imagery|nudes?|deepfakes?|photos?|pictures?|videos?|"
    r"content|porn\w*)\b|\bAI[- ](?:generated|made|created)\s+(?:[\w-]+\s+){0,2}?(?:images?|nudes?|deepfakes?|photos?|"
    r"pictures?|videos?|content|porn\w*)\b",
    re.IGNORECASE,
)


def sensitive_hold_any(item):
    """The owner hold for an item in any lane: a sexual-abuse or intimate-image story with AI context, or one whose
    sensitive words are more than "sextortion" (a crypto sextortion e-mail scam without AI stays an ordinary crypto
    item, as before the AI lane)."""
    text = f"{item.get('title') or ''}. {item.get('excerpt') or ''}"
    words = {m.group(0).lower() for m in _AI_SENSITIVE.finditer(text)}
    if not words:
        return None
    if words <= {"sextortion"} and not _first_unnegated(AI_CONTEXT_RE, text):
        return None
    return sensitive_hold(text)


def sensitive_hold(text):
    """For a story the AI lane holds back for the owner (sexual-abuse or intimate imagery): {reason, suggestedType}, or
    None. Only the reason and a type leave the radar, never the story's words."""
    if not _AI_SENSITIVE.search(text or ""):
        return None
    breach = bool(_SENSITIVE_BREACH.search(text)) and not _SENSITIVE_NOT_BREACH.search(text)
    if breach:
        return {"reason": "a completed breach of an AI app that took or exposed users' private images: an AI data "
                          "exposure, held back for the owner because of its subject (never a Short or a Threat Brief "
                          "item without the owner)",
                "suggestedType": "ai-data-exposure"}
    return {"reason": "a sexual-abuse or intimate-image story made with AI: the owner decides whether the channel covers "
                      "it", "suggestedType": None}


# a deepfake or AI-generated image is fraud only when the sentence says someone was defrauded or deceived for gain
_FRAUD_CUE = re.compile(
    r"\b(?:scam\w*|fraud\w*|defraud\w*|impersonat\w+|swindl\w*|extort\w*|stole|steal\w*|stolen|theft|transfer\w*|"
    r"wir(?:e|ed|ing)|paid|pay(?:s|ing|ment|ments)?|invest\w*|romance|CEO|CFO|executives?|money|funds?|savings|"
    r"ransom|trick\w*|dup(?:e|ed|es)|con(?:ned|ning)|cheat\w*|lur(?:e|ed|es|ing)|bilk\w*|endorse\w*|crypto\w*|"
    r"giveaways?|loans?|bank\w*|wallets?)\b",
    re.IGNORECASE,
)
# an attempt or a capability, not an exposure: "Grok Bots Attempt to Access Corporate Data", "agent could read files"
_ATTEMPT = re.compile(r"\b(?:attempt(?:s|ed|ing)?|tr(?:y|ies|ied|ying)|able|could|can)\b(?:\s+to)?\s+(?:\w+\s+){0,4}$",
                      re.IGNORECASE)
# "AI agent hacked", "AI agents were compromised by ...": the agent is the victim (an agent exploit), not the attacker
_AGENT_VICTIM = re.compile(
    r"\b(?:AI|autonomous|agentic)\s+agents?\s+(?:(?:was|were|is|are|got|been|being|gets)\s+)?"
    r"(?:hacked|compromised|hijacked|breached|exploited)\b(?=\s*(?:[,.;:!?)]|$|by\b|and\b|after\b|via\b|through\b|"
    r"in\b|to\s+(?:leak|expose|steal|exfiltrate)))",
    re.IGNORECASE,
)
# an attacker, a campaign or a piece of malware that "launches" or "expands" is an incident, not a product launch
_ATTACKER_LAUNCH = re.compile(
    r"\b(?:hackers?|attackers?|threat actors?|scammers?|(?:cyber)?criminals?|gangs?|APTs?|malware|campaigns?|botnets?|"
    r"worms?|ransomware|operators?|stealers?|infostealers?)\b(?:\s+[\w-]+){0,2}?\s+(?:launch(?:es|ed|ing)?|"
    r"expand(?:s|ed|ing)?|roll(?:s|ed)? out|unveil\w*|debut\w*)\b",
    re.IGNORECASE,
)
# phishing where an AI brand is only the lure (impersonated) or the target ("impersonates OpenAI", "GitHub Copilot
# users", "fake ChatGPT login pages"): not AI security, whatever other words the item has
_PHISH_CUE = re.compile(r"\bphish\w*|\bsmish\w*|\bvish\w*", re.IGNORECASE)
_AI_AS_LURE = re.compile(
    r"\b(?:impersonat\w+|mimic\w*|spoof\w*|pos(?:e|es|ing) as|pretend\w* to (?:be|come from)|look-?alike|copycat|fake)"
    r"\s+(?:[\w.-]+\s+){0,2}?" + _AI_X + r"(?:\s+[\w.-]+){0,3}|"
    + _AI_X + r"\s+(?:[\w-]+\s+)?(?:users?|customers?|developers?|accounts?|subscribers?|log-?ins?|sign-?ins?|"
    r"login pages?|sign-?in pages?|billing\w*|subscriptions?)\b|\btarget\w*\s+(?:[\w.-]+\s+){0,2}?" + _AI_X,
    re.IGNORECASE,
)


def _ai_only_as_lure(text):
    """Every AI word of a phishing text sits inside an impersonation or targeting phrase."""
    if not _PHISH_CUE.search(text):
        return False
    lures = [m.span() for m in _AI_AS_LURE.finditer(text)]
    anchors = [m.span() for m in _AI_ANCHOR_RE.finditer(text)]
    return bool(anchors) and all(any(s <= a0 and a1 <= e for s, e in lures) for a0, a1 in anchors)


_SENTENCE_BREAK = re.compile(r"(?<=[.!?])\s+(?=[A-Z0-9\"“‘'(\[])")


def _near_ai(text, match):
    """An AI word in the same sentence as the match ("Stolen secrets. AI claims ..." is two sentences; the dots in
    "settings.local.json" end none)."""
    start = 0
    for brk in _SENTENCE_BREAK.finditer(text):
        if brk.start() >= match.start():
            end = brk.start()
            break
        start = brk.end()
    else:
        end = len(text)
    return bool(_AI_ANCHOR_RE.search(text[start:max(end, match.end())]))


def _sentence_of(text, match):
    start = 0
    end = len(text)
    for brk in _SENTENCE_BREAK.finditer(text):
        if brk.start() >= match.end():
            end = brk.start()
            break
        if brk.end() <= match.start():
            start = brk.end()
    return text[start:end]


# "<AI product, agent or tool> (is) vulnerable to <mechanism>" is a research finding about that product, not advice
_AI_VULNERABLE_FINDING = re.compile(
    _AGENTISH + r"(?:['’]s)?[\s:,()-]+(?:[\w.'’()-]+\s+){0,5}?(?:(?:is|are|was|were|remains?|found|left)\s+)?"
    r"(?:\w+\s+)?vulnerable to\s+(?:\w+\s+){0,2}$",
    re.IGNORECASE,
)
# an official warning about a live campaign or attack (an actor, a victim or real-world use) reports an incident
_AI_LIVE_WARNING = re.compile(
    r"\b(?:in the wild|(?:actively )?exploited|in (?:real[- ]world )?attacks|targeting|targeted|impersonat\w+|"
    r"posing as|stealing|stole|stolen|hijack\w*|victims?|defraud\w*|(?:used|deployed|run) by)\b",
    re.IGNORECASE,
)


def _ai_advice(text, match):
    """Advice or a general warning right before an AI rule's match ("watch out for deepfake calls"), except a
    product's stated flaw ("Google Jules is vulnerable to invisible prompt injection") and an official warning about
    a live campaign ("FBI warns of AI voice-cloning campaign impersonating senior officials")."""
    advice = _ADVICE.search(text[max(0, match.start() - 50): match.start()])
    if not advice:
        return False
    phrase = advice.group(0).lower()
    if phrase.startswith("vulnerable to") and _AI_VULNERABLE_FINDING.search(text[max(0, match.start() - 120): match.start()]):
        return False
    if phrase.startswith(("warn", "alert")) and _first_unnegated(_AI_LIVE_WARNING, text):
        return False
    return True


def ai_type_from_text(text):
    """(type, topic, reason) of the first AI type rule with an unnegated match that is not advice, or None. A deepfake
    is fraud only with a fraud cue in its sentence; an attempt or a capability is never a data exposure; an AI agent
    that was hacked is the victim (an agent exploit), not the attacker."""
    text = text or ""
    for kind, topic, pattern, near in _AI_TYPE_RULES:
        for match in pattern.finditer(text):
            if _NEGATION.search(text[max(0, match.start() - 60): match.start()]):
                continue
            if _ai_advice(text, match):
                continue
            if near and not _near_ai(text, match):
                continue
            if kind == "deepfake-fraud" and not _FRAUD_CUE.search(_sentence_of(text, match)):
                continue
            if kind == "ai-data-exposure" and _ATTEMPT.search(text[max(0, match.start() - 60): match.start()]):
                continue
            if kind == "ai-assisted-attack" and _AGENT_VICTIM.match(text, match.start()):
                continue
            return (kind, topic, f"AI text {clean_ws(match.group(0))[:80]!r}")
    return None


def ai_relevance(item):
    """The AI lane: (security, incident, reason, type vote). Needs AI context and an AI-security incident or topic;
    vendor marketing, launches, deals, funding, events and opinion never count."""
    title = item.get("title") or ""
    excerpt = item.get("excerpt") or ""
    if (_AI_NOISE_TITLE.search(title) and not _ATTACKER_LAUNCH.search(title)) or _AI_NOISE_TEXT.search(excerpt):
        return False, False, "AI lane: marketing, a launch, a deal, funding, an event or opinion", None
    text = f"{title}. {excerpt}"
    cats = " ".join(item.get("categories") or [])
    context = _first_unnegated(AI_CONTEXT_RE, text) or (AI_CONTEXT_RE.search(cats) if cats else None)
    if not context:
        return False, False, "no AI context", None
    if _AI_SENSITIVE.search(text):
        return False, False, SENSITIVE_REASON, None
    if _ai_only_as_lure(text):
        return False, False, "phishing that only impersonates or targets an AI brand: not AI security", None
    vote = ai_type_from_text(text)
    if not vote:
        return False, False, "AI context but no AI-security incident or topic", None
    incident = _first_unnegated(_AI_EVENT_RE, text)
    why = f"AI context {clean_ws(context.group(0))!r} and {vote[2]}"
    if incident and _AI_TOPIC_TITLE.search(title) and not _first_unnegated(_AI_REAL_HARM_RE, text):
        incident = None
        why += "; a paper, talk, explainer or trend piece: a topic, not an incident report"
    return True, bool(incident), why, vote


def ai_lane_vote(crypto_vote, ai_vote):
    """The type vote of an item in both lanes: a mechanism the crypto rules state wins; a bare incident word
    ("hack"), a generic exploit or "other" gives way to the AI type."""
    if not ai_vote:
        return crypto_vote
    if crypto_vote and crypto_vote[0] not in ("exploit", "other") and not GENERIC_VOTE.match(crypto_vote[2] or ""):
        return crypto_vote
    return ai_vote


# ---------------------------------------------------------------- type and evergreen

_TEXT_TYPE_RULES = (
    ("social-engineering", "fake-job-malware",
     r"fake (?:job|interview|recruit\w*)|job (?:interview|offer)s?|employment fraud|it worker fraud|"
     r"hiring scam|recruit\w* scam|interview playbook"),
    ("drainer", "drainers", r"\bdrainers?\b|wallet[- ]drain\w*|permit phishing|approval phishing"),
    ("phishing", "address-poisoning", r"address[- ]poison\w*|poisoned address\w*|zero[- ]value transfers?"),
    # ads that compromise the device itself ("compromise vulnerable iPhones with a single tap") are not phishing: the
    # phishing explainer's fix would be the wrong advice, so no explainer fits ("other")
    ("other", None,
     r"compromis\w* (?:vulnerable |unpatched )?(?:iphones?|android|phones?|devices?|computers?|macs?)|single[- ]tap|"
     r"zero[- ]click|one[- ]click exploit|exploit kits?|drive[- ]by (?:download|compromise)\w*|malvertis\w*|"
     r"(?:malicious|fake|poisoned|online|search) ads?\b|\bads? (?:that |which |can |to )?(?:steal|infect|drain|compromise)\w*"),
    ("phishing", "phishing",
     r"phish\w*|malicious (?:links?|sites?|websites?|extensions?)|"
     r"fake (?:websites?|sites?|apps?|extensions?|exchanges?|support)|dns hijack\w*|"
     r"front-?end (?:compromise|hijack)\w*|typosquat\w*"),
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
    "bridge",
    # AI types rank after every specific crypto mechanism and before a generic exploit (the crypto order is unchanged)
    "deepfake-fraud", "ai-phishing", "prompt-injection", "malicious-ai-tool", "model-supply-chain",
    "ai-data-exposure", "ai-agent-exploit", "ai-assisted-attack", "ai-washing",
    "exploit", "other",
)

# A type vote that only rests on a bare incident word ("hack", "theft", "exploit") states no mechanism.
GENERIC_VOTE = re.compile(r"^text '(?:hack\w*|exploit\w*|drain\w*|stolen|theft|steal\w*)'$", re.IGNORECASE)

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


_ADVICE = re.compile(
    r"(?:watch (?:out )?for|beware of|be wary of|warn\w* (?:\w+ )?(?:of|about|against)|"
    r"alert\w* (?:\w+ )?(?:to|for|about)|guard against|look out for|protect\w* (?:\w+ )?(?:from|against)|"
    r"avoid|risk of|could lead to|vulnerable to)\s+(?:\w+\s+){0,2}$",
    re.IGNORECASE,
)


def type_from_text(text):
    """First rule (in priority order) with a match that is not advice or a warning
    ("watch for phishing" says nothing about how this incident happened)."""
    text = text or ""
    for kind, topic, pattern in _TEXT_TYPE_RULES:
        for match in pattern.finditer(text):
            if _ADVICE.search(text[max(0, match.start() - 50): match.start()]):
                continue
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


_CUE_NEGATION = re.compile(r"\b(?:no|not|never|without|unaffected|zero|none of the)\b[^.;:]{0,25}$", re.IGNORECASE)


def retail_cues(text):
    """Retail cue words in text, skipping negated ones ("no user funds were affected")."""
    text = text or ""
    return sorted({m.group(1).lower() for m in _RETAIL_CUES.finditer(text)
                   if not _CUE_NEGATION.search(text[max(0, m.start() - 40): m.start()])})


def institutional_cues(text):
    return sorted({m.group(1).lower() for m in _INSTITUTIONAL_CUES.finditer(text or "")})


# ---------------------------------------------------------------- follow-up cues

FOLLOW_UP_RE = re.compile(
    r"\b(recover\w*|freez\w*|frozen|forfeit\w*|seiz\w*|launder\w*|mixers?|bounty|post-?mortem|"
    r"reimburs\w*|compensat\w*|refund\w*|indict\w*|charged|arrest\w*|stolen in|tied to|linked to|"
    r"(?:hack|theft|exploit|heist|breach)-linked|hack loot|loot|trac(?:e|es|ed|ing)|"
    r"after (?:the|its|a) \w*\s?(?:hack|exploit|breach)|in the wake|"
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
    r"^\s*(?:in|of)\s+(?:stolen|losses|thefts)\b"
    r"|^\s*(?:was\s+|were\s+)?(?:stolen|drained|lost|swiped|siphoned|looted)\b"
    r"|^\s*(?P<between>(?:[A-Za-z][\w.\-]*\s+){0,2}?)(?:hack|hacks|exploit|exploits|theft|thefts|"
    r"heist|breach|drain|attack|loss|losses)\b",
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


_OTHER_INCIDENT = re.compile(
    r"\b(?:previous(?:ly)?|earlier|prior|last (?:month|week|year)|first (?:hack|exploit|attack|incident)|"
    r"another|second|may have|might have|could have|potentially)\b",
    re.IGNORECASE,
)


def excerpt_amounts(text):
    """Loss figures from an excerpt, skipping sentences about other or possible losses."""
    out = []
    for sentence in re.split(r"(?<=[.!?])\s+", text or ""):
        if _OTHER_INCIDENT.search(sentence):
            continue
        for value, quote in reported_amounts(sentence):
            if all(abs(value - v) > 0.5 for v, _ in out):
                out.append((value, quote))
    return out


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
            # keep the source's qualifier with the figure ("almost $1 million" is not "$1 million")
            qual = _QUALIFIER_BEFORE.search(before)
            start = match.start() - len(qual.group(0)) if qual else match.start()
            quote = text[start: match.end()].strip()
            if all(abs(value - v) > 0.5 for v, _ in out):
                out.append((value, quote))
    return out


_QUALIFIER_BEFORE = re.compile(
    r"\b(?:almost|nearly|about|around|approximately|approx\.|roughly|some|an estimated|estimated|at least|up to|"
    r"over|more than|less than|under|close to)\s+$",
    re.IGNORECASE,
)
_QUALIFIER_WORD = re.compile(
    r"^(almost|nearly|about|around|approximately|approx\.|roughly|some|an estimated|estimated|at least|up to|over|"
    r"more than|less than|under|close to)\s+",
    re.IGNORECASE,
)


def qualifier_of(quote):
    """The qualifier a figure's quote keeps ("almost", "at least"), or ""."""
    match = _QUALIFIER_WORD.match(quote or "")
    return match.group(1).lower() if match else ""


_TITLE_OTHER = re.compile(
    r"^(?:(?:days?|weeks?|months?|years?)\s+after|after|following|since|weeks? before|months? before|"
    r"its (?:second|third|latest|previous)|a (?:previous|prior|separate|second))\b",
    re.IGNORECASE,
)


def title_amounts(title):
    """Loss figures stated in a headline about THIS incident: clauses about another incident ("..., months after a
    $1 million exploit") are skipped, and only the first loss figure counts."""
    # a comma inside a figure ("$800,000") is not a clause boundary
    parts = re.split(r",(?!\d{3}\b)\s*|;\s*|\s+[-–—]\s+|\s+(?=(?:days?|weeks?|months?|years?)\s+after\b)|\s+(?=after\b)|\s+(?=following\b)", title or "")
    for part in parts:
        part = part.strip()
        if not part or _TITLE_OTHER.search(part) or _OTHER_INCIDENT.search(part):
            continue
        found = reported_amounts(part)
        if found:
            return found[:1]
    return []


_POSSIBLE_LOSS = re.compile(r"\b(?:may have|might have|could have|possibly|potentially) (?:also )?(?:lost|been (?:stolen|drained|affected))\b", re.IGNORECASE)


def includes_possible_losses(text):
    """Does the text count amounts someone only "may have" lost?"""
    return bool(_POSSIBLE_LOSS.search(text or ""))


# ---------------------------------------------------------------- mechanism qualifiers

_MECH_WORDS = re.compile(
    r"\b(?:attack\w*|exploit\w*|hack\w*|compromis\w*|keys?|vulnerab\w*|mechanism|cause|method|breach\w*|theft|"
    r"leak\w*|access|authorit\w*|flaw\w*|bugs?|sign\w*|phish\w*|malware|how|origin|minting|mint)\b",
    re.IGNORECASE,
)
_MECH_UNKNOWN = re.compile(
    r"\b(?:remains? (?:unknown|unclear|under investigation)|(?:is|are|was|were) (?:still )?(?:unknown|unclear|"
    r"being investigated|under investigation)|under investigation|as-yet[- ]unidentified|unidentified|"
    r"not (?:yet )?(?:known|determined|confirmed|clear)|attack method:\s*unknown|(?:root )?cause (?:is |was )?"
    r"(?:still )?(?:unknown|unclear)|anomal(?:y|ies|ous))\b",
    re.IGNORECASE,
)
_MECH_SUSPECTED = re.compile(
    r"\b(?:suspect(?:s|ed)?|suspicious|potential(?:ly)?|possibl[ey]|apparent(?:ly)?|believed to|appears? to|"
    r"likely|may have|might have|reportedly|alleged(?:ly)?|unconfirmed|preliminary)\b",
    re.IGNORECASE,
)


# Words that name HOW an incident happened. "A suspected exploit" hedges whether there was an incident at all (the
# status hedge); only a hedged mechanism ("suspected key theft", "a possible phishing link") makes it "suspected".
_MECH_SPECIFIC = re.compile(
    r"\b(?:keys?|signing|signer\w*|seed phrases?|vulnerab\w*|flaw\w*|bugs?|phish\w*|malware|drainer\w*|"
    r"access control|oracle\w*|price manipulation|flash[- ]loan\w*|reentran\w*|logic|mint\w*|compromis\w*|leak\w*|"
    r"insider\w*|social engineering|supply[- ]chain|front[- ]?end|dns|cause|method|mechanism|root cause|"
    r"poison\w*|deepfake\w*|impersonat\w*|sdk|api)\b",
    re.IGNORECASE,
)


def mechanism_qualifier(text):
    """('unknown' | 'suspected', sentence) when the text says the mechanism is unknown or only suspected, else
    (None, None). Read from the FULL text before it is cut to an excerpt, so caveats past 280 characters count."""
    found = None
    for sentence in re.split(r"(?<=[.!?])\s+", clean_ws(text or "")):
        if not _MECH_WORDS.search(sentence):
            continue
        if _MECH_UNKNOWN.search(sentence):
            return "unknown", sentence
        if found is None and _MECH_SUSPECTED.search(sentence) and _MECH_SPECIFIC.search(sentence):
            found = ("suspected", sentence)
    return found or (None, None)


# ---------------------------------------------------------------- who says it (origin) and user-side incidents

# Cue verbs: who an outlet relays says, warns, finds or traces something. A present-tense cue is always active ("Osmosis
# links ... to the attacker"); a past form can be a passive. Only the speech verbs can name a project's OWN statement.
_SPEECH_PRESENT = r"says|warns|confirms|discloses|reports"
_SPEECH_PAST = r"said|warned|confirmed|disclosed"
_CUE_PRESENT = _SPEECH_PRESENT + r"|finds|traces|tracks|flags|identifies|discovers|estimates|alleges|attributes|links"
_CUE_PAST = (_SPEECH_PAST + r"|found|reported|traced|tracked|flagged|identified|discovered|estimated|alleged|attributed|"
             r"linked|tied")
# A past cue read as a passive or a result: the name before it is what the line is about, not who speaks or researched
# ("Bybit Reported Hacked", "Cursor Found Vulnerable to ...", "USDC Tied to Binance Hack", "Balancer Flagged as Victim",
# "X said to be ...", "X confirmed by ...")
_PASSIVE_NEXT = r"hacked|exploited|breached|drained|compromised|attacked|hit|vulnerable|to|as|by"
# ...and in a headline, where verbs drop their auxiliaries, a place, reason or time after the verb reads as a passive
# too ("Exchange Warned Over ...", "Moonwell Flagged for ...", "Upbit Found in ...", "Bybit Reported After ...")
_PASSIVE_NEXT_HEADLINE = _PASSIVE_NEXT + r"|in|for|after|over|with|amid"


def _cue(present, past, passive, case_insensitive):
    """A cue verb right after a name: any present form, or a past form not followed by a passive or result word."""
    verbs = r"(?:" + present + r")\b|(?:" + past + r")\b(?!\s+(?i:" + passive + r")\b)"
    return r"\s+" + (r"(?i:" + verbs + r")" if case_insensitive else r"(?:" + verbs + r")")
# One word of an organisation's name: "." only before a lower-case letter, a digit or another capitalised token
# ("Crypto.com", "Muah.ai", "LI.FI") or in an initialism ("U.S."), so a name never runs across a sentence end, with or
# without the space a feed's inline tags dropped ("findings by GitGuardian. The firm ..." and "GitGuardian.The firm" are
# both "GitGuardian"); a company suffix ("Acme Inc.") may close the name.
_ORG_WORD = r"(?:(?:[A-Z]\.){2,}|[A-Z](?:[\w&'’-]|\.(?=[a-z0-9]|[A-Z]{2,}(?![a-z])))*)"
_ORG_SUFFIX = r"(?:\s+(?:Inc|Corp|Ltd|Co|LLC|PLC|GmbH|AG|SA)\.?)?"
_ORG = r"(" + _ORG_WORD + r"(?:\s+(?:of\s+)?" + _ORG_WORD + r"){0,2}" + _ORG_SUFFIX + r")"
_ACCORDING_TO = re.compile(
    r"\b(?i:according to)\s+(?:(?i:a|an|the)\s+)?(?:(?i:new)\s+)?(?:(?i:report|analysis|research|post|statement|blog "
    r"post|alert|data)\s*)?(?:(?i:from|by)\s+)?" + _ORG)


def _origin_patterns(passive):
    return (
        _ACCORDING_TO,
        re.compile(_ORG + r"['’]s (?i:research|report|analysis|findings|data|investigation|team)\b"),
        re.compile(r"\b(?i:research|report|analysis|findings|data) (?i:from|by) " + _ORG),
        re.compile(_ORG + _cue(_CUE_PRESENT, _CUE_PAST, passive, True)),
        re.compile(r"^" + _ORG + r":\s"),
    )


_ORIGIN_PATTERNS = _origin_patterns(_PASSIVE_NEXT)
_ORIGIN_PATTERNS_HEADLINE = _origin_patterns(_PASSIVE_NEXT_HEADLINE)
# Who makes a statement: "according to X", or "X says / warns / confirms / discloses / reports / said / warned /
# confirmed / disclosed" written in lower case as in running text. Finding verbs (found, traced, linked, tied...) and
# "X:" never make a statement, and a Title Case headline gives none: there "Bybit Reported Hacked" and "Stake DAO Warns
# of ..." cannot be told from a project's own word by their shape.
# * A past speech verb is the project's own word only when a clause opens after it ("Bybit said it ...", "said that
#   ...", "confirmed the hack", "said on Friday ..."): "Bybit said targeted by ...", "Bybit confirmed victim of ...",
#   "Radiant Capital confirmed affected by ..." are headline passives about the project, not by it.
# * "reports" is a verb only before a determiner, a figure or an incident word ("Bullpen reports unauthorized
#   transfers"), never in "Bybit reports emerge of ..." or "Bybit reports of a hack spread ...".
_CLAUSE_OPENER = (
    r"(?:it|its|it['’]s|they|their|them|we|our|he|she|his|her|that|the|this|these|those|a|an|some|all|no|none|"
    r"attackers?|hackers?|thieves|exploiters?|users?|customers?|clients?|funds?|assets?|tokens?|"
    r"on|late|earlier|later|today|yesterday|tonight|overnight|publicly|separately|also|in\s+(?:a|an|its|their)|"
    r"(?:mon|tues|wednes|thurs|fri|satur|sun)day)\b|[\d$€£\"“‘']"
)
_REPORTS_VERB = (r"reports(?=\s+(?:a|an|the|its|that|\d|\$|(?:unauthori[sz]ed|suspicious|hack|exploit|breach|attack|theft|"
                 r"loss(?:es)?|incident|drain|compromise|intrusion)\w*)\b|\s+[\d$])")
_STATEMENT_VERBS = (r"\s+(?:(?:says|warns|confirms|discloses)\b|" + _REPORTS_VERB + r"|(?:said|warned|confirmed|disclosed)"
                    r"(?=\s+(?i:" + _CLAUSE_OPENER + r")))")
_STATEMENT_SPEECH = re.compile(_ORG + _STATEMENT_VERBS)
_STATEMENT_PATTERNS = (_ACCORDING_TO, _STATEMENT_SPEECH)
_STATEMENT_PATTERNS_HEADLINE = _STATEMENT_PATTERNS
# A project's statement confirms its incident only when what it says affirms the incident: a compromise or loss word in
# the clause it says ...
_AFFIRM = re.compile(
    r"\b(?:hack(?:s|ed|ing)?|exploit(?:s|ed|ation)?|breach(?:es|ed)?|drain(?:s|ed)?|attack(?:s|ed)?|stole|stolen|"
    r"steal(?:s|ing)?|theft|thefts|heist|compromis(?:e|ed|es)|unauthori[sz]ed|lost|loss|losses|incident|"
    r"siphon(?:s|ed)?|looted|robbed|infiltrat\w+|intrusions?|leak(?:s|ed)?|exposed|exposure|exfiltrat\w+|"
    r"vulnerabilit(?:y|ies)|flaws?)\b",
    re.IGNORECASE,
)
# ... and none of a negation, a denial, an inquiry, a report of others' words or a hedge ("Bybit said it is looking into
# reports of ...", "said it had seen no evidence of a breach", "said it wasn't hacked", "is monitoring a reported hack")
_NOT_AFFIRM = re.compile(
    r"\b(?:not|no|never|none|nothing|neither|nor|without|deni(?:es|ed|al)|deny(?:ing)?|refut\w*|reject\w*|dismiss\w*|"
    r"unaffected|safe|secure|intact|false alarm|look(?:s|ed|ing)? into|aware of|review\w*|monitor\w*|check(?:s|ing)|"
    r"prob(?:e|es|ed|ing)|investigat\w*|assess(?:es|ing)|examin(?:es|ing)|analy[sz]ing|to (?:determine|verify|confirm)|"
    r"evaluat(?:es|ing)|verifying|whether|if|reports?\s+(?:of|that|about)|claims?\s+(?:of|that)|rumou?r\w*|"
    r"allegation\w*|speculat\w*|reported|possible|possibly|potential\w*|suspect\w*|suspicious|unusual|apparent\w*|"
    r"appear\w*|seem\w*|may|might|could|likely|unconfirmed|unverified|alleged\w*|anomal\w*|irregular\w*|planned|"
    r"routine|maintenance|scheduled|unrelated|belong\w*|tr(?:y|ies|ied|ying)|attempt\w*|fail(?:s|ed)?|foil(?:s|ed)|"
    r"thwart(?:s|ed)|prevent(?:s|ed)|avert(?:s|ed)|untrue|false)\b|n['’]t\b",
    re.IGNORECASE,
)
# what the project says first is what counts: a reassurance added after it ("..., says no user funds were lost",
# "... but client funds are safe") does not undo a confirmation, and a denial or an inquiry first is never one
_CLAUSE_SPLIT = re.compile(
    r",?\s+(?:but|while|although|though|whereas|however)\b|,\s+(?:and\s+)?(?:says?|said|adding|added|adds|noting|noted|"
    r"notes)\b|\s+and\s+(?:that|said|says|added|adds|noted)\b",
    re.IGNORECASE,
)
# "according to the Bybit exploiter's onchain message", "according to Bybit users / critics": another party's words
_OTHER_PARTY_AFTER = re.compile(
    r"^(?:['’]s)?\s+(?:[\w-]+\s+)?(?:exploiters?|attackers?|hackers?|thie(?:f|ves)|scammers?|users?|customers?|clients?|"
    r"critics?|investors?|traders?|holders?|depositors?|members?|community|communities|sleuths?|researchers?|"
    r"analysts?|observers?|rivals?|competitors?|victims?|whistleblowers?|insiders?|employees?|staff\w*|lawyers?|"
    r"plaintiffs?|creditors?|shareholders?|partners?|fans?|watchers?|former|ex-\w+)\b",
    re.IGNORECASE,
)
_CLAUSE_END = re.compile(r"[.!?;](?=\s|$)")
_NEGATED_SPEAKER = re.compile(r"\b(?:not|never|no|nor|neither|n['’]t|deni(?:es|ed)|false|untrue)\W*(?:\w+\W+){0,2}$",
                              re.IGNORECASE)


def _sentence_around(text, start, end):
    """The sentence of text that holds [start, end)."""
    head = text[:start]
    stops = list(_CLAUSE_END.finditer(head))
    begin = stops[-1].end() if stops else 0
    stop = _CLAUSE_END.search(text, end)
    return text[begin:stop.start() if stop else len(text)]


def statement_affirms(clause):
    """Does what a project says affirm its incident: a compromise or loss word in what it says first, and no negation,
    denial, inquiry, report of others' words, attempt or hedge there?"""
    first = _CLAUSE_SPLIT.split(clause or "", maxsplit=1)[0]
    return bool(_AFFIRM.search(first)) and not _NOT_AFFIRM.search(first) and not safety.strong_hedge(first)
_NOT_ORIGIN = {
    "the", "a", "an", "it", "this", "that", "they", "he", "she", "we", "i", "you", "his", "her", "their", "our", "its",
    "there", "here", "these", "those", "hackers", "hacker", "attackers", "attacker", "users", "user",
    "investors", "traders", "researchers", "analysts", "police", "officials", "prosecutors", "authorities", "court",
    "named person", "[named person]", "report", "reports", "exclusive", "breaking", "update",
}


def _first_org(patterns, text, publisher):
    own = (publisher or "").lower()
    for pattern in patterns:
        for match in pattern.finditer(text or ""):
            name = clean_ws(match.group(1)).strip(".,:;'’").lower()
            name = re.sub(r"['’]s$", "", name)
            if not name or name in _NOT_ORIGIN or name == own or name.split()[0] in _NOT_ORIGIN:
                continue
            return name
    return None


def origin_of(text, publisher="", headline=False):
    """The organisation a news item relays (Confiant's research, Elliptic's findings, the project's statement),
    lower-cased, or None when the item reports on its own. headline: the text is a headline, where a cue verb followed
    by a place, reason or time reads as a passive ("Exchange Warned Over ...")."""
    return _first_org(_ORIGIN_PATTERNS_HEADLINE if headline else _ORIGIN_PATTERNS, text, publisher)


def statement_of(text, publisher="", headline=False):
    """The organisation whose own statement affirming its incident the text relays ("Chainflip confirms $12M hack",
    "Abracadabra says it was exploited", "attackers drained the cold wallet, according to Bybit"), lower-cased, or None.
    Stricter than origin_of, because a project's own statement relayed by one outlet confirms its incident: speech verbs
    only, in lower case, never a passive ("Bybit reported hacked", "Bybit said targeted by ...", "X said to be ..."),
    never from a Title Case headline, never another party's words ("according to Bybit users"), and only when the clause
    the project says affirms the incident: "Bybit said it is looking into reports of ...", "said it had seen no evidence
    of a breach", "said it wasn't hacked" or "said it had taken the service offline" confirm nothing."""
    text = text or ""
    if headline and safety._title_case(text):
        return None
    own = (publisher or "").lower()
    found = []
    for pattern in (_STATEMENT_PATTERNS_HEADLINE if headline else _STATEMENT_PATTERNS):
        found.extend((m.start(), pattern is _ACCORDING_TO, m) for m in pattern.finditer(text))
    for _, according, match in sorted(found, key=lambda f: f[0]):
        name = clean_ws(match.group(1)).strip(".,:;'’").lower()
        name = re.sub(r"['’]s$", "", name)
        if not name or name in _NOT_ORIGIN or name == own or name.split()[0] in _NOT_ORIGIN:
            continue
        sentence = _sentence_around(text, match.start(), match.end())
        if _NEGATED_SPEAKER.search(text[max(0, match.start() - 40):match.start()].split(".")[-1]):
            continue  # "it is not true that Bybit confirmed ...", "nor did Bybit say ..."
        if according:
            if _OTHER_PARTY_AFTER.match(text[match.end(1):]):
                continue  # "according to Bybit users", "according to the Bybit exploiter's message"
            clause = sentence.replace(match.group(0), " ")
        else:
            stop = _CLAUSE_END.search(text, match.end())
            clause = text[match.end():stop.start() if stop else len(text)]
        if statement_affirms(clause):
            return name
    return None


_USER_SIDE = re.compile(
    r"\b(?:an?|one|several|some|two|three)?\s*(?:trader|user|customer|holder|investor|whale|account)s?['’]?s?\s+"
    r"(?:leaked\s+|compromised\s+|stolen\s+)?(?:api\s+)?(?:keys?|devices?|phones?|wallets?|accounts?|seed phrases?)\b|"
    r"\bleaked (?:trader|user|customer)s?['’]? (?:api )?keys?\b|\b(?:non-?official|unofficial|third-party) sdk\b|"
    r"\b(?:api |private |signing )?keys? (?:belonging to|of|held by|owned by) (?:an? |one |several |some )?(?:trader|user|customer|holder|investor|account)s?\b|"
    r"\b(?:protocol|smart contracts?|contracts?)(?: and smart contracts?)? (?:were|was|are|is|remain(?:ed)?) unaffected\b|"
    r"\busers?(?:\(s\))? (?:were |was )?exploited\b|\buser-side\b",
    re.IGNORECASE,
)


def user_side(text):
    """The phrase showing that users, not the protocol, were compromised (a trader's API key, a user's device), or None."""
    match = _USER_SIDE.search(text or "")
    return clean_ws(match.group(0)) if match else None


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
    Google Apple Microsoft Telegram Discord WhatsApp ChatGPT OpenAI Nvidia X Twitter
    Elliptic Chainalysis TRM PeckShield CertiK SlowMist Cyvers BlockSec Arkham Nansen Bitquery
    Lookonchain Hacken Immunefi SEAL Hexagate Blockaid ScamSniffer MistTrack Confiant Wiz Mandiant
    Kaspersky Bubblemaps Interpol Europol""".split()
}
_HEADLINE_VERBS = {
    w for w in """confirms confirmed suspects loses lost offers urges warns says said halts halted pauses
    paused suspends suspended freezes froze admits discloses reports reported blames plans seeks
    moves targets traces weighs extends faces hit hits suffers suffered recovers restores resumes
    reopens shuts patches fixes issues denies claims reveals identifies asks proposes votes is was
    has gets got obtains secures exploited hacked drained breached compromised attacked collapses
    crashes plunges followed to""".split()
}
_ROLE_TRAIL = {"founder", "ceo", "team", "users", "user", "holders", "community", "account", "accounts", "cofounder", "co-founder"}
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
_CONNECTORS = {"and", "&", "de", "du", "la", "des", "x"}
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
    if not any(re.search(r"[^\W\d_]", w) for w in words):
        return None  # a bare count ("57 indicted ...", "2 men charged ...") is never a name
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


def extract_subject(title, exclude=()):
    """Best-effort subject (protocol, company or campaign) of a security headline.

    Returns (subject, method) or (None, None). Precision over recall: a headline
    without a confident subject stays unclustered ("also seen") rather than
    becoming an incident with a guessed name. `exclude` holds names that can never
    be the subject (the publishing outlet or vendor itself).
    """
    if not title:
        return None, None
    excluded = {e.lower() for e in exclude}
    subject, method = _extract_subject(title, excluded)
    if subject and _MODIFIER_SUFFIX.search(subject):
        subject = subject[: subject.rfind("-")]
    if subject and (subject.lower() in excluded or core_name(subject) in excluded):
        return None, None
    if subject and _SUBJECT_PERSON_FIRST.match(subject):
        return None, None  # "Investor Kiro", "Trader Mateo", "Whale Kirov": a person word opens it
    return subject, method


def _lead_subject(tokens, ends, excluded, verbs=None):
    """'Stake DAO Warns ...', 'Chainflip confirms ...', "Korea's DCENT to shut ..."."""
    verbs = verbs or _HEADLINE_VERBS
    run = []
    for index, tok in enumerate(tokens[:5]):
        word = _bare(tok)
        if word.lower() in verbs and run:
            while run and _bare(run[-1]).lower() in _ROLE_TRAIL:
                run.pop()
            candidate = _clean_run(run) if run else None
            if candidate and candidate.lower() not in excluded and core_name(candidate) not in excluded:
                return candidate
            return None
        if not _cap_like(tok) or len(run) >= 4:
            return None
        if _has_possessive(tok):
            run = []  # "South Korea's DCENT": the owner is a modifier
        else:
            run.append(tok)
        if ends[index]:
            return None
    return None


def _extract_subject(title, excluded, verbs=None):
    # every dollar amount, whatever the currency ("HK$1.6 Billion" is never a subject)
    text = ANY_DOLLAR_RE.sub(" " + AMT + " ", title.replace("\u2019", "'"))
    raw = text.split()
    tokens = [t.rstrip(",:;") for t in raw]
    ends = [t.endswith((",", ":", ";")) for t in raw]
    lead = _lead_subject(tokens, ends, excluded, verbs)
    if lead:
        return lead, "headline subject"
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
        # "North Korea hacks Binance": only in sentence-case headlines, where a
        # capitalised word after a lower-case verb is a name, not the next title word
        if word in _ACTIVE_TRIGGERS and _bare(token)[:1].islower():
            candidate = _clean_run(_run_after(tokens, ends, index))
            if candidate:
                return candidate, "headline pattern"
    # "exploit of X", "hack on X", "... drain $5M from X"
    for index, token in enumerate(tokens[:-1]):
        nxt = tokens[index + 1].lower()
        noun = re.fullmatch(r"(?i)(?:hack|exploit|breach|attack|theft|heist)\w*", _bare(token))
        if (noun and nxt in ("of", "on", "at", "against")) or (
                nxt == "from" and re.search(r"(?i)\b(?:drain|stole|steal|siphon|loot|swip|withdr)\w*", " ".join(tokens[:index + 1]))):
            candidate = _clean_run(_run_after(tokens, ends, index + 1))
            if candidate:
                return candidate, "headline pattern"
    if len(tokens) > 1 and _cap_like(tokens[0]) and not _is_stop(tokens[0]) and _bare(tokens[0]).lower() not in excluded:
        nxt = _bare(tokens[1])
        if nxt and nxt[0].islower():
            candidate = _clean_run([tokens[0]])
            if candidate:
                return candidate, "sentence-case subject"
    for token in tokens:
        word = _bare(_strip_possessive(token))
        if word == AMT or word.lower() in _STOPWORDS or word.lower() in excluded or len(word) < 3 or word.isdigit():
            continue
        distinctive = (word.isupper() and word.isalpha()) or re.search(r"[a-z][A-Z]", word) is not None \
            or re.fullmatch(r"[A-Za-z0-9]+\.[A-Za-z]{2,}", word) is not None
        if distinctive:
            return word, "distinctive token"
    return None, None


_GENERIC_TRAIL = {
    "bridge", "vault", "vaults", "exchange", "protocol", "wallet", "wallets", "token", "network",
    "hack", "exploit", "users", "user", "platform", "app", "pool", "contract", "hackers", "loot",
}


# ---------------------------------------------------------------- AI subjects
#
# AI incidents are about products and companies ("Claude Code", "OpenRouter", "Copilot"), and the AI lane's sources
# (the AI Incident Database above all) also write about people. A subject is a known AI product or company, an
# organisation the news gate's allowlist knows, or a name that cannot be a person (a digit, an org word at its end, a
# distinctive token). Anything else stays unclustered rather than risk a person's name as an incident's protocol.

_AI_HEADLINE_VERBS = _HEADLINE_VERBS | {
    w for w in """uncovers unveils traces drops removes pulls bans blocks sues settles detects finds flags exposes
    leaks spills penetrated abused hijacked tricked poisoned disclosed notifies notified investigates probes revokes
    rotates indict indicts charges""".split()
}
_AI_TRAIL = {
    w for w in """servers server systems system users user customers customer tool tools extensions extension plugins
    plugin apps app models model agents agent bots bot management security data platform platforms products product
    services service instances accounts account portal website site api apis cloud network networks devices
    repositories repos packages package library libraries skills integration integrations endpoints infrastructure
    breach hack attack attacks campaign""".split()
}
_AI_SUBJECT_STOP = {
    w for w in """prosecutors police authorities officials regulators researchers experts lawmakers judge court
    scammers fraudsters criminals attackers hackers users companies firms agencies agency government vendors
    developers employees customers incident report inside recent new rogue cyber study survey use uses using how
    why what when the a an""".split()
}
_AI_GENERIC = {
    w for w in """ai llm llms genai autonomous agentic agent agents generative artificial intelligence model models bot
    bots chatbot chatbots coding assistant assistants""".split()
}
_ALLOWLIST = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "news",
                          "allowlist.json")
_ALLOWLIST_CACHE = {}
_ALLOWLIST_PROBLEMS = {}


def _load_allowlist(path=_ALLOWLIST):
    """The allowlist as a dict, or {} with the problem recorded (see allowlist_problem)."""
    if path in _ALLOWLIST_CACHE:
        return _ALLOWLIST_CACHE[path]
    data, problem = {}, None
    try:
        with open(path, encoding="utf-8") as fh:
            data = json.load(fh)
        if not isinstance(data, dict):
            data, problem = {}, "is not a JSON object"
        elif not data.get("publishers") or not data.get("securityFirms"):
            problem = "has no publishers or securityFirms list"
    except FileNotFoundError:
        problem = "is missing"
    except (OSError, ValueError) as err:
        data, problem = {}, f"cannot be read ({type(err).__name__})"
    _ALLOWLIST_CACHE[path] = data
    _ALLOWLIST_PROBLEMS[path] = problem
    return data


def allowlist_problem(path=_ALLOWLIST):
    """Why the news gate's allowlist cannot be used (missing, unreadable, not an object, lists missing), or None. The
    radar then reports it and stops reading AI subjects from headline shapes (only known AI products and companies)."""
    _load_allowlist(path)
    problem = _ALLOWLIST_PROBLEMS.get(path)
    return f"scripts/news/allowlist.json {problem}" if problem else None


def _allowlist_names(keys, path=_ALLOWLIST):
    """Lower-case names from lists of the news claim gate's allowlist (scripts/news/allowlist.json); empty when the
    file is missing or unreadable (allowlist_problem says why)."""
    cache_key = (path, keys)
    if cache_key not in _ALLOWLIST_CACHE:
        data = _load_allowlist(path)
        names = set()
        for key in keys:
            value = data.get(key) if isinstance(data, dict) else None
            names.update(n.lower() for n in value or [] if isinstance(n, str))
        _ALLOWLIST_CACHE[cache_key] = frozenset(names)
    return _ALLOWLIST_CACHE[cache_key]


def known_org_names(path=_ALLOWLIST):
    """Names the news gate's allowlist treats as organisations, not people: publishers, security firms,
    organisations, protocols and agencies."""
    return _allowlist_names(("publishers", "securityFirms", "organisations", "protocols", "agencies"), path)


def chain_names(path=_ALLOWLIST):
    """Chains and networks the news gate's allowlist knows ("Osmosis", "Solana"): organisations, never people."""
    return _allowlist_names(("chains",), path)


def reporter_names(path=_ALLOWLIST):
    """Publishers and security firms: when a headline has one of them say or find something, it is the reporter."""
    return _allowlist_names(("publishers", "securityFirms"), path)


def agency_names(path=_ALLOWLIST):
    return _allowlist_names(("agencies",), path)


def not_people_names(path=_ALLOWLIST):
    """Names the news gate's allowlist knows as organisations, threat groups or terms: never a person token of a run."""
    return _allowlist_names(("publishers", "securityFirms", "organisations", "protocols", "agencies", "attributedGroups"),
                            path)


# "Cisco Talos finds ...", "Wiz says ...": the firm reports the incident, it is not its subject
_REPORTING_VERB = re.compile(
    r"^\s*(?:says|said|warns|warned|finds|found|reports|reported|uncovers|uncovered|traces|traced|detects|detected|"
    r"flags|flagged|spots|spotted|observes|observed|tracks|tracked|links|linked|attributes|details|explains|reveals|"
    r"revealed|discovers|discovered|identifies|identified|analyzes|analyses|exposes|exposed|sees|saw)\b",
    re.IGNORECASE,
)


# role and concept words that are never an incident's subject, on top of the news gate's "terms" (CEO, CFO, API...)
_AI_NOT_SUBJECT = frozenset("""mcp cve cves rce poc pii iot cio cso cmo""".split())
# "IntelBroker leaks ...", "USDoD claims ...": a handle-shaped word that leads a headline as the actor of a verb is a
# person's handle, unless the headline presents it as a tool ("'TheMailer' Phishing Kit", "ArcticRAT malware")
_TOOL_AFTER = re.compile(
    r"^['’\"”]?\s*(?:phishing\s+)?(?:kit|kits|malware|tool|tools|framework|botnet|stealer|infostealer|loader|backdoor|"
    r"ransomware|trojan|rat|worm|campaign|exploit kit|platform|extension|package|server|agent)\b",
    re.IGNORECASE)
_TOOL_SUFFIX = re.compile(r"(?:RAT|Stealer|Loader|Bot|Kit|Worm|Locker|Drainer|Miner|Ware)$")
# "ShinyHunters Breach AI Startup", "ScarletEel Hacks AI Startup's Cloud": an attack word used as a verb with an object
# makes the word before it the attacker, not the party hit. A noun ("DeepSeek Breach Exposes ...", "X Hack Drains ..."),
# a passive ("Servers Hacked in ...", "Hacked by ...") or a clause end ("X Hacked, ...") keeps its subject.
_FOLLOWING_VERBS = frozenset("""drains steals exposes leaks hits affects impacts spills puts lets sends forces prompts sparks
raises shows reveals costs wipes takes leaves triggers disrupts halts knocks nets sees hands gives makes""".split())
_ATTACK_VERB_AFTER = re.compile(
    r"^\s+(?:breach(?:es|ed)?|hack(?:s|ed)?|hijack(?:s|ed)?|target(?:s|ed)?|hits?|attack(?:s|ed)?|drain(?:s|ed)?|"
    r"rob(?:s|bed)?|exploit(?:s|ed)?|compromis(?:e|es|ed)|steal(?:s)?|stole|leak(?:s|ed)?|dump(?:s|ed)?|"
    r"extort(?:s|ed)?|infiltrat(?:e|es|ed)|penetrat(?:e|es|ed)|pwn(?:s|ed)?|strikes?|struck|claims?|claimed|"
    r"behind)\s+([\w$'’“\"‘-]+)", re.IGNORECASE)
# "Hacking Group ShinyHunters ...", "Threat Actor IntelBroker ...", "AI Chatbot Data Leaked By IntelBroker": the actor
_ACTOR_BEFORE = re.compile(
    r"\b(?:(?:hacking|hacker|ransomware|cybercrime|extortion|threat|criminal|cybercriminal)\s+)?(?:group|gang|crew|actor|"
    r"collective|outfit)\s+[\"'“‘«]?$|\b(?:hackers?|attackers?|cybercriminals?|criminals?|operators?)\s+[\"'“‘«]?$|"
    r"\b(?:leak(?:ed|s)?|stolen|stole|hack(?:ed|s)?|breach(?:ed|es)?|dump(?:ed|s)?|exfiltrated|compromised|attacked|"
    r"targeted|sold|posted|claimed)\s+by\s+(?:the\s+)?[\"'“‘«]?$",
    re.IGNORECASE)
_NOT_AN_OBJECT = frozenset("""in by after for via with over amid on at as to from during through again and or but while
into within across since""".split())


# a legal or person verb inside a multi-word subject: the subject is a sentence about a person ("Lena Weiss Arrested
# Over AI Chatbot")
_SUBJECT_PERSON_VERB = re.compile(
    r"\b(?:arrested|charged|indicted|sentenced|jailed|convicted|extradited|detained|pleads|pleaded|admits|admitted|"
    r"confesses|confessed|says|said|loses|lost|sued|sues)\b", re.IGNORECASE)


def _attacker_before_verb(after):
    """The text after a subject starts with an attack verb that has an object: the subject is the attacker."""
    match = _ATTACK_VERB_AFTER.match(after or "")
    if not match:
        return False
    nxt = match.group(1).strip("'’“\"‘").lower()
    return bool(nxt) and nxt not in _NOT_AN_OBJECT and nxt not in _AI_HEADLINE_VERBS and nxt not in _FOLLOWING_VERBS


def _ai_subject_ok(subject, known=(), method=None, title=""):
    """A subject that cannot be a person's name: a known AI product or organisation, a token mixing letters and digits,
    a distinctive token (CamelCase, all caps, a dot) or an organisation word at its end. Never a bare count ("57
    indicted ..."), a role or concept acronym ("CEO fraud", "CIA triad"), a pun on AI words taken from mid-headline
    ("ProbLLMs"), or a handle-shaped word that leads the headline as its actor ("IntelBroker leaks ...")."""
    if subject in AI_PRODUCTS:
        return True
    low = subject.lower()
    if not re.search(r"[^\W\d_]", subject):
        return False  # a bare count is never a name
    if low in _AI_NOT_SUBJECT or (" " not in subject and low in _allowlist_names(("terms",))):
        return False
    if low in known or low in known_org_names():
        return True
    words = subject.split()
    if method == "distinctive token" and (re.fullmatch(r"[A-Z]{2,}", subject) or re.search(r"LLM|GPT", subject)):
        return False  # "CIA" in "CIA Security Triad", "ProbLLMs": a word from mid-headline, not its subject
    if re.fullmatch(r"(?i:" + _PERSON_WORDS + r")", words[0]):
        return False  # "Teenager Kiberphant0m", "Hacker IntelBroker": a person word opens it
    if len(words) >= 2 and _SUBJECT_PERSON_VERB.search(subject):
        return False  # "Lena Weiss Arrested Over AI Chatbot": a legal or person verb inside it
    position = title.find(subject) if title and subject in title else -1
    before = title[:position] if position >= 0 else ""
    after = title[position + len(subject):] if position >= 0 else ""
    if before and (_PERSON_CUE_BEFORE.search(re.split(r"[.;!?]", before)[-1]) or _ACTOR_BEFORE.search(before)):
        return False  # "Hacker Known Only As 'IntelBroker'", "Hacking Group ShinyHunters", "Leaked By IntelBroker"
    shaped = (any(re.search(r"\d", w) and re.search(r"[^\W\d_]", w) for w in words)
              or any(re.search(r"[a-z][A-Z]|^[A-Z]{2,}$|\w\.\w", w) for w in words))
    if shaped:
        if len(words) == 1 and title:
            tool = bool(_TOOL_AFTER.match(after) or _TOOL_SUFFIX.search(subject))
            if not tool and (title.isupper() or method in ("headline subject", "sentence-case subject")
                             or _attacker_before_verb(after)):
                return False  # a handle leading the headline as its actor, whatever the method, or an all-caps one
        if len(words) >= 2 and all(re.fullmatch(r"[A-Z][a-z]+", w) for w in words[:2]) and not any(
                w.lower() in safety.ORG_WORDS for w in words) and not any(re.search(r"\d|[a-z][A-Z]|\.", w) for w in words[:2]):
            return False  # "Lena Weiss ... AI": an unknown capitalised pair opens it, whatever all-caps word follows
        return True
    return len(words) >= 2 and words[-1].lower() in safety.ORG_WORDS


def _trim_ai_subject(subject):
    words = subject.split()
    while words and words[0].lower() in _AI_SUBJECT_STOP:
        words.pop(0)
    while len(words) > 1 and words[-1].lower() in _AI_TRAIL:
        words.pop()
    if not words or all(w.lower() in _AI_TRAIL | _AI_SUBJECT_STOP | _AI_GENERIC for w in words):
        return None
    return " ".join(words)


# the role an AI product plays in a headline: an impersonated brand ("Fake ChatGPT extension", "impersonates OpenAI"),
# the tool an attacker used ("... with ChatGPT"), the target ("Hacking Claude's Memory", "Breaking Claude Code")
_IMPERSONATED_BEFORE = re.compile(
    r"\b(?:fake|bogus|counterfeit|malicious|rogue|spoofed|trojani[sz]ed|look-?alike|knock-?off|impersonat\w*|"
    r"posing as|pretending to be|masquerading as|disguised as)\s+(?:[\w.-]+\s+)?$", re.IGNORECASE)
_INSTRUMENT_BEFORE = re.compile(r"\b(?:with|using|via)\s+$", re.IGNORECASE)
_TARGET_BEFORE = re.compile(
    r"\b(?:breaking|hacking|hijacking|exploiting|attacking|jailbreaking|compromising|poisoning)\s+(?:my |the |a )?$",
    re.IGNORECASE)
# an agency that says or warns reports someone else's incident ("NSA says ..."); one that uncovers or confirms a
# breach may be its own ("European Commission uncovers data breach")
_SPEECH_VERB = re.compile(r"^\s*(?:says|said|warns|warned|urges|urged|advises|advised|alerts|cautions|reports|reported)\b",
                          re.IGNORECASE)
# a one-word product name used for a person: "Sora Tanaka arrested", "Claude, 72, loses ...", "Ex-employee Cline
# charged", "Hacker known as Sora", "Kiro (19) Arrested ...", "Teenager Sora Arrested ..."
_PERSON_NEXT = re.compile(
    r"^\s+[A-Z][a-zà-ÿ'’-]+(?:\s+(?i:arrested|charged|indicted|sentenced|jailed|convicted|pleads?|pleaded|says|said|"
    r"loses|lost|sued|admits))\b")
_LEGAL_NEXT = re.compile(
    r"^\s*(?:\(\s*\d{1,3}\s*\)\s*)?(?:(?i:was|is|has been|gets|got)\s+)?(?i:arrested|charged|indicted|sentenced|jailed|"
    r"convicted|extradited|detained|pleads?|pleaded)\b")
# person words for the cues below: roles (safety's, including plural and derived forms) and words for people
_PERSON_NOUNS = (r"creators?|owners?|authors?|moderators?|teens?|teenage|teenagers?|boys?|girls?|youths?|kids?|ex-employee|former employee|victims?|retirees?|"
                 r"pensioners?|grandmother|grandfather|grandson|granddaughter|nephew|niece|mother|father|man|woman|men|women|"
                 r"students?|person|individual|nurse|teacher|doctor|pastor|gamers?|cybercriminals?|criminals?|operators?|"
                 r"threat actors?|actors?|hackers|attackers|scammers|suspects|fraudsters|elderly|widow|widower|veteran|"
                 r"residents?|holders?|traders|investors|influencers|members?|affiliates?|ringleaders?|masterminds?|"
                 r"accomplices?|sellers?|brokers?")
_PERSON_WORDS = safety._ROLE_CUES + r"|" + _PERSON_NOUNS
_APPOSITION_ROLES = (r"developer|engineer|researcher|trader|investor|student|teacher|employee|executive|retiree|grandmother|"
                     r"grandfather|mother|father|man|woman|teen|teenager|resident|victim|influencer|hacker|attacker|scammer|"
                     r"suspect|cybercriminal|criminal|operator|gamer|nurse|doctor|pastor|fraudster|thief|actor|youth|boy|"
                     r"girl|pensioner|veteran|widow")
_APPOSITION_AFTER = re.compile(
    r"^\s*,\s*(?:aged\s+)?\d{1,3}\s*,|^\s*\(\s*(?:aged?\s+)?\d{1,3}\s*\)|^\s*,\s*who\b|"
    r"^\s*,\s*(?:(?:a|an|the)\s+)?(?:[\w-]+\s+){0,2}?(?:" + _APPOSITION_ROLES + r")s?\b", re.IGNORECASE)
# a person word right after the name, with or without quotes and "the" ("'Sora' The Hacker Leaks ...", "Sora the
# Hacker", "'Sora' Hacker Sold ...")
_ROLE_AFTER = re.compile(
    r"^[\"'”’»)\]]*\s+(?:the\s+)?(?:hacker|attacker|scammer|suspect|teen|teenager|cybercriminal|criminal|gamer|fraudster|"
    r"thief|influencer|trader|victim|retiree|youth|kid|boy|girl)s?\b", re.IGNORECASE)
# a person word right before the name, with any opening mark between ("Hacker 'Sora'", "Hacker «Sora»", "Hacker (Sora)",
# "Hacker, Sora,", "Hacker — 'Sora'"), or a person word then a naming phrase ("Hacker Dubbed Claude", "a scammer going
# by Sora", "Gamer Known Online as Sora", "Hacker Known Only As 'Sora'", "Hackers Led By 'Kiro'", "Hacker Behind 'Kiro'
# Alias"), "who goes by", or a legal action right before the name ("FBI Arrests Kiro, ..."). A naming verb after a tool
# word ("a tool called Cursor") is not a person cue, and "agent" never takes one ("an AI agent called Cursor").
_NAMING_PERSON_WORDS = "|".join(w for w in _PERSON_WORDS.split("|") if w != "agent")
_KNOWN_AS = r"known(?:\s+(?:only|simply|online|publicly|in forums|on \w+))?\s+as"
_NAMING_VERB = (r"dubbed|called|named|nicknamed|" + _KNOWN_AS + r"|going by|goes by|calling (?:himself|herself|themselves)|"
                r"behind|using the (?:alias|handle|name|nickname|moniker)|with the (?:alias|handle)|led by|run by")
_OPENING = r"(?:\s*[,:]\s*|\s*[-–—]\s*|\s*[(\[]\s*|\s+)?[\"'“‘«]?\s*"
_PERSON_CUE_BEFORE = re.compile(
    r"\b(?:(?:" + _PERSON_WORDS + r")|(?:" + _NAMING_PERSON_WORDS + r")\s+(?:" + _NAMING_VERB + r")|who\s+(?:goes by|"
    r"is called|is known as|calls (?:himself|herself|themselves))|" + _KNOWN_AS + r"|nicknamed|alias|aka|led by|"
    r"(?:arrests?|arrested|charges?|charged|indicts?|indicted|sentences?|sentenced|jails?|jailed|extradites?|extradited|"
    r"detains?|detained|convicts?|convicted|unmasks?|unmasked|identifies|identified|names|doxx?(?:es|ed)?))"
    + _OPENING + r"$",
    re.IGNORECASE)
# "called" and "named" also mean "described as": a product word after the name keeps the product ("Developer Called
# Cursor Agent a Risk ...")
_NAMING_AMBIGUOUS = re.compile(r"\b(?:called|named)" + _OPENING + r"$", re.IGNORECASE)
# a quoted name in a clause that has a person word before it ("Hackers 'Sora' and 'Kiro' Sold ...")
_QUOTED_BEFORE = re.compile(r"[\"'“‘«(\[]\s*$")
_PERSON_WORD_IN = re.compile(r"\b(?:" + _PERSON_WORDS + r")\b", re.IGNORECASE)
# AI products that are also given names or handles (Claude, Sora, Kiro, Cline): the product only with a product cue in
# the headline (its vendor, a product word or a version after it, or an AI word)
_PERSONABLE_PRODUCTS = {"Claude": ("Anthropic",), "Sora": ("OpenAI",), "Kiro": ("AWS", "Amazon"), "Cline": ()}
_PRODUCT_CUE = re.compile(
    r"\b(?:AI|A\.I\.|agents?|agentic|apps?|chatbots?|assistants?|models?|LLMs?|IDEs?|extensions?|plugins?|coding|prompts?|"
    r"injection|jailbr\w+|MCP|API|deepfakes?|video generator|opus|sonnet|haiku)\b",
    re.IGNORECASE)


def _product_cue(text, pos, name):
    """A one-word AI product that is also a person's name is the product only when the headline says so: its vendor, a
    product word or a version right after it, or an AI word anywhere ("Claude Tricked Into Leaking Data via Prompt
    Injection" is the product; "Nurse Kiro Loses $40,000 To ElevenLabs Voice Clone Scam" is not)."""
    if name not in _PERSONABLE_PRODUCTS:
        return True
    after = text[pos + len(name):]
    possessive = re.match(r"['’]s\s+([A-Za-z]+)", after)
    if safety._product_next(text, pos + len(name)) or (possessive and possessive.group(1).lower() in safety.AI_PRODUCT_TAILS):
        return True  # "Claude Code", "Sora 2", "Claude's Memory"
    if any(re.search(rf"\b{re.escape(v)}\b", text) for v in _PERSONABLE_PRODUCTS[name]):
        return True
    rest = text[:pos] + " " + text[pos + len(name):]
    return bool(_PRODUCT_CUE.search(rest))


def _product_as_person(text, pos, name):
    """A one-word AI product name that the headline uses for a person."""
    if " " in name:
        return False
    after = text[pos + len(name):]
    before = text[max(0, pos - 60):pos]
    clause = re.split(r"[.;!?]", before)[-1]  # ":" may open the name ("Victim: Kiro")
    cue = _PERSON_CUE_BEFORE.search(clause)
    if cue and _NAMING_AMBIGUOUS.search(clause) and safety._product_next(text, pos + len(name)):
        cue = None  # "Developer Called Cursor Agent a Risk": "called" means "described as" before a product word
    if cue or _APPOSITION_AFTER.match(after) or _ROLE_AFTER.match(after) or _LEGAL_NEXT.match(after):
        return True
    if _QUOTED_BEFORE.search(before) and _PERSON_WORD_IN.search(clause):
        return True  # "Hackers 'Sora' and 'Kiro' Sold ..."
    nxt = re.match(r"\s+([A-Z][\w'’-]*)", after)
    if nxt and nxt.group(1).lower() not in safety.AI_PRODUCT_TAILS and not safety._title_case(text):
        return True  # "Sora Tanaka arrested ...": a capitalised word after it in a sentence-case headline
    if _PERSON_NEXT.match(after):
        return True
    return safety._ai_person_evidence(text, pos, pos + len(name))


def extract_ai_subject(title, exclude=(), known=()):
    """Subject of an AI-security headline: the AI product or company it is about (a product rather than its own
    vendor: "Anthropic says ... Claude Code" is about Claude Code; the target rather than the tool used on it or the
    firm reporting it; never an impersonated brand), else a headline subject that cannot be a person.
    Returns (subject, method) or (None, None)."""
    if not title:
        return None, None
    excluded = {e.lower() for e in exclude}
    text = title.replace("’", "'")
    found = [(m.start(), m.group(0)) for m in _PRODUCTS_RE.finditer(text) if m.group(0).lower() not in excluded]
    if found:
        names = {n for _, n in found}
        own_product = lambda vendor: any(n.startswith(p) for p in _VENDOR_PRODUCTS.get(vendor, ()) for n in names)  # noqa: E731
        keep = [(pos, n) for pos, n in found if not own_product(n)] or found
        targets, plain, instruments = [], [], []
        for pos, n in keep:
            before, after = text[:pos], text[pos + len(n):]
            if _IMPERSONATED_BEFORE.search(before):
                continue  # "Fake ChatGPT extension", "impersonates OpenAI": the brand is not the incident's subject
            others = [m for p2, m in found if p2 != pos]
            if others and _REPORTING_VERB.match(after):
                continue  # "Cursor traces malicious Claude Code extensions": the reporter
            if _product_as_person(text, pos, n) or not _product_cue(text, pos, n):
                continue  # "Sora Tanaka arrested", "Claude, 72, loses ...", "Nurse Kiro Loses ...": a person who shares
                # a product's name
            if after.startswith("'s") or _TARGET_BEFORE.search(before):
                targets.append((pos, n))
            elif others and _INSTRUMENT_BEFORE.search(before):
                instruments.append((pos, n))  # "Breaking Opus 4.7 with ChatGPT": the tool, not the target
            else:
                plain.append((pos, n))
        pick = targets or plain or instruments
        if not pick:
            return None, None  # every product in it is a brand, a reporter or a person: no confident subject
        return min(pick)[1], "AI product or company"
    if allowlist_problem():
        return None, None  # without the allowlist the reporter and person checks cannot run: known products only
    subject, method = _extract_subject(title, excluded, verbs=_AI_HEADLINE_VERBS)
    subject = _trim_ai_subject(subject) if subject else None
    if subject and _MODIFIER_SUFFIX.search(subject):
        subject = subject[: subject.rfind("-")]
    if not subject or subject.lower() in excluded or core_name(subject) in excluded or subject.lower() in _STOPWORDS:
        return None, None
    if not _ai_subject_ok(subject, {k.lower() for k in known}, method, text):
        return None, None
    after = text[text.find(subject) + len(subject):] if subject in text else ""
    if subject.lower() in reporter_names() and _REPORTING_VERB.match(after):
        return None, None  # the reporting firm, not the incident's subject
    if subject.lower() in agency_names() and _SPEECH_VERB.match(after):
        return None, None  # the agency reports it; the victim is someone else ("NSA says ...")
    return subject, method


def subject_known(subject, method=None):
    """Is the subject a name the pipeline knows (an AI product or company, an allowlisted organisation, an incident
    database record or a post-mortem title) rather than a name read from a headline's shape?"""
    if not subject:
        return False
    if method in ("structured", "post-mortem title", "AI product or company"):
        return True
    return subject in AI_PRODUCTS or subject.lower() in known_org_names()


# ---------------------------------------------------------------- subjects that are people
#
# The crypto lane names an incident after its headline's subject, and a victim's or a trader's name is a headline's
# subject too ("Crypto Investor Kiro Loses $2 Million ...", "Trader Mateo Loses ...", "Kruw Wallet Drained ...").

_SUBJECT_PERSON_FIRST = re.compile(
    r"^(?:" + "|".join(sorted(set(safety._PERSON_ROLE_LIST) | {"user", "users", "holder", "holders", "investor",
                                                               "trader", "retiree", "whale", "influencer", "victim"},
                              key=len, reverse=True))
    + r"|" + _PERSON_WORDS + r")s?\b", re.IGNORECASE)
# what an item's own text says about a person: a person word or a personal pronoun
_TEXT_PERSON_CUE = re.compile(
    r"\b(?:victims?|investors?|traders?|retirees?|pensioners?|whales?|holders?|influencers?|he|she|his|her|him|himself|"
    r"herself|man|woman|grandmother|grandfather|elderly|widow|widower)\b", re.IGNORECASE)
# a name that owns a wallet, an account or savings is a person's ("Kruw's wallet", "Kruw Wallet Drained ...")
_OWNS_FUNDS_AFTER = re.compile(
    r"^(?:['’]s)?\s+(?:(?:crypto|hot|cold|personal|ledger|metamask|phantom|trading)\s+)?(?:wallets?|accounts?|funds|savings|"
    r"life savings|portfolio|keys|seed phrase|nest egg|retirement)\b", re.IGNORECASE)
_SHAPED_NAME = re.compile(r"\d|[a-z][A-Z]|\w\.\w|^[A-Z]{2,}$")


def _known_name(subject, known=()):
    low = (subject or "").lower()
    words = re.findall(r"[a-z0-9][a-z0-9.]*", low)
    return bool(low in known_org_names() or low in chain_names() or subject in AI_PRODUCTS
                or (words and all(w in known for w in words)))


def subject_is_person(subject, method, text="", known=()):
    """Does a headline subject name a person? A person word opens it ("Investor Kiro", "Trader Mateo", "Whale Kirov",
    "Influencer Mateo"), or it is one word nothing knows as an organisation (not an incident-database record, not an
    allowlisted name, not shaped like a brand) in an item whose text speaks of a person ("... his wallet", "the victim
    ...", "the investor ...")."""
    if not subject or method in ("structured", "post-mortem title", "AI product or company"):
        return False
    if _SUBJECT_PERSON_FIRST.match(subject):
        return True
    words = subject.split()
    if len(words) != 1 or _SHAPED_NAME.search(subject):
        return False
    # a given name or an AI name a person can have ("Kiro", "Mateo") is a person's in any headline the radar names by
    # its shape (an AI product is found by name, never here); any other unknown word only in an item about a person
    if safety.fold(subject) in safety.FIRST_NAMES or subject.lower() in safety.AI_PERSON_NAMES:
        return True
    return not _known_name(subject, known) and _speaks_of_person(text)


def _speaks_of_person(text):
    """A person word or a personal pronoun in the text, but not one about the attacker ("the attacker swapped his
    funds" says nothing about the subject)."""
    for match in _TEXT_PERSON_CUE.finditer(text or ""):
        if match.group(0).lower() in ("he", "she", "his", "her", "him", "himself", "herself") and re.search(
                r"\b(?:attackers?|hackers?|exploiters?|thie(?:f|ves)|scammers?|perpetrators?|suspects?|culprits?|"
                r"drainers?|criminals?)\b[^.;]{0,40}$", text[max(0, match.start() - 60):match.start()], re.IGNORECASE):
            continue
        return True
    return False


def subject_person_risk(subject, method, title="", known=()):
    """Could a subject the radar kept still be a person's name (exported as personRisk, so the daily and the Threat
    Brief never allowlist it)? Only names no list knows: one with a given name or an AI name a person can have
    ("Kiro", "Mateo Rossi"), two or three plain capitalised words with no organisation word ("Lena Weiss"), or one word
    the headline shows owning a wallet, an account or savings ("Kruw Wallet Drained ...", "Kruw's wallet ...")."""
    if not subject or method in ("structured", "post-mortem title", "AI product or company"):
        return False
    if _known_name(subject, known) or _SUBJECT_PERSON_FIRST.match(subject):
        return bool(_SUBJECT_PERSON_FIRST.match(subject))
    words = subject.split()
    if any(w.lower() in safety.ORG_WORDS for w in words):
        return False
    if any(safety.fold(w) in safety.FIRST_NAMES or w.lower() in safety.AI_PERSON_NAMES for w in words):
        return True
    if 2 <= len(words) <= 3 and all(re.fullmatch(r"[A-Z][a-zà-ÿ'’-]+", w) for w in words):
        return True
    if len(words) == 1 and not _SHAPED_NAME.search(subject) and title and subject in title:
        return bool(_OWNS_FUNDS_AFTER.match(title[title.find(subject) + len(subject):]))
    return False


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
