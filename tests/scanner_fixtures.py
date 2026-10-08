"""SYNTHETIC test data. No network access or genuine financial observations."""
import base64
from src.aai_scanner.evidence import receipt
from src.aai_scanner.market import MARKET_URL, WRAPPED_SOL
from src.aai_scanner.mint import SPL_TOKEN
from src.aai_scanner.transport import MAINNET_GENESIS, ProviderError

MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
ACCOUNT = "11111111111111111111111111111111"


def mint_data(supply=10**12, decimals=6, initialized=1):
    data = bytearray(82)
    data[36:44] = supply.to_bytes(8, "little")
    data[44], data[45] = decimals, initialized
    return data


def mint_response(data=None, owner=SPL_TOKEN, slot=100):
    data = mint_data() if data is None else data
    return {"result": {"context": {"slot": slot}, "value": {
        "owner": owner, "executable": False, "data": [base64.b64encode(data).decode(), "base64"]}}}


def synthetic_receipt(provider, endpoint, method, slot=None):
    value = receipt(provider, endpoint, method, slot=slot, commitment="finalized" if slot else None,
                    flags=["SYNTHETIC_TEST_FIXTURE"])
    value["classification"] = "SYNTHETIC"
    return value


class FakeRPC:
    def __init__(self):
        self.calls = []
        self.fail = set()
        self.account = mint_response()
        self.holder_slot = 100
        self.holder_amount = "400000000000"
        self.network_receipt = synthetic_receipt("Synthetic RPC", "https://rpc.test", "getGenesisHash")
        self.network_receipt["genesis_hash"] = MAINNET_GENESIS

    def call(self, method, params):
        self.calls.append(method)
        if method in self.fail:
            raise ProviderError("Synthetic provider failure")
        if method == "getAccountInfo":
            value = self.account.copy()
        elif method == "getTokenLargestAccounts":
            value = {"result": {"context": {"slot": self.holder_slot}, "value": [
                {"address": ACCOUNT, "amount": self.holder_amount, "decimals": 6}]}}
        elif method == "getSignaturesForAddress":
            value = {"result": [{"signature": "1" * 64, "slot": 100, "blockTime": None,
                                 "confirmationStatus": "finalized", "err": None}]}
        elif method == "getBalance":
            value = {"result": {"context": {"slot": 100}, "value": 1234567890}}
        else:
            raise ValueError("Unexpected test RPC method")
        value["_evidence"] = synthetic_receipt("Synthetic RPC", "https://rpc.test", method,
                                              self.holder_slot if method == "getTokenLargestAccounts" else 100)
        return value


class FakeMarket:
    def __init__(self):
        self.calls, self.fail = [], False
        self.name = "SYNTHETIC TEST TOKEN"

    def pools(self, mint):
        self.calls.append(mint)
        if self.fail:
            raise ProviderError("Synthetic market failure")
        value = {
            "pair": ACCOUNT, "venue": "Synthetic test venue", "name": self.name, "symbol": "TEST",
            "price_usd": "100" if mint == WRAPPED_SOL else "2", "liquidity_usd": "100000",
            "volume_24h_usd": "2500", "market_cap_usd": None, "fdv_usd": "2000000",
            "buys_24h": 4, "sells_24h": 3, "pool_created_at_ms": None,
        }
        return [value], synthetic_receipt("Synthetic market", MARKET_URL, "test pools")
