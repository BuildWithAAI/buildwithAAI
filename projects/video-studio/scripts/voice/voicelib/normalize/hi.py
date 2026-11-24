"""Hindi number words (Devanagari), Indian grouping: हज़ार 10^3, लाख 10^5, करोड़ 10^7, अरब 10^9,
खरब 10^11. 0-99 are individual words (table). Decimals: "दशमलव" then digit by digit. Scaled
amounts are converted to Indian units: "$1.5M" -> 15,00,000 -> "पंद्रह लाख डॉलर".
Devanagari digits (०-९) are read like ASCII digits. Common spelling variants exist (छह/छः,
उनासी/उन्यासी); the native-speaker review of each script decides the house style.
"""

from ..lexicon import PRONUNCIATIONS
from .common import DEVANAGARI_DIGITS, SpacedNormalizer, parse_num

HI_0_99 = [
    "शून्य", "एक", "दो", "तीन", "चार", "पाँच", "छह", "सात", "आठ", "नौ",
    "दस", "ग्यारह", "बारह", "तेरह", "चौदह", "पंद्रह", "सोलह", "सत्रह", "अठारह", "उन्नीस",
    "बीस", "इक्कीस", "बाईस", "तेईस", "चौबीस", "पच्चीस", "छब्बीस", "सत्ताईस", "अट्ठाईस", "उनतीस",
    "तीस", "इकतीस", "बत्तीस", "तैंतीस", "चौंतीस", "पैंतीस", "छत्तीस", "सैंतीस", "अड़तीस", "उनतालीस",
    "चालीस", "इकतालीस", "बयालीस", "तैंतालीस", "चवालीस", "पैंतालीस", "छियालीस", "सैंतालीस", "अड़तालीस", "उनचास",
    "पचास", "इक्यावन", "बावन", "तिरपन", "चौवन", "पचपन", "छप्पन", "सत्तावन", "अट्ठावन", "उनसठ",
    "साठ", "इकसठ", "बासठ", "तिरसठ", "चौंसठ", "पैंसठ", "छियासठ", "सड़सठ", "अड़सठ", "उनहत्तर",
    "सत्तर", "इकहत्तर", "बहत्तर", "तिहत्तर", "चौहत्तर", "पचहत्तर", "छिहत्तर", "सतहत्तर", "अठहत्तर", "उनासी",
    "अस्सी", "इक्यासी", "बयासी", "तिरासी", "चौरासी", "पचासी", "छियासी", "सत्तासी", "अट्ठासी", "नवासी",
    "नब्बे", "इक्यानबे", "बानबे", "तिरानबे", "चौरानबे", "पचानबे", "छियानबे", "सत्तानबे", "अट्ठानबे", "निन्यानबे",
]
assert len(HI_0_99) == 100
SCALES = [(10**11, "खरब"), (10**9, "अरब"), (10**7, "करोड़"), (10**5, "लाख"), (1000, "हज़ार"), (100, "सौ")]
MONTHS = ["जनवरी", "फ़रवरी", "मार्च", "अप्रैल", "मई", "जून", "जुलाई", "अगस्त", "सितंबर", "अक्टूबर", "नवंबर", "दिसंबर"]
ORDINALS = {1: "पहला", 2: "दूसरा", 3: "तीसरा", 4: "चौथा", 6: "छठा"}
SCALE_FACTOR = {"k": 10**3, "m": 10**6, "b": 10**9, "bn": 10**9, "t": 10**12}


def cardinal(n: int) -> str:
    if n < 0:
        return f"माइनस {cardinal(-n)}"
    if n < 100:
        return HI_0_99[n]
    parts = []
    for value, name in SCALES:
        q, n = divmod(n, value)
        if q:
            parts.append(f"{cardinal(q)} {name}")
    if n:
        parts.append(HI_0_99[n])
    return " ".join(parts)


class Hindi(SpacedNormalizer):
    lang = "hi"
    decimal_sep = "."
    decimal_word = "दशमलव"
    percent_word = "प्रतिशत"
    plus_word = "प्लस"
    minus_word = "माइनस"
    plusminus_word = "प्लस माइनस"
    about_word = "लगभग"
    range_word = "से"
    times_word = "गुना"
    currencies = {
        "$": ("डॉलर", "डॉलर", "सेंट", "सेंट"),
        "€": ("यूरो", "यूरो", "सेंट", "सेंट"),
        "£": ("पाउंड", "पाउंड", None, None),
        "¥": ("येन", "येन", None, None),
        "₹": ("रुपया", "रुपये", "पैसा", "पैसे"),
        "US$": ("अमेरिकी डॉलर", "अमेरिकी डॉलर", "सेंट", "सेंट"),
        "R$": ("ब्राज़ीलियाई रियाल", "ब्राज़ीलियाई रियाल", None, None),
        "A$": ("ऑस्ट्रेलियाई डॉलर", "ऑस्ट्रेलियाई डॉलर", "सेंट", "सेंट"),
        "C$": ("कनाडाई डॉलर", "कनाडाई डॉलर", "सेंट", "सेंट"),
        "MX$": ("मैक्सिकन पेसो", "मैक्सिकन पेसो", None, None),
    }
    scales = {"k": ("हज़ार", "हज़ार"), "m": ("मिलियन", "मिलियन"), "b": ("बिलियन", "बिलियन"), "t": ("ट्रिलियन", "ट्रिलियन")}
    scale_words = frozenset({"हज़ार", "हजार", "लाख", "करोड़", "मिलियन", "बिलियन", "अरब"})
    tickers = {"BTC": "बिटकॉइन", "ETH": "ईथर", "SOL": "सोल", "USDC": "USDC", "USDT": "USDT"}
    symbols = {"&": "और", "+": "प्लस", "=": "बराबर", "@": "एट", "%": "प्रतिशत", "~": "लगभग", "×": "गुणा", "#": "नंबर"}
    months = MONTHS
    month_lookup = {m: i + 1 for i, m in enumerate(MONTHS)}
    lexicon = PRONUNCIATIONS["hi"]
    number_word = "नंबर"

    def preprocess(self, token: str) -> str:
        # espeak ignores the danda, so the sentence pause would be lost: speak it as a full stop.
        return token.translate(DEVANAGARI_DIGITS).replace("॥", ".").replace("।", ".")

    def cardinal(self, n: int) -> str:
        return cardinal(n)

    def ordinal(self, n: int) -> str:
        return ORDINALS.get(n, f"{cardinal(n)}वाँ")

    def scaled(self, num: str, scale: str) -> str:
        """Convert to Indian units: "1.5M" -> 1500000 -> "पंद्रह लाख"."""
        i, f = parse_num(num, self.decimal_sep)
        factor = SCALE_FACTOR[scale.lower()]
        frac = f or ""
        total_num = int(i + frac) * factor
        den = 10 ** len(frac)
        whole, rem = divmod(total_num, den)
        if rem == 0:
            return cardinal(whole)
        rem_digits = str(rem).rjust(len(frac), "0").rstrip("0")
        return f"{cardinal(whole)} {self.decimal_word} {self.digits(rem_digits)}"

    def date(self, y: int | None, m: int, d: int) -> str:
        head = f"{cardinal(d)} {MONTHS[m - 1]}"
        return f"{head} {cardinal(y)}" if y else head

    def time(self, h: int, mi: int) -> str:
        return f"{cardinal(h)} बजकर {cardinal(mi)} मिनट" if mi else f"{cardinal(h)} बजे"

    def money(self, sym: str, num: str, scale: str | None = None) -> str:
        singular, plural, cent1, centn = self.currencies[sym]
        if scale:
            return f"{self.scaled(num, scale)} {plural}"
        i, f = parse_num(num, self.decimal_sep)
        if f is not None and set(f) == {"0"}:
            f = None
        if f is not None and len(f) == 2 and cent1:
            cents = int(f)
            if int(i) == 0:
                return f"{cardinal(cents)} {cent1 if cents == 1 else centn}"
            return f"{cardinal(int(i))} {singular if int(i) == 1 else plural} {cardinal(cents)} {cent1 if cents == 1 else centn}"
        if f is None:
            n = int(i)
            return f"{cardinal(n)} {singular if n == 1 else plural}"
        return f"{self.decimal(i, f)} {plural}"

    def multiplier(self, num: str) -> str:
        return f"{self.number(num)} {self.times_word}"

    def fraction_words(self, n: int, d: int) -> str | None:
        if (n, d) == (1, 2):
            return "आधा"
        if d == 3:
            return f"{cardinal(n)} तिहाई"
        if d == 4:
            return f"{cardinal(n)} चौथाई"
        return f"{cardinal(n)} बटा {cardinal(d)}"

    def is_year(self, n: int) -> bool:
        return False

