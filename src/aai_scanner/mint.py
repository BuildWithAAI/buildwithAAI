"""Read-only Solana mint inspection. No wallet access or transaction submission."""
from __future__ import annotations
import json
import urllib.request
from urllib.parse import urlparse

ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
TOKEN_PROGRAMS = {
    "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA": "SPL Token",
    "TokenzQdBNbLqP5VEhdkAS6EPF7MCiPZ8fR5hBzj": "Token-2022",
}
# Use the canonical Token-2022 program ID from official Solana documentation before enabling it.
TOKEN_PROGRAMS.pop("TokenzQdBNbLqP5VEhdkAS6EPF7MCiPZ8fR5hBzj")

def decode_address(address: str) -> bytes:
    if not isinstance(address, str) or not 32 <= len(address) <= 44:
        raise ValueError("Invalid Solana address length")
    n = 0
    for char in address:
        if char not in ALPHABET:
            raise ValueError("Invalid base58 character")
        n = n * 58 + ALPHABET.index(char)
    zeros = len(address) - len(address.lstrip("1"))
    data = b"\\x00" * zeros + (n.to_bytes((n.bit_length() + 7) // 8, "big") if n else b"")
    if len(data) != 32:
        raise ValueError("Solana public keys must decode to 32 bytes")
    return data

def rpc(endpoint: str, method: str, params: list) -> dict:
    if method != "getAccountInfo":
        raise ValueError("Read-only method not allowed")
    parsed = urlparse(endpoint)
    if parsed.scheme != "https" or not parsed.hostname:
        raise ValueError("RPC endpoint must be HTTPS")
    payload = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}).encode()
    request = urllib.request.Request(endpoint, data=payload, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(request, timeout=12) as response:
        data = response.read(1_000_001)
    if len(data) > 1_000_000:
        raise ValueError("RPC response exceeds size limit")
    result = json.loads(data)
    if "error" in result:
        raise RuntimeError("Solana RPC returned an error")
    return result

def inspect_mint(address: str, *, endpoint: str) -> dict:
    decode_address(address)
    response = rpc(endpoint, "getAccountInfo", [address, {"encoding": "base64", "commitment": "finalized"}])
    value = response.get("result", {}).get("value")
    if value is None:
        return {"mint": address, "status": "UNAVAILABLE", "reason": "Account not found", "source": endpoint}
    owner = value.get("owner")
    if owner not in TOKEN_PROGRAMS:
        return {"mint": address, "status": "UNVERIFIED", "reason": "Not a verified supported token program", "owner": owner}
    import base64
    raw = base64.b64decode(value["data"][0], validate=True)
    if len(raw) < 82 or raw[45] != 1:
        return {"mint": address, "status": "UNVERIFIED", "reason": "Account is not an initialized mint"}
    mint_option = int.from_bytes(raw[0:4], "little")
    freeze_option = int.from_bytes(raw[46:50], "little")
    if mint_option not in (0, 1) or freeze_option not in (0, 1):
        raise ValueError("Invalid authority option encoding")
    supply = int.from_bytes(raw[36:44], "little")
    decimals = raw[44]
    return {
        "mint": address, "status": "AVAILABLE", "token_program": TOKEN_PROGRAMS[owner],
        "supply_raw": str(supply), "decimals": decimals,
        "supply": str(supply / (10 ** decimals)) if decimals <= 18 else None,
        "mint_authority": None if mint_option == 0 else raw[4:36].hex(),
        "freeze_authority": None if freeze_option == 0 else raw[50:82].hex(),
        "slot": response.get("result", {}).get("context", {}).get("slot"),
        "commitment": "finalized", "source": endpoint,
        "market_price_usd": None, "liquidity_usd": None,
        "note": "Read-only mint inspection; market data integration not yet implemented",
    }
