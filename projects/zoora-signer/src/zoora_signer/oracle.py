"""Oracle gate. Pyth Hermes plus Jupiter, behind Oracle."""

from __future__ import annotations

import struct

import httpx

from zoora_signer.constants import (
    JUPITER_PRICE_URL,
    ORACLE_MAX_AGE_MS,
    ORACLE_MAX_CONF_BPS,
    ORACLE_MAX_DISAGREE_BPS,
    PYTH_SOL_USD_FEED,
    WSOL_MINT,
)
from zoora_signer.models import OracleReading
from zoora_signer.rpc import redact


def judge_oracle(
    *,
    pyth_price_1e8: int | None,
    pyth_conf_1e8: int | None,
    pyth_publish_ms: int | None,
    second_price_1e8: int | None,
    now_ms: int,
) -> OracleReading:
    if (
        pyth_price_1e8 is None
        or pyth_conf_1e8 is None
        or pyth_publish_ms is None
        or second_price_1e8 is None
        or pyth_price_1e8 <= 0
        or second_price_1e8 <= 0
    ):
        return OracleReading(False, "ORACLE_DOWN", 0, 0, 0, 0)
    age = now_ms - pyth_publish_ms
    if age > ORACLE_MAX_AGE_MS or age < -ORACLE_MAX_AGE_MS:
        return OracleReading(
            False, "ORACLE_STALE", pyth_price_1e8, pyth_conf_1e8, pyth_publish_ms, second_price_1e8
        )
    if pyth_conf_1e8 * 10_000 > pyth_price_1e8 * ORACLE_MAX_CONF_BPS:
        return OracleReading(
            False,
            "ORACLE_CONFIDENCE",
            pyth_price_1e8,
            pyth_conf_1e8,
            pyth_publish_ms,
            second_price_1e8,
        )
    diff = abs(pyth_price_1e8 - second_price_1e8)
    if diff * 10_000 > pyth_price_1e8 * ORACLE_MAX_DISAGREE_BPS:
        return OracleReading(
            False, "ORACLE_DISAGREE", pyth_price_1e8, pyth_conf_1e8, pyth_publish_ms, second_price_1e8
        )
    return OracleReading(
        True, None, pyth_price_1e8, pyth_conf_1e8, pyth_publish_ms, second_price_1e8
    )


def parse_pyth_price_account(data: bytes, owner: str) -> tuple[int, int, int] | None:
    """Parse the Pyth receiver price account. Owner and feed id are checked."""

    from zoora_signer.constants import PYTH_RECEIVER_PROGRAM

    if owner != PYTH_RECEIVER_PROGRAM or len(data) < 101:
        return None
    # PriceUpdateV2 discriminator and VerificationLevel::Full (byte 1). Partial is not accepted.
    if data[:8] != bytes.fromhex("22f123639d7ef4cd") or data[40] != 1:
        return None
    if data[41:73].hex() != PYTH_SOL_USD_FEED:
        return None
    price, conf, expo, publish = struct.unpack_from("<qQiq", data, 73)
    if expo >= 0:
        value = price * 10**expo
        conf_value = conf * 10**expo
    else:
        value = price // 10 ** (-expo)
        conf_value = conf // 10 ** (-expo)
    if value <= 0:
        return None
    # Normalize to 1e8 so the existing confidence rule can compare them.
    scale = expo + 8
    if scale >= 0:
        norm = price * 10**scale
        norm_conf = conf * 10**scale
    else:
        norm = price // 10 ** (-scale)
        norm_conf = conf // 10 ** (-scale)
    if norm <= 0:
        return None
    del value, conf_value
    return int(norm), int(norm_conf), int(publish) * 1000


def parse_pyth_price(body: object) -> tuple[int, int, int] | None:
    if not isinstance(body, dict):
        return None
    parsed = body.get("parsed")
    if not isinstance(parsed, list) or not parsed:
        return None
    item = parsed[0]
    if not isinstance(item, dict):
        return None
    price = item.get("price")
    if not isinstance(price, dict):
        return None
    try:
        raw = int(price["price"])
        conf = int(price["conf"])
        expo = int(price["expo"])
        publish = int(price["publish_time"]) * 1000
    except (KeyError, TypeError, ValueError):
        return None
    scale = expo + 8
    if scale >= 0:
        value = raw * 10**scale
        conf_value = conf * 10**scale
    else:
        value = raw // 10 ** (-scale)
        conf_value = conf // 10 ** (-scale)
    if value <= 0:
        return None
    return value, conf_value, publish


def parse_jupiter_price(body: object) -> int | None:
    if not isinstance(body, dict):
        return None
    row = body.get(WSOL_MINT)
    if not isinstance(row, dict):
        return None
    usd = row.get("usdPrice")
    if not isinstance(usd, int | float) or usd <= 0:
        return None
    return int(round(float(usd) * 10**8))


class OnchainPyth:
    """Read the Pyth SOL/USD price account through the configured RPC. HTTP Hermes is not used."""

    def __init__(self, rpc: object) -> None:
        self._rpc = rpc

    def latest(self) -> tuple[int, int, int] | None:
        from zoora_signer.constants import PYTH_SOL_USD_ACCOUNT

        result = self._rpc.call("getAccountInfo", [PYTH_SOL_USD_ACCOUNT, {"encoding": "base64"}])  # type: ignore[attr-defined]
        if not result.ok or not isinstance(result.value, dict):
            return None
        value = result.value.get("value")
        if not isinstance(value, dict):
            return None
        owner = value.get("owner")
        data = value.get("data")
        if not isinstance(owner, str) or not isinstance(data, list) or not data:
            return None
        import base64

        try:
            raw = base64.b64decode(str(data[0]))
        except ValueError:
            return None
        return parse_pyth_price_account(raw, owner)


class JupiterPrice:
    def __init__(self, client: httpx.Client, url: str = JUPITER_PRICE_URL) -> None:
        self._client = client
        self._url = url

    def latest(self) -> int | None:
        try:
            response = self._client.get(self._url, params={"ids": WSOL_MINT}, timeout=5.0)
            response.raise_for_status()
            return parse_jupiter_price(response.json())
        except (httpx.HTTPError, ValueError) as exc:
            raise OracleTransportError(redact(str(exc))) from None


class OracleTransportError(RuntimeError):
    pass


class ChainJupiterOracle:
    """On-chain Pyth plus Jupiter. A failed account read is oracle-down."""

    def __init__(self, pyth: OnchainPyth, second: JupiterPrice) -> None:
        self._pyth = pyth
        self._second = second

    def quote(self, now_ms: int) -> OracleReading:
        try:
            pyth = self._pyth.latest()
            second = self._second.latest()
        except OracleTransportError:
            return judge_oracle(
                pyth_price_1e8=None,
                pyth_conf_1e8=None,
                pyth_publish_ms=None,
                second_price_1e8=None,
                now_ms=now_ms,
            )
        if pyth is None:
            return judge_oracle(
                pyth_price_1e8=None,
                pyth_conf_1e8=None,
                pyth_publish_ms=None,
                second_price_1e8=second,
                now_ms=now_ms,
            )
        return judge_oracle(
            pyth_price_1e8=pyth[0],
            pyth_conf_1e8=pyth[1],
            pyth_publish_ms=pyth[2],
            second_price_1e8=second,
            now_ms=now_ms,
        )
