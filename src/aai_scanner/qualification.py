"""Explicit configured-provider capability checks, with no recovery or database writes."""
import time
from .evidence import failed_source, now, units
from .market import WRAPPED_SOL
from .mint import decode_address
from .service import Scanner
from .transport import ProviderError, RpcClient

DEFAULT_WALLET = "11111111111111111111111111111111"


class DeadlineClient:
    def __init__(self, client, deadline):
        self.client, self.deadline = client, deadline

    def call(self, method, params):
        return self.client.call(method, params, self.deadline)


def qualify_providers(config, mint=WRAPPED_SOL, wallet=DEFAULT_WALLET, require_all=False):
    """One request per required method/provider, mainnet first, expensive holders last."""
    config.validate()
    decode_address(mint)
    decode_address(wallet)
    providers = []
    for index, endpoint in enumerate((config.rpc_url,) + config.rpc_fallback_urls):
        started = time.monotonic()
        client = RpcClient(endpoint, config.timeout, f"rpc-{index + 1}")
        bounded = DeadlineClient(client, started + min(60, 5 * config.timeout))
        scanner = Scanner(config, None, rpc=bounded)
        checks = {}

        def check(method, function):
            try:
                summary, proof = function()
                status = summary.get("status", "AVAILABLE")
                checks[method] = {"status": status, "classification": "OBSERVED", "summary": summary, "source": proof}
                return summary
            except (ProviderError, ValueError, TypeError, KeyError, IndexError) as error:
                proof = failed_source("Solana RPC", endpoint, method, "Provider capability check failed")
                proof["provider_id"] = client.provider_id
                proof["error"] = error.details() if isinstance(error, ProviderError) else {"code": "SOURCE_VALIDATION_FAILED"}
                checks[method] = {"status": "FAILED", "classification": "OBSERVED", "source": proof}
                return None

        def genesis():
            result = bounded.call("getGenesisHash", [])
            return {"genesis_hash": result["result"]}, result["_evidence"]

        if check("getGenesisHash", genesis) is not None:
            mint_data = None
            def mint_state():
                nonlocal mint_data
                mint_data = scanner._mint(mint)
                return {"status": mint_data["status"], "token_program": mint_data.get("token_program"),
                        "slot": mint_data.get("slot"), "decimals": mint_data.get("decimals")}, mint_data["evidence"]
            check("getAccountInfo", mint_state)

            def activity():
                result = scanner.activity(mint)
                return {"records_returned": len(result["records"])}, result["source"]
            check("getSignaturesForAddress", activity)

            def balance():
                result = bounded.call("getBalance", [wallet])
                raw = result["result"]["value"]
                if type(raw) is not int or not 0 <= raw <= 2**64 - 1:
                    raise ProviderError("Invalid lamport balance")
                return {"balance_sol": units(raw, 9)}, result["_evidence"]
            check("getBalance", balance)

            if mint_data and mint_data["status"] == "AVAILABLE":
                def holders():
                    result = scanner.holders(mint, mint_data)
                    return {"accounts_returned": len(result["accounts"]), "quality_flags": result["quality_flags"]}, result["source"]
                check("getTokenLargestAccounts", holders)
        for method in ("getGenesisHash", "getAccountInfo", "getSignaturesForAddress", "getBalance", "getTokenLargestAccounts"):
            checks.setdefault(method, {"status": "UNVERIFIED", "classification": "DERIVED",
                                       "missingness": "PREREQUISITE_FAILED", "source": None})
        passed = all(item["status"] == "AVAILABLE" for item in checks.values())
        providers.append({"provider_id": client.provider_id, "endpoint_host": client.diagnostics()["endpoint_host"],
                          "status": "PASSED" if passed else "FAILED", "checks": checks,
                          "duration_seconds": round(time.monotonic() - started, 3), "diagnostics": client.diagnostics()})
    any_passed = any(provider["status"] == "PASSED" for provider in providers)
    all_passed = all(provider["status"] == "PASSED" for provider in providers)
    return {"verification_type": "LIVE_READ_ONLY_PROVIDER_CAPABILITY_CHECK", "available_at": now(),
            "status": "PASSED" if (all_passed if require_all else any_passed) else "FAILED",
            "required_policy": "ALL_CONFIGURED_PROVIDERS" if require_all else "AT_LEAST_ONE_PROVIDER",
            "at_least_one_provider_qualified": any_passed, "all_configured_providers_qualified": all_passed,
            "mint": mint, "wallet": wallet, "providers": providers, "execution": "DISABLED",
            "note": "Point-in-time valid reads for these addresses, not capacity, uptime, complete holder history, "
                    "market verification or public launch. Each configured provider is tested independently without failover. "
                    "Cooldowns are respected; no immediate retries or provider discovery. "
                    "This does not certify the configured failover path: primary access/validation failures still fail closed."}
