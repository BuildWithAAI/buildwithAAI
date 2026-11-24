import unittest

from voicelib.normalize import normalize_text as n
from voicelib.normalize import common, zh

# The five tricky cases from the brief, in every supported language.
TRICKY = {
    "en": {
        "$40,000": "forty thousand dollars",
        "68.67%": "sixty eight point six seven percent",
        "2026": "twenty twenty six",
        "1.5M": "one point five million",
        "0.25 SOL": "zero point two five sol",
    },
    "es": {
        "$40.000": "cuarenta mil dólares",
        "$40,000": "cuarenta mil dólares",  # English-style thousands in Spanish copy
        "68,67%": "sesenta y ocho coma sesenta y siete por ciento",
        "68.67%": "sesenta y ocho coma sesenta y siete por ciento",
        "2026": "dos mil veintiséis",
        "1,5M": "uno coma cinco millones",
        "0,25 SOL": "cero coma veinticinco sol",
    },
    "pt-br": {
        "$40.000": "quarenta mil dólares",
        "68,67%": "sessenta e oito vírgula sessenta e sete por cento",
        "2026": "dois mil e vinte e seis",
        "1,5M": "um vírgula cinco milhão",
        "0,25 SOL": "zero vírgula vinte e cinco sol",
    },
    "it": {
        "$40.000": "quarantamila dollari",
        "68,67%": "sessantotto virgola sessantasette per cento",
        "2026": "duemilaventisei",
        "1,5M": "uno virgola cinque milioni",
        "0,25 SOL": "zero virgola venticinque sol",
    },
    "hi": {
        "$40,000": "चालीस हज़ार डॉलर",
        "68.67%": "अड़सठ दशमलव छह सात प्रतिशत",
        "2026": "दो हज़ार छब्बीस",
        "1.5M": "पंद्रह लाख",
        "0.25 SOL": "शून्य दशमलव दो पाँच सोल",
    },
    "zh": {
        "$40,000": "四万美元",
        "68.67%": "百分之六十八点六七",
        "2026年": "二零二六年",
        "1.5M": "一百五十万",
        "0.25 SOL": "零点二五 SOL",
    },
}


class TrickyCases(unittest.TestCase):
    def test_tricky(self):
        for lang, cases in TRICKY.items():
            for text, want in cases.items():
                with self.subTest(lang=lang, text=text):
                    self.assertEqual(n(text, lang), want)


class English(unittest.TestCase):
    def test_numbers(self):
        cases = {
            "0": "zero", "7": "seven", "13": "thirteen", "40": "forty", "101": "one hundred one",
            "402 coins": "four hundred two coins", "1,234,567": "one million two hundred thirty four thousand five hundred sixty seven",
            "1,000,000,000": "one billion",
        }
        for text, want in cases.items():
            with self.subTest(text=text):
                self.assertEqual(n(text, "en"), want)

    def test_years_and_dates(self):
        cases = {
            "1999": "nineteen ninety nine", "2005": "two thousand five", "2010": "twenty ten", "1905": "nineteen oh five",
            "1900": "nineteen hundred", "November 24, 2026": "November twenty fourth, twenty twenty six",
            "Nov. 24": "November twenty fourth", "24 November 2026": "twenty fourth November twenty twenty six",
            "2026-11-24": "November twenty fourth, twenty twenty six", "11/24/2026": "November twenty fourth, twenty twenty six",
            "1990s": "nineteen nineties", "'90s": "'nineties", "2020-2026": "twenty twenty to twenty twenty six",
        }
        for text, want in cases.items():
            with self.subTest(text=text):
                self.assertEqual(n(text, "en"), want)

    def test_money_and_signs(self):
        cases = {
            "$1": "one dollar", "$1.50": "one dollar and fifty cents", "$0.25": "twenty five cents", "$0.01": "one cent",
            "$1.5M": "one point five million dollars", "$69K": "sixty nine thousand dollars", "$2B": "two billion dollars",
            "$5m": "five million dollars", "$1.5 million": "one point five million dollars", "$0.0042": "zero point zero zero four two dollars",
            "$40,000.00": "forty thousand dollars", "€3": "three euros", "+402%": "plus four hundred two percent",
            "−84%": "minus eighty four percent", "-84%": "minus eighty four percent", "±2%": "plus or minus two percent",
            "~$40": "about forty dollars", "$SOL": "sol", "40,000 $": "forty thousand dollars",
        }
        for text, want in cases.items():
            with self.subTest(text=text):
                self.assertEqual(n(text, "en"), want)

    def test_symbols_and_misc(self):
        cases = {
            "10x": "ten x", "24/7": "twenty four seven", "3:45": "three forty five", "3:05": "three oh five", "9:00": "nine o'clock",
            "Web3": "Web three", "5-year": "five year", "1st": "first", "22nd": "twenty second", "103rd": "one hundred third",
            "& more": "and more", "a - b": "a — b", "BTC": "bitcoin", "ETH": "ether", "USDC": "U S D C",
            "($40,000),": "(forty thousand dollars),", "it's 5.": "it's five.",
        }
        for text, want in cases.items():
            with self.subTest(text=text):
                self.assertEqual(n(text, "en"), want)

    def test_untouched(self):
        for text in ("Pump.fun", "don't", "U.S.", "hello, world.", "1.2.3"):
            with self.subTest(text=text):
                self.assertEqual(n(text, "en"), text)

    def test_one_spoken_string_per_token(self):
        from voicelib.normalize import spaced

        toks = "On November 24, 2026 it hit $1.5 million.".split()
        out = spaced("en").normalize_tokens(toks)
        self.assertEqual(len(out), len(toks))
        self.assertEqual(out, ["On", "November", "twenty fourth,", "twenty twenty six", "it", "hit", "one point five", "million dollars."])


class Spanish(unittest.TestCase):
    def test_cases(self):
        cases = {
            "1": "uno", "21": "veintiuno", "100": "cien", "101": "ciento uno", "500": "quinientos", "1000": "mil",
            "21.000": "veintiún mil", "1.000.000": "un millón", "2.500.000": "dos millones quinientos mil",
            "$1": "un dólar", "$21": "veintiún dólares", "$2.000.000": "dos millones de dólares", "$1M": "un millón de dólares",
            "$1.5M": "uno coma cinco millones de dólares", "$2B": "dos mil millones de dólares", "$1K": "mil dólares",
            "$1,50": "un dólar con cincuenta centavos", "1.234": "mil doscientos treinta y cuatro", "1,234": "uno coma dos tres cuatro",
            "2026-11-24": "veinticuatro de noviembre de dos mil veintiséis", "1 de enero": "primero de enero",
            "3:45": "tres y cuarenta y cinco", "1.º": "primero", "10x": "diez veces", "+5%": "más cinco por ciento",
            "68,67 %": "sesenta y ocho coma sesenta y siete por ciento", "40.000 €": "cuarenta mil euros",
        }
        for text, want in cases.items():
            with self.subTest(text=text):
                self.assertEqual(n(text, "es"), want)


class Portuguese(unittest.TestCase):
    def test_cases(self):
        cases = {
            "16": "dezesseis", "19": "dezenove", "100": "cem", "101": "cento e um", "1100": "mil e cem", "1234": "mil duzentos e trinta e quatro",
            "1.500.000": "um milhão e quinhentos mil", "2.000.000": "dois milhões", "$1": "um dólar", "$2.000.000": "dois milhões de dólares",
            "$1,5M": "um vírgula cinco milhão de dólares", "$2,5M": "dois vírgula cinco milhões de dólares", "$1,50": "um dólar e cinquenta centavos",
            "2026-11-24": "vinte e quatro de novembro de dois mil e vinte e seis", "1 de janeiro": "primeiro de janeiro", "1º": "primeiro",
        }
        for text, want in cases.items():
            with self.subTest(text=text):
                self.assertEqual(n(text, "pt-br"), want)


class Italian(unittest.TestCase):
    def test_cases(self):
        cases = {
            "21": "ventuno", "23": "ventitré", "28": "ventotto", "103": "centotré", "180": "centottanta", "1000": "mille",
            "2026": "duemilaventisei", "40.000": "quarantamila", "1.000.000": "un milione", "2.000.000": "due milioni",
            "$1": "un dollaro", "$2.000.000": "due milioni di dollari", "$69K": "sessantanovemila dollari", "$1K": "mille dollari",
            "$1,5K": "uno virgola cinque mila dollari", "$1,50": "un dollaro e cinquanta centesimi",
            "2026-11-24": "ventiquattro novembre duemilaventisei", "1 novembre": "primo novembre", "3:45": "tre e quarantacinque",
        }
        for text, want in cases.items():
            with self.subTest(text=text):
                self.assertEqual(n(text, "it"), want)


class Hindi(unittest.TestCase):
    def test_table_and_scales(self):
        from voicelib.normalize.hi import HI_0_99, cardinal

        self.assertEqual(len(HI_0_99), 100)
        self.assertEqual(len(set(HI_0_99)), 100)
        cases = {
            99: "निन्यानबे", 100: "एक सौ", 1000: "एक हज़ार", 100000: "एक लाख", 1500000: "पंद्रह लाख",
            10_000_000: "एक करोड़", 123_456_789: "बारह करोड़ चौंतीस लाख छप्पन हज़ार सात सौ नवासी",
        }
        for value, want in cases.items():
            with self.subTest(value=value):
                self.assertEqual(cardinal(value), want)

    def test_cases(self):
        cases = {
            "1,00,000": "एक लाख", "२०२६": "दो हज़ार छब्बीस", "$1.5M": "पंद्रह लाख डॉलर", "₹1": "एक रुपया", "₹5": "पाँच रुपये",
            "2026-11-24": "चौबीस नवंबर दो हज़ार छब्बीस", "3:45": "तीन बजकर पैंतालीस मिनट", "10x": "दस गुना", "गई।": "गई.",
            "−84%": "माइनस चौरासी प्रतिशत",
        }
        for text, want in cases.items():
            with self.subTest(text=text):
                self.assertEqual(n(text, "hi"), want)


class Chinese(unittest.TestCase):
    def test_cardinal(self):
        cases = {
            0: "零", 2: "二", 10: "十", 11: "十一", 20: "二十", 110: "一百一十", 1005: "一千零五", 1010: "一千零一十",
            2000: "两千", 20000: "两万", 22000: "两万两千", 40000: "四万", 100010: "十万零一十", 1500000: "一百五十万",
            100000001: "一亿零一", 1000005000: "十亿零五千", 2026: "两千零二十六",
        }
        for value, want in cases.items():
            with self.subTest(value=value):
                self.assertEqual(zh.cardinal(value), want)

    def test_text(self):
        cases = {
            "2026年11月24日": "二零二六年十一月二十四日", "2026-11-24": "二零二六年十一月二十四日", "+402%": "上涨百分之四百零二",
            "−84%": "下跌百分之八十四", "$1.5M": "一百五十万美元", "$4万": "四万美元", "10x": "十倍", "3:45": "三点四十五分",
            "10-20%": "百分之十到百分之二十", "BTC": "比特币", "约~$40": "约约四十美元", "4万人": "四万人",
        }
        for text, want in cases.items():
            with self.subTest(text=text):
                self.assertEqual(n(text, "zh"), want)

    def test_spans_tile_the_text(self):
        text = "当然，价格涨到了$40,000，涨了+68.67%。"
        spans = zh.spans(text)
        self.assertEqual("".join(d for d, _, _ in spans), text)
        self.assertIn(("$40,000", "四万美元", True), spans)
        self.assertIn(("2026年", "二零二六年", True), zh.spans("价格在2026年涨到了"))


class Japanese(unittest.TestCase):
    def test_minimal(self):
        cases = {"$40,000": "40000ドル", "68.67%": "68点六七パーセント", "1.5Mトークン": "1500000トークン", "4万": "4万", "0.25 SOL": "0点二五 SOL"}
        for text, want in cases.items():
            with self.subTest(text=text):
                self.assertEqual(n(text, "ja"), want)

    def test_number_spans_do_not_swallow_spaces(self):
        from voicelib.normalize import ja

        self.assertEqual(ja.spans("0.25 SOL")[0][0], "0.25")


class ParseNum(unittest.TestCase):
    def test_conventions(self):
        cases = [
            ("40,000", ".", ("40000", None)), ("68.67", ".", ("68", "67")), ("1.500", ".", ("1", "500")), ("0,25", ".", ("0", "25")),
            ("1,00,000", ".", ("100000", None)), ("40.000", ",", ("40000", None)), ("68,67", ",", ("68", "67")), ("68.67", ",", ("68", "67")),
            ("40,000", ",", ("40000", None)), ("1,234", ",", ("1", "234")), ("0,250", ",", ("0", "250")), ("1.234,56", ",", ("1234", "56")),
            ("1,234.56", ",", ("1234", "56")),
        ]
        for s, dec, want in cases:
            with self.subTest(s=s, dec=dec):
                self.assertEqual(common.parse_num(s, dec), want)

    def test_rejects_versions(self):
        with self.assertRaises(ValueError):
            common.parse_num("1.2.3", ".")


if __name__ == "__main__":
    unittest.main()
