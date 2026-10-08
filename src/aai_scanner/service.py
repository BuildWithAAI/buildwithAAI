"""Source-backed token reports. Unsupported accounting stays unavailable."""
import copy
import threading
import time
from collections import OrderedDict, deque
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from .evidence import failed_source, measurement, now, number, ratio, units
from .market import MARKET_URL, WRAPPED_SOL, MarketClient, summarize_market
from .mint import ALPHABET, decode_address, parse_mint
from .transport import ProviderError, RpcClient


class BusyError(RuntimeError):
    pass


class Limiter:
    def __init__(self):
        self.lock, self.events = threading.Lock(), OrderedDict()

    def allow(self, key, limit, window=60):
        instant = time.monotonic()
        with self.lock:
            queue = self.events.setdefault(key, deque())
            while queue and queue[0] <= instant - window:
                queue.popleft()
            if len(queue) >= limit:
                return False
            queue.append(instant)
            self.events.move_to_end(key)
            while len(self.events) > 4096:
                self.events.popitem(last=False)
            return True


def safe_signature(value):
    if not isinstance(value, str) or not 64 <= len(value) <= 88 or any(c not in ALPHABET for c in value):
        raise ProviderError("Invalid transaction signature")
    number = 0
    for char in value:
        number = number * 58 + ALPHABET.index(char)
    if len(value) - len(value.lstrip("1")) + (number.bit_length() + 7) // 8 != 64:
        raise ProviderError("Invalid transaction signature size")
    return value


class Scanner:
    def __init__(self, config, store, rpc=None, market=None):
        self.config, self.store = config, store
        self.rpc = rpc or RpcClient(config.rpc_url, config.timeout)
        self.market = market or MarketClient(config.timeout)
        self.slots, self.limiter = threading.BoundedSemaphore(2), Limiter()
        self.lock, self.cache = threading.Lock(), OrderedDict()
        self.last_sources = {}

    def _collect(self, function, provider, endpoint, method):
        try:
            return function(), None
        except (ProviderError, ValueError, TypeError, KeyError, IndexError) as error:
            # No untrusted exception text or credential-bearing URLs.
            reason = str(error) if isinstance(error, ProviderError) else "Source failed validation"
            return None, failed_source(provider, endpoint, method, reason)

    def _mint(self, address):
        result = self.rpc.call("getAccountInfo", [address, {"encoding": "base64", "commitment": "finalized"}])
        return parse_mint(address, result, self.config.rpc_url)

    def activity(self, address):
        response = self.rpc.call("getSignaturesForAddress", [address, {"commitment": "finalized", "limit": 20}])
        rows = response["result"]
        if not isinstance(rows, list) or len(rows) > 20:
            raise ProviderError("Invalid transaction activity")
        records = []
        for row in rows:
            if not isinstance(row, dict) or type(row.get("slot")) is not int or row["slot"] < 0:
                raise ProviderError("Invalid activity record")
            block_time, timestamp = row.get("blockTime"), None
            if type(block_time) is int:
                try:
                    timestamp = datetime.fromtimestamp(block_time, timezone.utc).isoformat()
                except (ValueError, OSError, OverflowError):
                    pass
            records.append({
                "signature": safe_signature(row.get("signature")), "slot": row["slot"],
                "block_time": timestamp, "result": ("FAILED" if row["err"] is not None else "SUCCESSFUL") if "err" in row else "UNVERIFIED",
                "confirmation_status": row.get("confirmationStatus"),
                "classification": "OBSERVED", "source": response["_evidence"],
                "quality_flags": ["LIMITED_ADDRESS_MENTIONS_NOT_ALL_TOKEN_TRADES"],
            })
            if row.get("confirmationStatus") != "finalized":
                records[-1]["quality_flags"].append("REPORTED_FINALITY_UNVERIFIED")
        return {"status": "AVAILABLE", "records": records, "source": response["_evidence"],
                "coverage": "Latest 20 transactions mentioning this address; not a complete trade/transfer ledger"}

    def holders(self, address, mint):
        response = self.rpc.call("getTokenLargestAccounts", [address, {"commitment": "finalized"}])
        rows = response["result"].get("value")
        if not isinstance(rows, list) or len(rows) > 20:
            raise ProviderError("Invalid largest-token-account collection")
        balances, seen = [], set()
        supply = int(mint["supply_raw"])
        flags = ["TOKEN_ACCOUNTS_NOT_UNIQUE_WALLETS", "POOL_BURN_TREASURY_ROLES_UNVERIFIED"]
        if response["_evidence"]["slot"] != mint["slot"]:
            flags.append("NON_ATOMIC_SLOTS")
        for row in rows:
            if not isinstance(row, dict):
                raise ProviderError("Invalid largest-token-account row")
            token_account, amount = row.get("address"), row.get("amount")
            decode_address(token_account)
            if token_account in seen or not isinstance(amount, str) or not amount.isdigit() or len(amount) > 20:
                raise ProviderError("Invalid or duplicate token-account balance")
            raw = int(amount)
            if raw > 2**64 - 1 or row.get("decimals") != mint["decimals"]:
                raise ProviderError("Token balance units differ from mint")
            seen.add(token_account)
            balances.append((token_account, raw))
        total = sum(raw for _, raw in balances)
        valid_denominator = supply > 0 and total <= supply
        if not valid_denominator:
            flags.append("SUPPLY_DENOMINATOR_UNAVAILABLE_OR_INCONSISTENT")
        sources = [mint["evidence"], response["_evidence"]]
        return {
            "status": "AVAILABLE", "source": response["_evidence"], "quality_flags": flags,
            "accounts": [{"address": address, "balance": measurement(units(raw, mint["decimals"]), response["_evidence"]),
                          "supply_share_pct": measurement(ratio(number(raw) * 100, number(supply)) if valid_denominator else None,
                                                          sources, "DERIVED", flags=flags)} for address, raw in balances],
            "top_accounts_supply_share_pct": measurement(ratio(number(total) * 100, number(supply)) if valid_denominator else None,
                                                        sources, "DERIVED", flags=flags),
        }

    def scan(self, address, refresh=False):
        decode_address(address)
        with self.lock:
            cached = self.cache.get(address)
            if cached and time.monotonic() - cached[0] < (5 if refresh else 30):
                result = copy.deepcopy(cached[1])
                result["cached"] = True
                return result
        if not self.limiter.allow("providers", 30) or not self.slots.acquire(blocking=False):
            raise BusyError("Scanner capacity reached; retry shortly")
        try:
            with ThreadPoolExecutor(max_workers=3) as pool:
                tasks = [
                    pool.submit(self._collect, lambda: self._mint(address), "Solana RPC", self.config.rpc_url, "getAccountInfo"),
                    pool.submit(self._collect, lambda: self.market.pools(address), "DEX Screener", MARKET_URL, "token-pairs"),
                    pool.submit(self._collect, lambda: self.market.pools(WRAPPED_SOL), "DEX Screener", MARKET_URL, "SOL price reference"),
                ]
                (mint, mint_gap), (market_result, market_gap), (sol_result, sol_gap) = [task.result() for task in tasks]
            mint = mint or {"mint": address, "status": "FAILED", "reason": "Mint source unavailable", "evidence": mint_gap}
            pools, market_proof = market_result if market_result else ([], market_gap)
            sol_pools, sol_proof = sol_result if sol_result else ([], sol_gap)
            market = summarize_market(pools, market_proof, sol_pools, sol_proof)
            holders, activity = None, None
            holders_gap = activity_gap = None
            if mint["status"] == "AVAILABLE":
                with ThreadPoolExecutor(max_workers=2) as pool:
                    h = pool.submit(self._collect, lambda: self.holders(address, mint), "Solana RPC", self.config.rpc_url, "getTokenLargestAccounts")
                    a = pool.submit(self._collect, lambda: self.activity(address), "Solana RPC", self.config.rpc_url, "getSignaturesForAddress")
                    holders, holders_gap = h.result()
                    activity, activity_gap = a.result()
            holders = holders or {"status": "UNAVAILABLE" if not holders_gap else "FAILED", "accounts": [],
                                   "source": holders_gap, "reason": "Holder data requires a verified mint and successful RPC"}
            activity = activity or {"status": "UNAVAILABLE" if not activity_gap else "FAILED", "records": [],
                                     "source": activity_gap, "reason": "Activity source is unavailable"}
            findings = []
            def finding(code, message, field, classification="DERIVED"):
                findings.append({"code": code, "message": message, "evidence_field": field,
                                 "classification": classification})
            if mint["status"] == "AVAILABLE":
                if mint["mint_authority"] is not None:
                    finding("MINT_AUTHORITY_ACTIVE", "Mint authority can increase supply.", "mint_info.mint_authority")
                if mint["freeze_authority"] is not None:
                    finding("FREEZE_AUTHORITY_ACTIVE", "Freeze authority can restrict token accounts.", "mint_info.freeze_authority")
                if mint["extension_type_ids"]:
                    finding("EXTENSIONS_REQUIRE_REVIEW", "Token-2022 extensions are present; their controls are not yet interpreted.",
                            "mint_info.extension_type_ids")
            else:
                finding("MINT_UNVERIFIED", "The on-chain mint was not verified; market figures remain provider-reported.",
                        "mint_info.status", "OBSERVED")
            for name, section in (("market", market), ("holders", holders), ("activity", activity)):
                if section["status"] != "AVAILABLE":
                    finding("SOURCE_GAP", f"{name.capitalize()} data is incomplete.", f"{name}.status", "OBSERVED")
            share = number(holders.get("top_accounts_supply_share_pct", {}).get("value"))
            if share is not None and share >= 50:
                finding("ACCOUNT_CONCENTRATION", "The returned largest token accounts exceed 50% of supply; their wallet roles are unverified.",
                        "holders.top_accounts_supply_share_pct")
            report = {
                "mint": address, "available_at": now(), "cached": False,
                "status": "AVAILABLE" if mint["status"] == market["status"] == "AVAILABLE" else "UNVERIFIED",
                "network": "solana-mainnet", "network_evidence": self.rpc.network_receipt,
                "mint_info": mint, "market": market, "holders": holders, "activity": activity,
                "risk_findings": findings,
                "accounting": {"realized_pnl_usd": None, "unrealized_pnl_usd": None, "realized_pnl_sol": None,
                               "deposits": None, "withdrawals": None, "fees": None, "status": "UNAVAILABLE",
                               "reason": "Complete historical trades, cost basis, fees and transfers are required"},
                "limitations": ["No fraud or safety verdict", "Liquidity is provider-reported; lock/burn status unverified",
                                "Pool creation is not mint creation", "Retrieval freshness is not upstream tick freshness",
                                "Largest token accounts are not unique holders", "No signing or trade execution"],
            }
            self.store.save(report)
            with self.lock:
                self.cache[address] = (time.monotonic(), copy.deepcopy(report))
                self.cache.move_to_end(address)
                while len(self.cache) > 256:
                    self.cache.popitem(last=False)
                self.last_sources = {"mint": mint["evidence"], "market": market_proof, "sol_reference": sol_proof,
                                     "holders": holders.get("source"), "activity": activity.get("source")}
            return report
        finally:
            self.slots.release()

    def wallet(self, address):
        decode_address(address)
        if not self.limiter.allow("providers", 30) or not self.slots.acquire(blocking=False):
            raise BusyError("Scanner capacity reached; retry shortly")
        try:
            balance, balance_gap = self._collect(
                lambda: self.rpc.call("getBalance", [address, {"commitment": "finalized"}]),
                "Solana RPC", self.config.rpc_url, "getBalance")
            activity, gap = self._collect(lambda: self.activity(address), "Solana RPC",
                                          self.config.rpc_url, "getSignaturesForAddress")
            lamports = balance["result"]["value"] if balance else None
            if lamports is not None and (type(lamports) is not int or not 0 <= lamports <= 2**64 - 1):
                raise ProviderError("Invalid lamport balance")
            proof = balance["_evidence"] if balance else balance_gap
            sol_result, sol_gap = self._collect(lambda: self.market.pools(WRAPPED_SOL), "DEX Screener",
                                                MARKET_URL, "SOL price reference")
            sol_pools, sol_proof = sol_result if sol_result else ([], sol_gap)
            reference = next((pool for pool in sol_pools if pool["price_usd"] is not None), None)
            sol_price = number(reference["price_usd"], True) if reference else None
            balance_sol = units(lamports, 9) if lamports is not None else None
            return {"wallet": address, "available_at": now(), "network_evidence": self.rpc.network_receipt,
                    "balance_sol": measurement(balance_sol, proof),
                    "balance_usd": measurement(format(number(balance_sol) * sol_price, "f") if balance_sol is not None and sol_price is not None else None,
                                               [proof, sol_proof], "DERIVED", flags=["NON_ATOMIC_PRICE_SNAPSHOTS"]),
                    "activity": activity or {"status": "FAILED", "records": [], "source": gap},
                    "accounting": {"status": "UNAVAILABLE", "realized_pnl": None, "unrealized_pnl": None,
                                   "deposits": None, "withdrawals": None, "fees": None,
                                   "reason": "Balance and transaction mentions do not establish profit or cost basis"}}
        finally:
            self.slots.release()
