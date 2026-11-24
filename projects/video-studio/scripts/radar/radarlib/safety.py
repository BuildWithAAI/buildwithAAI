"""Accuracy and safety filters applied to everything the radar writes.

* redact_people: replaces likely personal names (and a few well-known handles)
  with "[named person]". The repo is public and the channel rule is "no suspect or
  individual names". It is heuristic and conservative: it would rather redact a
  company that looks like a person than leave a person in. Officials named in
  law-enforcement or regulator releases are the one allowed exception. The radar
  does not ingest such releases directly, so it redacts them too; the claim gate
  may restore an official's name from the primary release.
* redact_code: removes contract addresses, hashes, code spans, function names and
  calls, so excerpts stay at concept level (no exploit how-tos).
* price_talk / legal_terms / strong_hedge: flags used for notes and for status.
* check_generated: lint for text the radar generates itself.
"""

import re

PERSON = "[named person]"
CODE = "[code]"
ADDRESS = "[address]"

# Common given names, chosen to rarely be English words, places or brands in
# crypto headlines (no May, Will, Grant, Chase, Hunter, Jordan, Rose...).
_FIRST_NAMES = """
aaron abdul abigail adam adrian ahmed aidan alan albert alberto alejandro alex alexander alexandra
alexis alfred ali alice alicia alison allan allison alvin amanda amir amit amy ana anatoly anders
andre andrea andreas andrei andres andrew andy angela angelo anita ann anna anne anthony anton
antonio arjun arnold arthur arturo ashley ashok barbara barron barry beatriz ben benjamin bernard
beth betty beverly bilal bjorn blake bob bobby boris brandon brendan brenda brian bruce bruno
bryan caitlin cameron carl carla carlos carmen carol caroline carolyn casey catherine cathie
cecilia cesar changpeng charles charlie charlotte cheryl chris christian christina christine
christopher cindy claire claude claudia clayton cody colin connor craig cristina curtis cynthia
dale damian dan dana daniel daniela danielle danny darius darren dave david davide dean deborah
denis dennis derek diana diane diego dimitri dmitry dominic donald donna doug douglas duncan
dylan edgar eduardo edward elena eli elijah elizabeth ellen elon emily emma enrique eric erica
erik ethan eugene evan evelyn fabian farhan fatima federico felipe felix fernando francesca
francesco francis francisco frederick gabriel gabriela gareth gary gavin geoffrey george gerald
gerardo gina giorgio giovanni giuseppe glenn gonzalo gordon graham gregory greg gustavo hakan
hamza hannah hans harold harry hassan hayden heather hector heidi helen henry herbert hester
hideo hiroshi howard hugo hussein ian igor ilya irene isaac isabel isabella ivan jack jacob
jacqueline jake james jamie jane janet janice jared jason javier jean jeff jeffrey jennifer jenny
jeremy jerome jerry jesse jessica jihan jill jim jimmy joan joao joe joel johan johann john
johnny jon jonathan jordi jorge jose joseph josh joshua juan judith julia julian julie julio
justin kai kamal karen karl kate katherine kathleen kathryn kathy katie keith kelly ken kenneth
kenji kevin khalid kirk kristen kristin kyle lance larry laura lauren lawrence leah leo leon leonard
leonardo leslie liam linda lisa lorenzo louis lucas lucia luis luke maggie manuel marc marcel
marco marcus margaret maria marie marina mario marisa mark marta martin mary mateo matt matteo
matthew maurice maxim maxwell megan melania melissa michael michel michelle miguel mikhail mike
milan miles mohamed mohammad mohammed molly monica morris muhammad nadia nancy naomi natalia
natalie nathan neil nicholas nick nicolas nicole nikhil nikolai nina noah norman oleg oliver
olivia omar oscar owen pablo pamela patricia patrick paul paula pavel pedro peter philip philippe
pierre pietro priya rachel rafael rahul raj rajesh ralph ramon randy raphael raul ravi ray raymond
rebecca reza ricardo richard rick ricky rob robert roberto robin rodrigo roger roman ronald ross
rostin roy russell ryan sabrina sahil sam samantha samir samuel sandra sanjay sara sarah satoshi
scott sean sebastian sergei sergey sergio seth shane shannon sharon shawn sheila simon sofia
sophia sophie stanislav stefan stefano stephanie stephen steve steven stuart susan sven tamara
tanya tara ted teresa terry thomas tim timothy timmy tobias todd tom tomas tommy tony tracy
travis trevor tyler valentina valerie vanessa vasily veronica vicente victor vikram vincent
vitalik vivek vladimir walter wayne wei wendy wesley william xavier yannick yasmin yuri yusuf
zachary zoe
"""
FIRST_NAMES = frozenset(_FIRST_NAMES.split())

# Handles and nicknames of individuals that show up in crypto-security coverage.
# Listing them means "redact when seen" and implies nothing about anyone.
KNOWN_INDIVIDUAL_TOKENS = ("ZachXBT", "samczsun", "Tayvano", "CZ", "SBF")

# Mixed-case names of firms and data providers that must never be taken for handles.
SAFE_HANDLES = frozenset(
    s.lower() for s in (
        "SlowMist", "PeckShield", "CertiK", "BlockSec", "MistTrack", "ScamSniffer", "Cyvers",
        "CyversAlerts", "DefiLlama", "DeFiLlama", "CoinDesk", "CoinGecko", "CoinMarketCap",
        "Lookonchain", "OnchainLens", "SolidityScan", "PeckShieldAlert", "ZeroShadow", "TRM",
        "Chainalysis", "Elliptic", "Arkham", "Nansen", "Bitquery", "Hacken", "Immunefi",
        "SEAL", "OpenZeppelin", "TheBlock", "DLNews", "Bubblemaps",
    )
)

_ORG_WORDS = frozenset(
    """research labs lab foundation capital exchange network protocol finance financial group
    holdings bank markets market security securities commission department office ministry police
    court council agency bureau authority service services team company corp corporation inc ltd
    llc partners ventures fund trust university institute association alliance coalition times
    news post journal daily report wire media digest insights intelligence analytics chain wallet
    bridge dao token coin street square avenue valley city county state republic kingdom island
    islands creek hill park road global international digital technologies technology tech systems
    solutions industries energy mining pay payments studio studios games gaming club fc act bill
    law rule index ai treasury commerce live core cash bitcoin ethereum solana crypto swap defi
    dex nft web3 stake protocol perps lend""".split()
)
_ORG_PHRASES = frozenset({"morgan stanley", "charles schwab", "grant thornton", "paul hastings", "kelly services"})
_PLACES = frozenset(
    """korea china russia america states kingdom york francisco kong arabia emirates africa europe
    asia japan iran israel india brazil argentina mexico canada australia singapore dubai abu dhabi
    zealand ireland germany france spain italy turkey ukraine poland netherlands switzerland thailand
    vietnam philippines indonesia malaysia nigeria kenya taiwan seoul tokyo london paris berlin
    moscow beijing shanghai washington california texas florida delaware virginia carolina jersey
    angeles vegas miami chicago boston atlanta denver seattle portland cayman bahamas bermuda
    seychelles panama cyprus malta gibraltar estonia lithuania latvia czech slovakia hungary romania
    bulgaria serbia croatia greece portugal sweden norway denmark finland iceland austria belgium
    luxembourg liechtenstein monaco qatar bahrain kuwait oman pakistan bangladesh lanka nepal
    cambodia myanmar laos mongolia kazakhstan uzbekistan armenia azerbaijan egypt morocco tunisia
    algeria ghana ethiopia uganda tanzania rwanda zambia zimbabwe angola colombia venezuela peru
    chile ecuador bolivia paraguay uruguay cuba jamaica haiti dominican rica salvador guatemala
    honduras nicaragua north south east west central korean chinese russian american japanese
    french german british indian brazilian iranian israeli turkish ukrainian thai vietnamese
    filipino australian canadian mexican argentine nigerian emirati saudi""".split()
)
# Title-case verbs and function words that end a name in a headline.
_NAME_STOP = frozenset(
    """says said warns claims buys sells faces calls urges admits denies is was has had to and of
    in on at for with backs joins leaves returns pleads charged arrested sentenced sues sued the a
    an as after over from by but or told wants will would could may might gets got makes made sees
    seen bets slams blasts praises hits takes steps resigns launches unveils reveals files asks
    plans set sets named names loses wins won lost drops dropped adds added cuts pushes eyes tells
    just now also still""".split()
)
_HYPHEN_SUFFIX = re.compile(
    r"-(?:backed|linked|led|owned|based|affiliated|tied|funded|founded|run|related|style|era|"
    r"inspired|branded|connected|controlled)$",
    re.IGNORECASE,
)

_NAME_TOKEN = r"[A-Z][a-zÀ-ſ]+(?:[-'’][A-Za-zÀ-ſ]+)*"
_PARTICLE = r"(?:(?:de|van|von|der|den|da|di|du|le|la|bin|al|el|dos|das)\s+)?"
_ROLE_CUES = (
    r"ceo|cto|coo|cfo|founder|co-founder|cofounder|chief executive|chairman|chairwoman|"
    r"president|director|developer|researcher|investigator|sleuth|analyst|hacker|attacker|"
    r"suspect|defendant|plaintiff|lawyer|attorney|prosecutor|judge|senator|sen\.|rep\.|"
    r"representative|minister|official|spokesperson|spokesman|spokeswoman|trader|influencer|"
    r"streamer|youtuber|billionaire|entrepreneur|executive|employee|engineer|victim|investor|"
    r"whale|programmer|scammer|fraudster|administrator|governor|commissioner|chairperson|"
    r"secretary|mayor|agent|detective|inspector|officer|journalist|reporter|podcaster|rapper|"
    r"actor|singer|athlete|arrested|charged|indicted|sentenced|extradited|identified as|"
    r"nicknamed|alias|aka"
)
_ROLE_NAME = re.compile(
    rf"\b(?i:{_ROLE_CUES})\s+({_NAME_TOKEN}(?:\s+{_PARTICLE}{_NAME_TOKEN}){{1,2}})"
)
_ROLE_HANDLE = re.compile(
    r"\b(?i:investigator|sleuth|researcher|analyst|influencer|trader|kol|streamer)"
    r"\s+(@[A-Za-z0-9_]{3,}|[A-Za-z0-9_]*(?:[a-z][A-Z]|\d)[A-Za-z0-9_]*)"
)
_FIRST_NAME = re.compile(
    rf"\b([A-Z][a-z]+)((?:\s+[A-Z]\.)?(?:\s+{_PARTICLE}{_NAME_TOKEN}){{1,2}})"
)
_HONORIFIC = re.compile(r"\b(?:Mr|Mrs|Ms|Dr|Sir|Dame|Lord|Lady)\.?\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?")
_AGE = re.compile(rf"\b({_NAME_TOKEN}\s+{_NAME_TOKEN}),\s+(?:aged\s+)?\d{{2}},")
_SPEECH = re.compile(
    rf"\b({_NAME_TOKEN}\s+{_NAME_TOKEN})\s+(?:said|says|told|wrote|tweeted|posted|argued|argues|"
    r"warned|warns|claimed|claims|denied|denies|admitted|admits|pleaded|testified)\b"
)
_ACCORDING = re.compile(rf"\baccording to\s+({_NAME_TOKEN}\s+{_NAME_TOKEN})\b")
_KNOWN = re.compile(
    r"(?<![A-Za-z0-9])@?(?:" + "|".join(map(re.escape, KNOWN_INDIVIDUAL_TOKENS)) + r")(?![A-Za-z0-9])"
)
_POSSESSIVE = re.compile(r"['’]s$")

# A lone capitalised word before a speech verb ("Saylor says", "according to Saylor") is taken for a surname unless it
# is a known organisation, a place, an org word, or one of these common capitalised words.
_SPEECH_VERBS = (r"said|says|told|tells|wrote|writes|tweeted|posted|argued|argues|warned|warns|claimed|claims|denied|"
                 r"denies|admitted|admits|testified|added|explained|explains|noted|stated|insisted|insists|believes|thinks")
_LONE_SPEECH = re.compile(
    rf"(?<![\w@#\[\]'’.-])({_NAME_TOKEN})(?:['’]s)?\s+(?:(?i:also|later|previously|then|now|has|had|once|reportedly)\s+)?"
    rf"(?i:{_SPEECH_VERBS})\b"
)
_LONE_ACCORDING = re.compile(rf"\b(?i:according to)\s+({_NAME_TOKEN})\b(?!\s+[A-Z])")
# Pseudonyms of individuals: "coordinated by Kruw", "an entity called Kruw", "a hacker known as X".
_PSEUDONYM = re.compile(
    r"\b(?i:coordinated by|orchestrated by|masterminded by|organi[sz]ed by|"
    r"(?:an?\s+|the\s+)?(?:entity|actor|person|individual|user|account|figure|hacker|attacker|operator|scammer|"
    r"developer|insider|suspect|perpetrator|exploiter|trader|whale|influencer|persona|handle)\s+"
    r"(?:called|named|known as|dubbed|nicknamed|going by|who goes by|calling (?:himself|herself|themselves|itself))|"
    r"nicknamed|a\.?k\.?a\.?|alias|goes by|going by|under the (?:name|alias|handle|moniker|pseudonym))"
    r"\s+[\"'“‘]?(@?[A-Za-z0-9_][A-Za-z0-9_.-]{1,30})"
)
_COMMON_CAPITALISED = frozenset(
    """he she it they we i you this that these those there here who which what someone everyone nobody one some many
    most few several both each others another police officials official prosecutors investigators investigator
    researchers researcher analysts analyst experts expert reports report sources source authorities authority
    regulators regulator users user victims victim developers developer founders founder executives executive
    spokesperson spokesman spokeswoman company firm exchange protocol project team platform court judge statement
    filing lawsuit complaint data research analysis study survey post blog update notice community members member
    attackers attacker hackers hacker scammers scammer customers customer holders holder investors investor
    lawmakers lawmaker government ministry agency department office bank banks partner partners management staff
    employees employee insiders insider people person nobody everybody anyone critics critic observers observer
    reuters bloomberg cnbc forbes fortune axios politico wired verge techcrunch coindesk cointelegraph decrypt
    blockworks protos rekt theblock defiant chainalysis elliptic trm certik slowmist peckshield cyvers hacken
    immunefi zeroshadow scamsniffer misttrack arkham nansen lookonchain bubblemaps defillama
    binance coinbase kraken okx bybit upbit bithumb bitget kucoin gemini bitstamp bitfinex huobi htx gate mexc
    crypto robinhood tether circle ripple ledger trezor metamask phantom exodus trust rabby safe gnosis uniswap
    aave curve compound lido maker sky chainlink polygon arbitrum optimism base avalanche cardano polkadot cosmos
    tron near aptos sui ton solana ethereum bitcoin hyperliquid lighter jupiter raydium pump strategy microstrategy
    blackrock fidelity grayscale paypal visa mastercard stripe google microsoft apple amazon meta openai anthropic
    telegram discord twitter whatsapp signal github npm cloudflare fbi doj sec cftc treasury europol interpol
    congress senate parliament""".split()
)


def _clean_tokens(tokens):
    """Trim trailing stop words; cut at '-backed'-style suffixes. Returns (tokens, suffix_cut)."""
    out = []
    for token in tokens:
        if _HYPHEN_SUFFIX.search(token):
            out.append(token[: token.rfind("-")])
            return out, True
        out.append(token)
    while out and out[-1].lower().strip(".,") in _NAME_STOP:
        out.pop()
    return out, False


def _plain(token):
    return _POSSESSIVE.sub("", token).lower().strip(".,")


def _looks_like_person(tokens, need_first_name=False):
    if len(tokens) < 2:
        return False
    plain = [_plain(t) for t in tokens]
    if " ".join(plain) in _ORG_PHRASES or any(p in _ORG_WORDS for p in plain):
        return False
    if plain[0] in _PLACES or plain[-1] in _PLACES:
        return False
    if need_first_name and plain[0] not in FIRST_NAMES:
        return False
    return True


def _span_end(text, start, tokens):
    pos = start
    for token in tokens:
        found = text.find(token, pos)
        if found < 0:
            return None
        pos = found + len(token)
    return pos


def _replace_names(pattern, text, group, need_first_name=False, single=False):
    out, pos, count = [], 0, 0
    for match in pattern.finditer(text):
        start = match.start(group)
        if start < pos:
            continue
        raw = match.group(group)
        if single:
            if raw.lower().lstrip("@") in SAFE_HANDLES or len(raw.lstrip("@")) < 3:
                continue
            tokens = [raw]
        else:
            tokens, _ = _clean_tokens(raw.split())
            if not _looks_like_person(tokens, need_first_name):
                continue
        end = _span_end(text, start, tokens)
        if end is None:
            continue
        possessive = _POSSESSIVE.search(tokens[-1])
        if possessive:
            end -= len(possessive.group(0))
        out.append(text[pos:start])
        out.append(PERSON)
        pos = end
        count += 1
    out.append(text[pos:])
    return "".join(out), count


def _title_case(text):
    """Headline-style capitalisation: most longer words start with a capital."""
    words = [w for w in re.findall(r"[A-Za-z][A-Za-z'\u2019-]*", text)[1:] if len(w) >= 4]
    if len(words) < 4 or len(text) > 240:
        return False
    return sum(1 for w in words if w[0].isupper()) / len(words) >= 0.6


def _known_word(word, known):
    plain = _plain(word).lstrip("@")
    return (plain in known or plain in SAFE_HANDLES or plain in _ORG_WORDS or plain in _PLACES
            or plain in _COMMON_CAPITALISED or plain in _NAME_STOP)


def _replace_lone(pattern, text, known, need_shape=False):
    """Replace group 1 of each match unless it is a known organisation or a common word. need_shape: the token must
    look like a name or handle (capitalised, @, digits, underscores or mixed case), not a plain lower-case word."""
    out, pos, count = [], 0, 0
    for match in pattern.finditer(text):
        start = match.start(1)
        if start < pos:
            continue
        raw = match.group(1).rstrip(".-")
        if not raw or _known_word(raw, known) or "named person" in raw:
            continue
        if need_shape and not (raw[0].isupper() or raw[0] == "@" or re.search(r"[0-9_]|[a-z][A-Z]", raw)):
            continue
        if len(raw.lstrip("@")) < 3:
            continue
        end = start + len(raw)
        out.append(text[pos:start])
        out.append(PERSON)
        pos = end
        count += 1
    out.append(text[pos:])
    return "".join(out), count


def redact_people(text, known=None):
    """Return (text, number_of_new_redactions). known: lower-case names of organisations and protocols seen in
    this run (incident-database records, source publishers), never taken for a person when alone before "says"."""
    if not text:
        return text, 0
    known = frozenset(k.lower() for k in (known or ()) if k)
    total = 0
    text, n = _KNOWN.subn(PERSON, text)
    total += n
    text, n = _HONORIFIC.subn(PERSON, text)
    total += n
    # In a Title Case headline every word is capitalised, so a capitalised pair is
    # only taken for a name when it starts with a known given name.
    strict = _title_case(text)
    for pattern, kwargs in (
        (_ROLE_NAME, {"need_first_name": strict}),
        (_ROLE_HANDLE, {"single": True}),
        (_AGE, {"need_first_name": strict}),
        (_SPEECH, {"need_first_name": strict}),
        (_ACCORDING, {"need_first_name": strict}),
    ):
        text, n = _replace_names(pattern, text, 1, **kwargs)
        total += n
    text, n = _replace_first_names(text)
    total += n
    # lone surnames and pseudonyms: "Saylor says", "according to Saylor", "coordinated by Kruw"
    text, n = _replace_lone(_LONE_SPEECH, text, known)
    total += n
    text, n = _replace_lone(_LONE_ACCORDING, text, known)
    total += n
    text, n = _replace_lone(_PSEUDONYM, text, known, need_shape=True)
    total += n
    text = re.sub(r"(?:\[named person\]\s*){2,}", PERSON + " ", text)
    text = re.sub(r"\[named person\] (?=[.,;:!?)])", PERSON, text)
    return text, total


def _replace_first_names(text):
    out, pos, count = [], 0, 0
    for match in _FIRST_NAME.finditer(text):
        start = match.start(1)
        if start < pos:
            continue
        tokens, _ = _clean_tokens([match.group(1)] + match.group(2).split())
        if not _looks_like_person(tokens, need_first_name=True):
            continue
        end = _span_end(text, start, tokens)
        if end is None:
            continue
        possessive = _POSSESSIVE.search(tokens[-1])
        if possessive:
            end -= len(possessive.group(0))
        out.append(text[pos:start])
        out.append(PERSON)
        pos = end
        count += 1
    out.append(text[pos:])
    return "".join(out), count


_HEX_ADDR = re.compile(r"\b0x[0-9a-fA-F]{8,}\b")
_LONG_HEX = re.compile(r"\b[0-9a-fA-F]{40,}\b")
_B58 = re.compile(
    r"\b(?=[1-9A-HJ-NP-Za-km-z]*\d)(?=[1-9A-HJ-NP-Za-km-z]*[A-Za-z])[1-9A-HJ-NP-Za-km-z]{32,44}\b"
)
_BACKTICK = re.compile(r"`[^`\n]{1,200}`")
_FUNC_CALL = re.compile(
    r"\b[A-Za-z_][A-Za-z0-9_]*\((?:\s*|[^()\n]{0,80}(?:,|\b(?:u?int\d*|address|bytes\d*|bool|"
    r"string|calldata|memory)\b)[^()\n]{0,80})\)"
)
_CAMEL = re.compile(r"\b[a-z]{3,}(?:[A-Z][a-z0-9]+)+[A-Za-z0-9]*\b")
_SNAKE = re.compile(r"\b[a-z][a-z0-9]*_[a-z0-9_]*[a-z0-9]\b")


def redact_code(text):
    """Return (text, count) without addresses, hashes, code spans or function names."""
    if not text:
        return text, 0
    count = 0
    for pattern, repl in (
        (_BACKTICK, CODE),
        (_HEX_ADDR, ADDRESS),
        (_LONG_HEX, ADDRESS),
        (_B58, ADDRESS),
        (_FUNC_CALL, CODE),
        (_CAMEL, CODE),
        (_SNAKE, CODE),
    ):
        text, n = pattern.subn(repl, text)
        count += n
    return text, count


def sanitize(text, known=None):
    """Names and code removed. Returns (text, {'names': n, 'code': n})."""
    text, names = redact_people(text, known)
    text, code = redact_code(text)
    return text, {"names": names, "code": code}


_PRICE = re.compile(
    r"\b(?:price|prices|priced|rall(?:y|ies|ied)|surg(?:e|es|ed|ing)|plung(?:e|es|ed|ing)|"
    r"soar(?:s|ed|ing)?|tumbl(?:e|es|ed|ing)|crash(?:es|ed|ing)?|pump(?:s|ed|ing)?(?!\.fun)|"
    r"dump(?:s|ed|ing)?|bullish|bearish|buy the dip|all-time high|market cap|"
    r"collaps(?:e|es|ed)\s+\d+%|\d+(?:\.\d+)?%\s+(?:drop|fall|gain|rise|jump|slide|plunge)|"
    r"(?:fell|rose|dropped|jumped|slid|sank)\s+\d+(?:\.\d+)?%|price target|"
    r"investment advice|buy signal|sell signal)\b",
    re.IGNORECASE,
)


def price_talk(text):
    return bool(_PRICE.search(text or ""))


_LEGAL = re.compile(
    r"\b(alleg\w*|charged|indict\w*|arrest\w*|lawsuit|sued|sues|plaintiff\w*|defendant\w*|"
    r"accus\w*|prosecut\w*|sentenc\w*|convict\w*|guilty|extradit\w*|forfeiture|seiz\w*|"
    r"subpoena\w*|class action|court order|freezing order|criminal complaint|civil complaint)\b",
    re.IGNORECASE,
)


def legal_terms(text):
    return sorted({m.group(1).lower() for m in _LEGAL.finditer(text or "")})


_STRONG_HEDGE = re.compile(
    r"\b(suspected|apparent(?:ly)?|possible|possibly|potential(?:ly)?|unconfirmed|may have|"
    r"might have|investigating|appears to|seems to|unverified|rumou?r(?:s|ed)?|alleged(?:ly)?|"
    r"anomal(?:y|ies|ous))\b",
    re.IGNORECASE,
)


def strong_hedge(text):
    """The first strong hedge word in text (lower-case), or None."""
    match = _STRONG_HEDGE.search(text or "")
    return match.group(1).lower() if match else None


_STEPS = re.compile(r"(?im)^\s*(?:\d+[.)]\s|step\s*\d+|first,\s|then,\s|next,\s|finally,\s)")
_SPECULATION = re.compile(
    r"\b(probably|likely|we think|we believe|insider job|inside job|must have|surely|"
    r"clearly a scam|definitely)\b",
    re.IGNORECASE,
)


def check_generated(text):
    """Problems in text the radar generated itself (expected to be empty)."""
    problems = []
    if not text:
        return problems
    if redact_people(text)[1]:
        problems.append("contains a personal name")
    if redact_code(text)[1]:
        problems.append("contains code, an address or a function name")
    if price_talk(text):
        problems.append("contains price or investment talk")
    if _STEPS.search(text):
        problems.append("looks like a step list")
    if _SPECULATION.search(text):
        problems.append("contains speculation")
    return problems
