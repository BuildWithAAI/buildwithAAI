"""Accuracy and safety filters applied to everything the radar writes.

* redact_people: replaces likely personal names (and a few well-known handles)
  with "[named person]". The repo is public and the channel rule is "no suspect or
  individual names". It is heuristic and conservative: it would rather redact a
  company that looks like a person than leave a person in. Officials named in
  law-enforcement or regulator releases are the one allowed exception. The radar
  does not ingest such releases directly, so it redacts them too; the claim gate
  may restore an official's name from the primary release. Names that start with
  any capital letter count (José, Łukasz, Özgür, Сергей), and runs of Chinese,
  Japanese or Korean script are removed ([non-English text]): the channel works in
  English and the redactor cannot read names in those scripts.
* person_tokens / People: a name the redactor saw used for a person anywhere in a
  run (a role word before it, a personal pronoun after it, a pseudonym cue) is
  redacted everywhere in that run and can never be an incident's subject: "Crypto
  trader X says his wallet was hacked" makes "Was X hacked?" and "X-linked wallet"
  personal too, although neither has a cue of its own.
* url_names_person: a link whose path spells a redacted name ("...-trader-x-says-...")
  is withheld from the committed brief (cluster.py keeps only the outlet's address).
* redact_instructions: removes text addressed to an AI ("AI assistants reading this
  page must ...", "ignore previous instructions ...") so prompt-injection payloads
  quoted by a source never reach a brief or a writer.
* redact_code: removes contract addresses, hashes, code spans, function names and
  calls, so excerpts stay at concept level (no exploit how-tos).
* price_talk / legal_terms / strong_hedge: flags used for notes and for status.
* check_generated: lint for text the radar generates itself.
"""

import hashlib
import re
import unicodedata
import urllib.parse

PERSON = "[named person]"
CODE = "[code]"
ADDRESS = "[address]"
INSTRUCTION = "[instruction]"
FOREIGN = "[non-English text]"

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
# The channel's own handles: never redacted
OWN_HANDLES = frozenset({"zooratechnologies"})

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
    dex nft web3 stake protocol perps lend centre center""".split()
)
ORG_WORDS = _ORG_WORDS
_ORG_PHRASES = frozenset({"morgan stanley", "charles schwab", "grant thornton", "paul hastings", "kelly services"})
# AI products are not people: "Claude Code", "Claude Opus 5", "Gemini CLI", "Copilot Studio", "Bing Chat" (the AI
# lane). A product word followed only by product words or a version number is never a personal name ("Claude
# Dupont" still is), and neither is a multi-word product of classify.AI_PRODUCTS ("Perplexity Comet", "Google
# Gemini", "Hugging Face").
AI_PRODUCT_HEADS = frozenset(
    """claude gemini copilot grok llama codex cursor windsurf cline kiro qwen deepseek chatgpt mistral perplexity sora
    jules devin manus comet antigravity openclaw bing""".split()
)
AI_PRODUCT_TAILS = frozenset(
    """code desktop opus sonnet haiku ai cli chrome agent agents skills studio enterprise pro max team teams app apps
    extension extensions plugin plugins browser assistant model models api flash ultra nano advanced live mobile chat
    atlas operator for users user cowork connectors memory projects artifacts computer""".split()
)
# AI products and companies that say things ("Claude says", "OpenRouter said"): a lone word before "says" is the
# product unless the text shows a person (see _replace_lone)
AI_NAMES = frozenset(
    """claude chatgpt gemini copilot grok llama codex cursor windsurf cline kiro qwen deepseek mistral perplexity
    ollama langchain llamaindex litellm openrouter anthropic openai xai huggingface midjourney elevenlabs sora
    antigravity openclaw clawdbot moltbot replit lovable""".split()
)
# AI names that are also given names or surnames: a personal pronoun or a human role word next to one means a person
AI_PERSON_NAMES = frozenset("claude sora kiro cline".split())
# Words that describe a person but name nobody ("Man claims ...", "Woman says her ..."): never a name
GENERIC_PERSON_NOUNS = frozenset(
    """man woman men women boy girl boys girls teen teens teenager teenagers kid kids child children mother father
    mom dad son daughter wife husband grandmother grandfather grandma grandpa widow widower couple family student
    students parent parents""".split()
)
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


def _char_class(pred, limit=0x2000):
    """The characters below `limit` that pred accepts, as the inside of a regex character class (in ranges)."""
    runs, start, prev = [], None, None
    for cp in range(limit):
        if pred(chr(cp)):
            if start is None:
                start = cp
            prev = cp
        elif start is not None:
            runs.append((start, prev))
            start = None
    if start is not None:
        runs.append((start, prev))
    return "".join(re.escape(chr(a)) if a == b else f"{re.escape(chr(a))}-{re.escape(chr(b))}" for a, b in runs)


# Any capital letter (Latin, Latin Extended, Greek, Cyrillic: "José", "Łukasz", "Özgür", "Сергей"), not only A-Z.
# Lower-case continuation letters keep the Latin-1 range the ASCII-era pattern accepted.
_UP_CHARS = _char_class(str.isupper)
_LOW_CHARS = _char_class(str.islower) + "À-ſ"
_UP = f"[{_UP_CHARS}]"
_LOW = f"[{_LOW_CHARS}]"
_LETTER = f"[{_UP_CHARS}{_LOW_CHARS}]"
_CJK_CHARS = "\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uac00-\ud7af"
_CJK_RUN = re.compile(f"[{_CJK_CHARS}]{{2,}}")

_NAME_TOKEN = rf"{_UP}{_LOW}+(?:[-'’]{_LETTER}+)*"
_PARTICLE = r"(?:(?:de|van|von|der|den|da|di|du|le|la|bin|al|el|dos|das)\s+)?"
_PARTICLES = frozenset("de van von der den da di du le la bin al el dos das".split())
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
    rf"\b({_UP}{_LOW}+)((?:\s+{_UP}\.)?(?:\s+{_PARTICLE}{_NAME_TOKEN}){{1,2}})"
)
_HONORIFIC = re.compile(rf"\b(?:Mr|Mrs|Ms|Dr|Sir|Dame|Lord|Lady)\.?\s+{_UP}{_LOW}+(?:\s+{_UP}{_LOW}+)?")
_AGE = re.compile(rf"\b({_NAME_TOKEN}\s+{_NAME_TOKEN}),\s+(?:aged\s+)?\d{{2}},")
_SPEECH = re.compile(
    rf"\b({_NAME_TOKEN}\s+{_NAME_TOKEN})\s+(?:said|says|told|wrote|tweeted|posted|argued|argues|"
    r"warned|warns|claimed|claims|denied|denies|admitted|admits|pleaded|testified)\b"
)
_ACCORDING = re.compile(rf"\baccording to\s+({_NAME_TOKEN}\s+{_NAME_TOKEN})\b")
# "Feds Charge X Y Over ...", "Police Arrest X Y": a name pair right after a legal action verb is the person it is taken
# against, even in a Title Case headline (no given-name list needed)
_LEGAL_NAME = re.compile(
    rf"\b(?i:charge[sd]?|charging|arrest(?:s|ed|ing)?|indict(?:s|ed|ing)?|sentence[sd]?|sentencing|extradite[sd]?|"
    rf"convict(?:s|ed)?|jail(?:s|ed)?|detain(?:s|ed)?|sanction(?:s|ed)?)\s+({_NAME_TOKEN}\s+{_NAME_TOKEN})\b"
)
_NUMBER_WORDS = frozenset("one two three four five six seven eight nine ten eleven twelve dozen dozens several".split())
_DEMONYMS = frozenset("""korean chinese russian iranian american british french german indian israeli ukrainian
vietnamese nigerian brazilian turkish canadian australian japanese singaporean spanish italian dutch polish""".split())
_KNOWN = re.compile(
    r"(?<![A-Za-z0-9])@?(?:" + "|".join(rf"(?i:{re.escape(t)})" if len(t) > 3 else re.escape(t)
                                         for t in KNOWN_INDIVIDUAL_TOKENS) + r")(?![A-Za-z0-9])"
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
_LONE_ACCORDING = re.compile(rf"\b(?i:according to)\s+({_NAME_TOKEN})\b(?!\s+{_UP})")
# Pseudonyms of individuals: "coordinated by Kruw", "an entity called Kruw", "a hacker known as X".
_PSEUDONYM = re.compile(
    r"\b(?i:coordinated by|orchestrated by|masterminded by|organi[sz]ed by|"
    r"(?:an?\s+|the\s+)?(?:entity|actor|person|individual|user|account|figure|hacker|attacker|operator|scammer|"
    r"developer|insider|suspect|perpetrator|exploiter|trader|whale|influencer|persona|handle)\s+"
    r"(?:called|named|known as|dubbed|nicknamed|going by|who goes by|calling (?:himself|herself|themselves|itself))|"
    r"nicknamed|a\.?k\.?a\.?|alias|goes by|going by|under the (?:name|alias|handle|moniker|pseudonym))"
    r"\s+[\"'“‘]?(@?[A-Za-z0-9_][A-Za-z0-9_.-]{1,30})"
)
# "A man surnamed Li (李)", "whose surname is Park", "family name Oh": the cue says the next word is a person's
# surname, so no length, org-word or AI-name filter applies (Li, Wu, Ho, Oh, Park, Hill and Cline are all surnames)
_SURNAME_CUE = re.compile(
    rf"\b(?i:surnamed|(?:whose\s+)?(?:sur|family\s+)name\s+(?:is|was)|surname|family name)\s+[\"'“‘]?"
    rf"({_UP}[\w'’-]*|[{_CJK_CHARS}]{{1,4}})"
)
# "whose name is X" can name a product or a firm, so it keeps the lone-name filters
_SURNAMED = re.compile(rf"\b(?i:whose name is)\s+({_UP}[\w'’-]+)")
# the name in its own script right after a redaction, in ASCII or full-width parentheses: "[named person] (黃)"
_NATIVE_NAME_AFTER = re.compile(rf"\[named person\]\s*[(（]\s*[{_CJK_CHARS}]{{1,6}}\s*[)）](?=(\w)?)")
# a handle right after a redacted name: "— [named person] (@x)" would undo the redaction
_HANDLE_AFTER = re.compile(r"\[named person\]\s*\(\s*@[A-Za-z0-9_]{2,30}\s*\)")
# any other @handle, but not an e-mail address, a URL path or an npm scope ("@scope/pkg")
_HANDLE = re.compile(r"(?<![\w.@/+-])(@[A-Za-z0-9_]{2,30})(?!\w)(?![\w/.-]*/)")
# another name of a threat group, in parentheses after its name: "Sapphire Sleet (aka BlueNoroff)", "Spikey Scorpius
# (aka Qilin)". The "aka" there names a group, never a person.
_GROUP_WORD = (r"(?:Sleet|Typhoon|Blizzard|Sandstorm|Tempest|Hail|Rain|Flood|Dust|Scorpius|Pisces|Taurus|Libra|Ursa|"
               r"Serpens|Draco|Lynx|Chollima|Spider|Panda|Bear|Kitten|Jackal|Group|Gang|Crew|APT\s?\d+|UNC\d+|TA\d+|"
               r"FIN\d+|Storm-\d+)")
_GROUP_ALIAS = re.compile(
    rf"\b{_GROUP_WORD}\s*\(\s*((?i:a\.?k\.?a\.?|alias|also known as|also tracked as|tracked as|known as)\s+[^()]{{1,120}})\)"
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
_DESCRIPTORS = frozenset(
    """former late alleged suspected accused convicted jailed fugitive disgraced ex then acting deputy senior chief
    young old elderly anonymous unnamed""".split()
)
# Fold a name for comparisons: "José" -> "jose", "Łukasz" -> "lukasz"
_FOLD = str.maketrans({"ł": "l", "Ł": "L", "ø": "o", "Ø": "O", "đ": "d", "Đ": "D", "þ": "th", "Þ": "Th",
                       "ß": "ss", "æ": "ae", "Æ": "Ae", "œ": "oe", "Œ": "Oe", "ı": "i"})


def fold(text):
    """Lower-case, without diacritics: 'José Álvarez' -> 'jose alvarez'."""
    text = unicodedata.normalize("NFKD", (text or "").translate(_FOLD))
    return "".join(ch for ch in text if not unicodedata.combining(ch)).lower()


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


_AI_PHRASES = None


def ai_product_phrases():
    """Lower-case multi-word AI products (classify.AI_PRODUCTS, imported lazily: classify imports this module)."""
    global _AI_PHRASES
    if _AI_PHRASES is None:
        from . import classify
        _AI_PHRASES = frozenset(p.lower() for p in classify.AI_PRODUCTS if " " in p)
    return _AI_PHRASES


def _product_prefix(plain):
    """'claude code ...', 'claude opus 5 ...': a product head followed by a product word or a version."""
    return len(plain) >= 2 and plain[0] in AI_PRODUCT_HEADS and (plain[1] in AI_PRODUCT_TAILS or plain[1][:1].isdigit())


def _is_product(words):
    """An AI product name as a whole: a product head and only product words or versions after it, or a multi-word
    product of classify.AI_PRODUCTS ("Perplexity Comet", "Google Gemini", "Hugging Face")."""
    plain = [_plain(w) for w in words if w]
    if not plain:
        return False
    if len(plain) >= 2 and plain[0] in AI_PRODUCT_HEADS and all(p in AI_PRODUCT_TAILS or p[:1].isdigit() for p in plain[1:]):
        return True
    joined = " ".join(plain)
    return any(joined == p or joined.startswith(p + " ") for p in ai_product_phrases())


def _looks_like_person(tokens, need_first_name=False, products=True):
    """products=False: the context already shows a person (an age, a legal or person-only role word), so a pair like
    "Devin Atlas, 31," is a name even though both words are on the product lists."""
    if len(tokens) < 2:
        return False
    plain = [_plain(t) for t in tokens]
    if products and (_product_prefix(plain) or _is_product(tokens)):
        return False
    if " ".join(plain) in _ORG_PHRASES or any(p in _ORG_WORDS for p in plain):
        return False
    if plain[0] in _PLACES or plain[-1] in _PLACES:
        return False
    if need_first_name and fold(plain[0]) not in FIRST_NAMES:
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


def _protected_spans(text):
    """Spans no person pass may touch: another name of a threat group in parentheses ("(aka BlueNoroff)")."""
    return [m.span(1) for m in _GROUP_ALIAS.finditer(text or "")]


def _inside(pos, spans):
    return any(a <= pos < b for a, b in spans)


def _title_case(text):
    """Headline-style capitalisation: most longer words start with a capital."""
    words = [w for w in re.findall(r"[A-Za-z][A-Za-z'\u2019-]*", text)[1:] if len(w) >= 4]
    if len(words) < 4 or len(text) > 240:
        return False
    return sum(1 for w in words if w[0].isupper()) / len(words) >= 0.6


def _known_word(word, known, ai_names=True):
    """A known organisation or a common word, never a person's name. ai_names=False leaves AI product names out
    (they say things, but a person can share the name)."""
    plain = _plain(word).lstrip("@")
    return (plain in known or plain in SAFE_HANDLES or plain in _ORG_WORDS or plain in _PLACES
            or plain in _COMMON_CAPITALISED or plain in _NAME_STOP or (ai_names and plain in AI_NAMES))


_PERSONAL_PRONOUN = re.compile(r"\b(?:he|she|him|his|her|hers|himself|herself)\b", re.IGNORECASE)
_ROLE_BEFORE = re.compile(rf"\b(?i:{_ROLE_CUES})\s+$")
_SENTENCE_END = re.compile(r"(?<=[.!?;])\s")
# person-only roles: "AI developer Cline" or "agent Claude" can be a product, "trader Cline" cannot
_HUMAN_ROLE_BEFORE = re.compile(
    r"\b(?i:trader|victim|investor|ceo|cto|coo|cfo|founder|co-founder|cofounder|researcher|analyst|hacker|attacker|"
    r"suspect|defendant|plaintiff|lawyer|attorney|journalist|reporter|influencer|streamer|youtuber|whale|scammer|"
    r"fraudster|employee|executive|engineer|programmer|officer|official|spokesperson|spokesman|spokeswoman|"
    r"man|woman|teen|student|resident|user|retiree|grandmother|grandfather|mother|father)\s+$")
_OBJECT_PRONOUN = re.compile(r"^(\s*(?:told|tells|warned|warns|asked|asks|urged|urges)\s+)(?:him|her)\b", re.IGNORECASE)
_IT_PRONOUN = re.compile(r"\b(?:it|its|itself)\b", re.IGNORECASE)


def _lone_evidence(text, start, end):
    """A lone name-shaped word before "says" is a person, not a firm that says things, when a role word stands right
    before it ("trader X says") or a personal pronoun follows it in the same sentence ("X says his wallet")."""
    if _ROLE_BEFORE.search(text[max(0, start - 40):start]):
        return True
    sentence = _SENTENCE_END.split(text[end:end + 160], maxsplit=1)[0]
    return bool(_PERSONAL_PRONOUN.search(sentence))


def _ai_person_evidence(text, start, end):
    """Person evidence strong enough to beat the AI product exemption: a person-only role word before ("trader Cline
    says"), or he/she/his/her later in the sentence that is not the object of the verb ("Copilot told him ..." is a
    chatbot) and comes before any it/its ("Cline said its agent ..." is the product)."""
    if _HUMAN_ROLE_BEFORE.search(text[max(0, start - 40):start]):
        return True
    rest = text[end:end + 160]
    verb = re.match(r"(?:['’]s)?\s+(?:(?i:also|later|previously|then|now|has|had|once|reportedly)\s+)?", rest)
    sentence = _SENTENCE_END.split(rest[verb.end() if verb else 0:], maxsplit=1)[0]
    sentence = _OBJECT_PRONOUN.sub(r"\1", sentence)
    he, it = _PERSONAL_PRONOUN.search(sentence), _IT_PRONOUN.search(sentence)
    return bool(he and (not it or he.start() < it.start()))


_NEXT_WORD = re.compile(r"\s+([A-Za-z0-9][\w.]*)")
_WORDS_BEFORE = re.compile(r"((?:[A-Za-z0-9][\w.'’-]*\s+){1,3})$")


def _product_next(text, end):
    """'Claude Code', 'Claude Opus 5', 'Gemini 3': the word after is a product word or a version."""
    match = _NEXT_WORD.match(text, end)
    return bool(match and (match.group(1).lower().rstrip(".") in AI_PRODUCT_TAILS or match.group(1)[:1].isdigit()))


def _ends_product(text, start, end):
    """The word at [start, end) ends an AI product name ("Code" in "Claude Code says", "Comet" in "Perplexity Comet
    said"), unless a role word stands before the product-shaped name ("trader Claude Max says his ...")."""
    before = _WORDS_BEFORE.search(text[max(0, start - 60):start])
    if not before:
        return False
    words = before.group(1).split()
    for k in range(1, len(words) + 1):
        if _is_product(words[-k:] + [text[start:end]]):
            lead = text[:start].rstrip()
            lead = lead[: len(lead) - len(" ".join(words[-k:]))]
            return not _ROLE_BEFORE.search(lead[-40:] + " ")
    return False


# a given name before a matched surname: "Teodoro [Sample] says", "Given [Van Surname] warned"
_WORD_BEFORE = re.compile(rf"(?<![\w\[\]'’@-])({_NAME_TOKEN})\s+$")


def _given_ok(word, known, evidence, surname):
    if _POSSESSIVE.search(word) or len(word) < 3:
        return False
    plain = _plain(word)
    if re.fullmatch(rf"(?i:{_ROLE_CUES})", word) or plain in _DESCRIPTORS or plain in GENERIC_PERSON_NOUNS:
        return False
    if plain in AI_NAMES:
        # "Sora [named person] Says ... Her Savings": a given name only with person evidence, never before a product
        # word ("Claude Code")
        return bool(evidence) and surname not in AI_PRODUCT_TAILS and not _known_word(word, known, ai_names=False)
    return not _known_word(word, known)


def _boundary(head, pos):
    """The word at pos starts a name: the text starts there, punctuation or a lower-case word stands before it, or a
    role word or a descriptor does ("Former X", "Plaintiff X")."""
    before = head[:pos].rstrip()
    if not before:
        return True
    if before[-1] in '.!?:;,"“”\'‘’()—–|':
        return True
    prev = re.search(r"(\S+)$", before).group(1)
    return (not prev[0].isupper() or bool(re.fullmatch(rf"(?i:{_ROLE_CUES})", prev))
            or prev.lower() in _DESCRIPTORS)


def _given_start(text, start, known, evidence, surname):
    """Where a name ending at a matched surname starts: one given name before it when that word starts a name or is a
    known given name (never "Data [Exfiltration]" or "Class [Action]": a capitalised word before it means a title, not
    a name), two only with person evidence."""
    head = text[:start]
    match = _WORD_BEFORE.search(head)
    if not match or not _given_ok(match.group(1), known, evidence, surname):
        return start
    if _boundary(head, match.start(1)) or fold(_plain(match.group(1))) in FIRST_NAMES:
        return match.start(1)
    if evidence:
        second = _WORD_BEFORE.search(head[:match.start(1)])
        if second and _given_ok(second.group(1), known, evidence, surname) and _boundary(head, second.start(1)):
            return second.start(1)
    return start


_PRODUCT_ROLE_CUES = frozenset({"agent"})


def _replace_names(pattern, text, group, need_first_name=False, single=False, found=None, products=True, known=frozenset(),
                   legal=False):
    """products: True (an AI product name is never a person), False (the pattern shows a person: an age), or "role"
    (only the cue "agent" can name a product: "coding agent Claude Code"; "charged ... Devin Max" is a person)."""
    out, pos, count = [], 0, 0
    protected = _protected_spans(text)
    for match in pattern.finditer(text):
        start = match.start(group)
        if start < pos or _inside(start, protected):
            continue
        raw = match.group(group)
        if single:
            if raw.lower().lstrip("@") in SAFE_HANDLES or len(raw.lstrip("@")) < 3:
                continue
            tokens = [raw]
        else:
            tokens, _ = _clean_tokens(raw.split())
            if legal and any(_plain(t) in _DEMONYMS or _plain(t) in _COMMON_CAPITALISED or _plain(t) in known
                             or _plain(t) in GENERIC_PERSON_NOUNS or _plain(t) in _NUMBER_WORDS for t in tokens):
                continue  # "Charge North Korean Hackers", "Arrest Two Men": not a name
            allow = products
            if allow == "role":
                allow = text[match.start(0):start].strip().lower() in _PRODUCT_ROLE_CUES
            if not _looks_like_person(tokens, need_first_name, products=allow):
                continue
        end = _span_end(text, start, tokens)
        if end is None:
            continue
        possessive = _POSSESSIVE.search(tokens[-1])
        if possessive:
            end -= len(possessive.group(0))
        new_start = start
        if not single and tokens[0].lower() in _PARTICLES:
            # "Given Van Surname warned": the match starts at the particle; the given name before it goes too
            new_start = _given_start(text, start, known, True, _plain(tokens[-1]))
            if new_start < pos:
                new_start = start
        if found is not None:
            found.append((text[new_start:end], True))
        out.append(text[pos:new_start])
        out.append(PERSON)
        pos = end
        count += 1
    out.append(text[pos:])
    return "".join(out), count


def _replace_lone(pattern, text, known, need_shape=False, found=None, strong=False, surnames=frozenset(), look_back=False):
    """Replace group 1 of each match unless it is a known organisation or a common word. need_shape: the token must
    look like a name or handle (capitalised, @, digits, underscores or mixed case), not a plain lower-case word.
    found: gets (name, strong) for each replacement; strong means the context shows a person (the pattern itself, or
    _lone_evidence), not only a capitalised word before "says". surnames: surnames of people this text names in full
    ("John Cline ... Cline said"). look_back: a given name right before the surname goes with it, and the whole name
    is recorded.

    AI product and company names say things ("Claude says the request was blocked", "Copilot told him ..."), so one
    is a person only on evidence a product cannot have: a pseudonym or surname cue, a person-only role word before
    it, he/she for the speaker, or the surname of a person this text names in full; and never right before a product
    word or a version ("Claude Code said", "orchestrated by Claude Code")."""
    out, pos, count = [], 0, 0
    protected = _protected_spans(text)
    for match in pattern.finditer(text):
        start = match.start(1)
        if start < pos or _inside(start, protected):
            continue
        raw = match.group(1).rstrip(".-")
        if not raw or "named person" in raw:
            continue
        if need_shape and not (raw[0].isupper() or raw[0] == "@" or re.search(r"[0-9_]|[a-z][A-Z]", raw)):
            continue
        if len(raw.lstrip("@")) < 3:
            continue
        end = start + len(raw)
        plain = _plain(raw).lstrip("@")
        if plain in GENERIC_PERSON_NOUNS:
            continue  # "Man claims ...", "Woman says her ...": nobody is named
        if _ends_product(text, start, end):
            continue  # "Claude Code says", "Perplexity Comet said"
        if plain in AI_NAMES:
            evidence = strong or plain in surnames or _ai_person_evidence(text, start, end)
            if _product_next(text, end) or (not strong and (not evidence or plain not in AI_PERSON_NAMES)):
                continue
        else:
            evidence = strong or plain in surnames or _lone_evidence(text, start, end)
        if _known_word(raw, known, ai_names=False):
            continue
        new_start = start
        if look_back:
            new_start = _given_start(text, start, known, evidence, plain)
            if new_start < pos:
                new_start = start
        if found is not None:
            if new_start < start:
                found.append((text[new_start:end], True))
            found.append((raw, evidence))
        out.append(text[pos:new_start])
        out.append(PERSON)
        pos = end
        count += 1
    out.append(text[pos:])
    return "".join(out), count


def _replace_surnames(text, found=None):
    """'surnamed Li', 'whose surname is Park', 'surnamed 黃': the cue names a person, whatever the word is."""
    out, pos, count = [], 0, 0
    for match in _SURNAME_CUE.finditer(text):
        start = match.start(1)
        raw = _POSSESSIVE.sub("", match.group(1)).rstrip(".-'’")
        if start < pos or not raw or "named person" in raw or (raw[0].isascii() and len(raw) < 2):
            continue
        end = start + len(raw)
        if found is not None:
            found.append((raw, True))
        out.append(text[pos:start])
        out.append(PERSON)
        pos = end
        count += 1
    out.append(text[pos:])
    return "".join(out), count


def _replace_handles(text, known, found=None):
    """Every other @handle (a handle is a personal identifier): weak evidence only, never spread across the run, so a
    protocol whose handle matches its name keeps its incident subject. Known firms, AI products and the channel's own
    handle stay."""
    out, pos, count = [], 0, 0
    for match in _HANDLE.finditer(text):
        raw = match.group(1)
        plain = raw[1:].lower()
        if plain in OWN_HANDLES or _known_word(raw, known):
            continue
        if found is not None:
            found.append((raw, False))
        out.append(text[pos:match.start(1)])
        out.append(PERSON)
        pos = match.end(1)
        count += 1
    out.append(text[pos:])
    return "".join(out), count


def _native_after(match):
    return PERSON + (" " if match.group(1) else "")


def redact_people(text, known=None, found=None):
    """Return (text, number_of_new_redactions). known: lower-case names of organisations and protocols seen in
    this run (incident-database records, source publishers), never taken for a person when alone before "says".
    found: a list that gets (name as written, strong) for every name replaced (see person_tokens)."""
    if not text:
        return text, 0
    known = frozenset(k.lower() for k in (known or ()) if k)
    local = []  # names replaced by the full-name passes of this call

    def record(match):
        local.append((match.group(0), True))
        return PERSON

    total = 0
    text, n = _KNOWN.subn(record, text)
    total += n
    text, n = _HONORIFIC.subn(record, text)
    total += n
    # In a Title Case headline every word is capitalised, so a capitalised pair is
    # only taken for a name when it starts with a known given name.
    strict = _title_case(text)
    for pattern, kwargs in (
        (_ROLE_NAME, {"need_first_name": strict, "products": "role"}),
        (_ROLE_HANDLE, {"single": True}),
        (_AGE, {"need_first_name": strict, "products": False}),
        (_SPEECH, {"need_first_name": strict}),
        (_ACCORDING, {"need_first_name": strict}),
        (_LEGAL_NAME, {"legal": True}),
    ):
        text, n = _replace_names(pattern, text, 1, found=local, known=known, **kwargs)
        total += n
    text, n = _replace_first_names(text, found=local)
    total += n
    # "John Cline ... Cline said": the surname of a person named in this text is a person
    surnames = frozenset(_plain(name.split()[-1]) for name, _ in local if " " in name.strip())
    lone = []
    # lone surnames and pseudonyms: "Saylor says", "according to Saylor", "coordinated by Kruw"
    text, n = _replace_lone(_LONE_SPEECH, text, known, found=lone, surnames=surnames, look_back=True)
    total += n
    text, n = _replace_lone(_LONE_ACCORDING, text, known, found=lone, surnames=surnames)
    total += n
    text, n = _replace_lone(_PSEUDONYM, text, known, need_shape=True, found=lone, strong=True)
    total += n
    text, n = _replace_lone(_SURNAMED, text, known, need_shape=True, found=lone, strong=True)
    total += n
    text, n = _replace_surnames(text, found=lone)
    total += n
    text, n = _HANDLE_AFTER.subn(PERSON, text)
    total += n
    text, n = _replace_handles(text, known, found=lone)
    total += n
    text = _NATIVE_NAME_AFTER.sub(_native_after, text)
    # Chinese, Japanese and Korean script: names in it cannot be told apart, so the run goes
    text, n = _CJK_RUN.subn(FOREIGN, text)
    total += n
    text = re.sub(r"(?:\[named person\]\s*){2,}", PERSON + " ", text)
    text = re.sub(r"\[named person\] (?=[.,;:!?)])", PERSON, text)
    if found is not None:
        found.extend(local + lone)
    return text, total


def _replace_first_names(text, found=None):
    out, pos, count, search = [], 0, 0, 0
    protected = _protected_spans(text)
    while True:
        match = _FIRST_NAME.search(text, search)
        if match is None:
            break
        start = match.start(1)
        # a window that is not a name ("Claude Code's Kevin", "When Kevin Smith") is retried from its next word, so
        # the name inside it is still seen
        search = match.end(1)
        if start < pos or _inside(start, protected):
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
        if found is not None:
            found.append((text[start:end], True))
        out.append(text[pos:start])
        out.append(PERSON)
        pos = end
        search = max(search, end)
        count += 1
    out.append(text[pos:])
    return "".join(out), count


_NAME_EDGE = re.compile(r"^[\s\"'“”‘’(\[@]+|[\s\"'“”‘’)\].,;:!?]+$")


def person_tokens(found, known=None, not_people=frozenset()):
    """Names to redact everywhere in a run, from redact_people's `found` list over all of the run's text: each full
    name of two or more words as written, and each single word (a pseudonym, handle or lone surname) that was redacted
    at least once with person evidence (strong). A single word that was only ever a capitalised word before "says"
    is left alone ("Glassnode says" is a firm), and so are organisations seen in the run, places and common words.
    Never a token: an AI product name ("Claude Computer Use"), a word that names nobody ("Man", "Woman"), or a name
    in not_people (the news gate's allowlist: organisations, threat groups); an AI name that is also a person's name
    (Claude, Cline, Kiro, Sora) does spread once the run has seen it used for a person."""
    known = frozenset(k.lower() for k in (known or ()) if k)
    not_people = frozenset(n.lower() for n in not_people if n) - AI_PERSON_NAMES
    out = set()
    for name, strong in found or ():
        name = _NAME_EDGE.sub("", _POSSESSIVE.sub("", (name or "").strip()))
        low = name.lower()
        if len(name) < 3 or "named person" in low or "non-english text" in low:
            continue
        if low in not_people or _plain(name) in GENERIC_PERSON_NOUNS:
            continue
        if " " in name:
            words = name.split()
            if not _is_product(words) and not _product_prefix([_plain(w) for w in words]):
                out.add(name)
        elif strong and not _known_word(name, known, ai_names=False):
            out.add(name)
    return out


class People:
    """The run's person tokens (person_tokens): redact(text) replaces each whole-word occurrence, as written, in
    upper case or with an @, keeping a possessive or a "-linked" suffix outside the replacement; mentioned(text) says
    whether text contains one (an incident subject that does is a person, never a protocol). A token that is also an
    AI product name never matches right before a product word or a version ("Claude Code" is not the person who
    shares the name), and a given name right before a one-word token goes with it ("Teodoro [Sample]")."""

    def __init__(self, tokens=()):
        self.tokens = frozenset(t for t in tokens if t)
        variants = sorted({v for t in self.tokens for v in (t, t.upper())}, key=len, reverse=True)
        tails = "|".join(sorted(AI_PRODUCT_TAILS, key=len, reverse=True))
        product = rf"(?!\s+(?i:(?:{tails})\b)|\s+\d)"
        parts = [re.escape(v) + (product if _plain(v) in AI_NAMES or _plain(v) in AI_PRODUCT_HEADS else "")
                 for v in variants]
        self._pattern = re.compile(
            r"(?<![A-Za-z0-9_])@?(?:" + "|".join(parts) + r")(?![A-Za-z0-9_])") if parts else None

    def redact(self, text):
        if not text or self._pattern is None:
            return text, 0
        out, pos, count = [], 0, 0
        for match in self._pattern.finditer(text):
            start = match.start()
            if start < pos:
                continue
            word = match.group(0).lstrip("@")
            if " " not in word.strip():
                earlier = _given_start(text, start, frozenset(), False, _plain(word))
                if earlier >= pos:
                    start = earlier
            out.append(text[pos:start])
            out.append(PERSON)
            pos = match.end()
            count += 1
        out.append(text[pos:])
        return "".join(out), count

    def mentioned(self, text):
        return bool(text and self._pattern is not None and self._pattern.search(text))


def url_names_person(url, names):
    """Does the link's path or query spell one of these names? Outlets put names in slugs
    ("...-crypto-trader-x-says-wallet-hacked"), so the same name the radar redacted from the headline sits in the link
    next to it. Matched folded and as whole slug words: a multi-word name as its joined form, by its surname (its last
    word) or by a known given name, of 3 or more letters and not a common or organisation word; a one-word name of 3
    or more characters."""
    if not url or not names:
        return False
    parts = urllib.parse.urlsplit(url)
    slug = fold(urllib.parse.unquote(f"{parts.path} {parts.query}"))
    words = [w for w in re.split(r"[^a-z0-9]+", slug) if w]
    if not words:
        return False
    joined = "-" + "-".join(words) + "-"
    present = set(words)
    for name in names:
        pieces = [w for w in re.split(r"[^a-z0-9]+", fold(name)) if w]
        if not pieces:
            continue
        if len(pieces) == 1:
            if len(pieces[0]) >= 3 and pieces[0] in present:
                return True
            continue
        if "-" + "-".join(pieces) + "-" in joined:
            return True
        for piece in {pieces[-1]} | ({pieces[0]} if pieces[0] in FIRST_NAMES else set()):
            if (len(piece) >= 3 and piece in present and not piece.isdigit() and piece not in _ORG_WORDS
                    and piece not in _COMMON_CAPITALISED and piece not in _NAME_STOP and piece not in _PLACES
                    and piece not in AI_NAMES and piece not in AI_PRODUCT_TAILS):
                return True
    return False


def url_ref(url):
    """A stable key for a withheld link (the same article always gets the same key)."""
    return "u:" + hashlib.sha256((url or "").encode("utf-8")).hexdigest()[:16]


def url_origin(url):
    """The outlet's address only: 'https://www.coindesk.com/'."""
    parts = urllib.parse.urlsplit(url or "")
    if parts.scheme not in ("http", "https") or not parts.hostname:
        return None
    return f"{parts.scheme}://{parts.hostname}/"


# Text addressed to an AI inside a source's text: a prompt-injection payload the source quotes. It is removed up to
# the end of its sentence, so it can never be repeated in a brief, an email or a script.
_INSTRUCTION = re.compile(
    r"(?:(?-i:\bAI\b|\bA\.I\.)|\bLLMs?\b|\b(?:AI\s+)?(?:assistants?|agents?|models?|chat ?bots?|copilots?))\s+"
    r"(?:reading|processing|summari[sz]ing|parsing|analy[sz]ing|browsing|visiting|seeing)\s+(?:this|these)\b"
    r"[^.!?\n]{0,240}[.!?]?"
    r"|\b(?:ignore|disregard|forget|override)\s+(?:all\s+|any\s+|the\s+|your\s+|its\s+|every\s+)?"
    r"(?:previous|prior|above|earlier|preceding|original|system)\s+(?:instructions?|prompts?|rules?|messages?|"
    r"guidelines?|directions?)\b[^.!?\n]{0,240}[.!?]?"
    r"|\byou are now (?:a|an|in|the|DAN|free|unrestricted|jailbroken|uncensored)\b[^.!?\n]{0,240}[.!?]?"
    r"|\b(?:new|updated)\s+(?:system\s+)?instructions?\s*:[^.!?\n]{0,240}[.!?]?"
    r"|\bsystem prompt\s*:[^.!?\n]{0,240}[.!?]?"
    r"|\bpretend (?:you are|you're|that you are)\b[^.!?\n]{0,240}[.!?]?",
    re.IGNORECASE,
)


def redact_instructions(text):
    """Return (text, count) without text addressed to an AI ("AI assistants reading this page must ...")."""
    if not text:
        return text, 0
    return _INSTRUCTION.subn(INSTRUCTION, text)


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


def sanitize(text, known=None, people=None, found=None):
    """Names, AI-addressed instructions and code removed. Returns (text, {'names': n, 'code': n, 'instructions': n}).
    people: the run's People, whose names are redacted wherever they appear. found: gets the names redact_people
    replaced here (see person_tokens)."""
    text, names = redact_people(text, known, found=found)
    if people is not None:
        text, more = people.redact(text)
        names += more
    text, instructions = redact_instructions(text)
    text, code = redact_code(text)
    return text, {"names": names, "code": code, "instructions": instructions}


_PRICE = re.compile(
    r"\b(?:price|prices|priced|rall(?:y|ies|ied)|surg(?:e|es|ed|ing)|plung(?:e|es|ed|ing)|"
    r"soar(?:s|ed|ing)?|tumbl(?:e|es|ed|ing)|crash(?:es|ed|ing)?|pump(?:s|ed|ing)?(?!\.fun)|"
    r"plummet(?:s|ed|ing)?|crater(?:s|ed|ing)|slump(?:s|ed|ing)?|nosediv(?:e|es|ed|ing)|skyrocket(?:s|ed|ing)?|"
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
