"""Read-only mint inspection with exact units and strict account layouts."""
import base64
import binascii
from .evidence import receipt, units
from .transport import ProviderError, RpcClient

ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
SPL_TOKEN = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
TOKEN_2022 = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"
TOKEN_PROGRAMS = {SPL_TOKEN: "SPL Token", TOKEN_2022: "Token-2022"}


def decode_address(address):
    if not isinstance(address, str) or not 32 <= len(address) <= 44:
        raise ValueError("Invalid Solana address length")
    n = 0
    for char in address:
        if char not in ALPHABET:
            raise ValueError("Invalid Base58 character")
        n = n * 58 + ALPHABET.index(char)
    zeros = len(address) - len(address.lstrip("1"))
    data = bytes([0]) * zeros + (n.to_bytes((n.bit_length() + 7) // 8, "big") if n else b"")
    if len(data) != 32:
        raise ValueError("Solana public keys must decode to 32 bytes")
    return data


def encode_address(data):
    if len(data) != 32:
        raise ValueError("Expected 32 bytes")
    number, digits = int.from_bytes(data, "big"), ""
    while number:
        number, rem = divmod(number, 58)
        digits = ALPHABET[rem] + digits
    return "1" * (len(data) - len(data.lstrip(bytes([0])))) + digits


def rpc(endpoint, method, params):
    if method != "getAccountInfo":
        raise ValueError("Read-only method not allowed")
    return RpcClient(endpoint).call(method, params)


def parse_mint(address, response, endpoint):
    result = response.get("result")
    if not isinstance(result, dict) or "value" not in result:
        raise ProviderError("Mint response is missing account value")
    slot = result.get("context", {}).get("slot")
    if type(slot) is not int or slot < 0:
        raise ProviderError("Mint response is missing a valid slot")
    proof = response.get("_evidence") or receipt("Solana RPC", endpoint, "getAccountInfo",
                                                slot=slot, commitment="finalized")
    common = {"mint": address, "source": proof["endpoint_host"], "evidence": proof,
              "slot": slot, "commitment": "finalized", "classification": "OBSERVED", "quality_flags": []}
    value = result["value"]
    if value is None:
        return dict(common, status="UNAVAILABLE", reason="Account not found")
    if not isinstance(value, dict):
        raise ProviderError("Invalid mint account shape")
    owner = value.get("owner")
    if owner not in TOKEN_PROGRAMS:
        return dict(common, status="UNVERIFIED", reason="Unsupported token program", owner=owner)
    data = value.get("data")
    if not isinstance(data, list) or len(data) != 2 or data[1] != "base64" or not isinstance(data[0], str):
        raise ProviderError("Mint data must be Base64")
    try:
        raw = base64.b64decode(data[0], validate=True)
    except (ValueError, binascii.Error):
        raise ProviderError("Invalid mint Base64") from None
    if value.get("executable") is True or len(raw) < 82 or raw[45] != 1:
        return dict(common, status="UNVERIFIED", reason="Account is not an initialized mint")
    extensions = []
    if len(raw) > 65536:
        return dict(common, status="UNVERIFIED", reason="Mint exceeds bounded inspection size")
    if owner == SPL_TOKEN and len(raw) != 82:
        return dict(common, status="UNVERIFIED", reason="Legacy account is not exactly an 82-byte mint")
    if owner == TOKEN_2022 and len(raw) != 82:
        if len(raw) < 166 or raw[165] != 1 or any(raw[82:165]):
            return dict(common, status="UNVERIFIED", reason="Invalid Token-2022 mint type or padding")
        offset = 166
        while offset < len(raw):
            if raw[offset:offset + 2] == bytes(2):
                if any(raw[offset:]):
                    raise ProviderError("Invalid extension padding")
                break
            if offset + 4 > len(raw):
                raise ProviderError("Truncated Token-2022 extension header")
            extension = int.from_bytes(raw[offset:offset + 2], "little")
            length = int.from_bytes(raw[offset + 2:offset + 4], "little")
            if not extension or extension in extensions or offset + 4 + length > len(raw):
                raise ProviderError("Invalid Token-2022 extension layout")
            if len(extensions) >= 64:
                raise ProviderError("Extension count exceeds inspection limit")
            extensions.append(extension)
            offset += 4 + length
        common["quality_flags"].append("TOKEN_2022_EXTENSION_SEMANTICS_NOT_DECODED")
    mint_option = int.from_bytes(raw[:4], "little")
    freeze_option = int.from_bytes(raw[46:50], "little")
    if mint_option not in (0, 1) or freeze_option not in (0, 1):
        raise ProviderError("Invalid authority option encoding")
    supply, decimals = int.from_bytes(raw[36:44], "little"), raw[44]
    return dict(common, status="AVAILABLE", token_program=TOKEN_PROGRAMS[owner],
                token_program_address=owner, supply_raw=str(supply), decimals=decimals,
                supply=units(supply, decimals), extension_type_ids=extensions,
                mint_authority=None if mint_option == 0 else encode_address(raw[4:36]),
                freeze_authority=None if freeze_option == 0 else encode_address(raw[50:82]),
                market_price_usd=None, liquidity_usd=None,
                note="Authority absence alone does not establish token safety")


def inspect_mint(address, *, endpoint):
    decode_address(address)
    response = rpc(endpoint, "getAccountInfo", [address, {"encoding": "base64", "commitment": "finalized"}])
    return parse_mint(address, response, endpoint)
