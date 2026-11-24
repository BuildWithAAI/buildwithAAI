"""Pip value maths.

pip value (quote ccy) per lot = pip_size * contract_size
pip value (account ccy)       = that * rate(quote -> account)

USD account examples (100k lot):
* EURUSD (USD quote): 0.0001 * 100000 = 10 USD, independent of price.
* USDJPY (USD base):  0.01 * 100000 = 1000 JPY = 1000 / USDJPY USD.
* USDCHF / USDCAD:    10 CHF|CAD = 10 / USDCHF|USDCAD USD.
* EURGBP (cross):     10 GBP = 10 * GBPUSD USD.
* EURJPY (cross):     1000 JPY = 1000 / USDJPY USD.
"""

from __future__ import annotations

from typing import Mapping

from ..instruments import Instrument, conversion_rate, get_instrument


def quote_to_account(inst: Instrument, account_ccy: str, rates: Mapping[str, float]) -> float:
    return conversion_rate(inst.quote, account_ccy, rates)


def pip_value_per_lot(pair: str | Instrument, account_ccy: str, rates: Mapping[str, float]) -> float:
    inst = pair if isinstance(pair, Instrument) else get_instrument(pair)
    return inst.pip_size * inst.contract_size * quote_to_account(inst, account_ccy, rates)
