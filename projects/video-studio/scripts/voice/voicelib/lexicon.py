"""Channel pronunciation lexicon (added 2026-11-24, VCD fix), applied to each written token before G2P.

espeak-ng misreads the channel's core vocabulary: "memecoins" as MEM-ih-coins (mˈɛmɪkˌɔɪnz), "DeFi" as "də fˌaɪ",
"CEX" as "sex", "KOL"/"KOLs" as "call", and "Pump.fun" as "pump. fun" (a sentence break). Each entry maps a written
form (matched case-insensitively, as a whole token without its punctuation) to what Kokoro should say; captions keep
the written form. A {display|spoken} pair in the storyboard still wins for one-off cases.

Spanish and Portuguese entries are spoken respellings for espeak's es (Castilian) and pt-br voices, the same ones the
dub sheets use: machine-made, like every translation, and listed for the native reviewer (scripts/dub glossary).
"""

PRONUNCIATIONS: dict[str, dict[str, str]] = {
    "en": {
        "memecoin": "meme coin",
        "memecoins": "meme coins",
        "defi": "dee fye",
        "cex": "C E X",
        "cexes": "C E X's",
        "kol": "K O L",
        "kols": "K O L's",
        "pump.fun": "Pump dot fun",
        "dexes": "dexes",
        "nfts": "N F T's",
        "ath": "all time high",
        "dyor": "D Y O R",
        "kyc": "K Y C",
        "aml": "Ay M L",
        "degen": "dee jen",
        "degens": "dee jens",
    },
    # es / pt-br: the dub glossary's single-word respellings (scripts/dub/lib/glossary.ts RESPELL), so a dub that forgets
    # the {term|spoken} markup is still read the same way (espeak es said "memecoins" as me-ME-coins).
    "es": {
        "on-chain": "onchéin",
        "pump.fun": "Pamp punto fan",
        "memecoin": "mimcoin",
        "memecoins": "mimcoins",
        "coingecko": "Coin Guecko",
        "bubblemaps": "Bábol maps",
    },
    "pt-br": {
        "on-chain": "onchêin",
        "pump.fun": "Pâmp ponto fân",
        "memecoin": "mímcoin",
        "memecoins": "mímcoins",
        "coingecko": "Côin Guéco",
        "bubblemaps": "Bâbou maps",
    },
    "it": {
        "pump.fun": "Pamp punto fan",
    },
    "hi": {},
}


def match_case(written: str, spoken: str) -> str:
    """Keep a capital at the start of a sentence: "Memecoins" -> "Meme coins"."""
    if written[:1].isupper() and spoken[:1].islower():
        return spoken[:1].upper() + spoken[1:]
    return spoken
