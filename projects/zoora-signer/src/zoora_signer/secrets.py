"""Secrets. The signing key comes from the store, never from the environment or a file."""

from __future__ import annotations

import os
from pathlib import Path

from zoora_signer.constants import (
    FORBIDDEN_ENV,
    HMAC_MIN_BYTES,
    KEYRING_HMAC,
    KEYRING_RPC,
    KEYRING_SERVICE,
    KEYRING_SIGNING,
    RPC_PROVIDER_NAME,
    SIGNING_KEY_BYTES,
)


class InvalidSigningKey(ValueError):
    pass


def parse_signing_key(text: str) -> bytes:
    """Only a 64-byte keypair as 128 hex characters is accepted."""

    raw = text.strip()
    if raw.startswith("<") or " " in raw or raw.startswith("["):
        raise InvalidSigningKey("FORMAT")
    if len(raw) != SIGNING_KEY_BYTES * 2:
        raise InvalidSigningKey("FORMAT")
    try:
        decoded = bytes.fromhex(raw)
    except ValueError as exc:
        raise InvalidSigningKey("FORMAT") from exc
    if decoded.hex() != raw.lower():
        raise InvalidSigningKey("FORMAT")
    return decoded


def secret_needles(secret: bytes) -> tuple[str, ...]:
    import base64

    encoded = [
        secret.hex(),
        secret.hex().upper(),
        base64.b64encode(secret).decode(),
        _b58(secret),
        "[" + ",".join(str(byte) for byte in secret) + "]",
        "[" + ", ".join(str(byte) for byte in secret) + "]",
    ]
    try:
        text = secret.decode("utf-8")
    except UnicodeDecodeError:
        text = ""
    if text:
        encoded.append(text)
    return tuple(item for item in encoded if len(item) >= 8)


def _b58(data: bytes) -> str:
    alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
    value = int.from_bytes(data, "big")
    chars = []
    while value:
        value, rem = divmod(value, 58)
        chars.append(alphabet[rem])
    zeros = 0
    for byte in data:
        if byte == 0:
            zeros += 1
        else:
            break
    return "1" * zeros + "".join(reversed(chars))


def _hmac_bytes(key: bytes | None) -> bytes | None:
    if key is None or len(key) < HMAC_MIN_BYTES:
        return None
    return key


class KeyMaterialInEnv(RuntimeError):
    pass


def reject_key_material_in_env() -> None:
    for name in FORBIDDEN_ENV:
        if os.environ.get(name):
            raise KeyMaterialInEnv(name)


class MemorySecretStore:
    def __init__(self) -> None:
        self.signing_key: bytes | None = None
        self.hmac_key: bytes | None = None
        self.rpc_url: str | None = None

    def get_signing_key(self) -> bytes | None:
        reject_key_material_in_env()
        if self.signing_key is None:
            return None
        return parse_signing_key(self.signing_key.hex())

    def has_signing_key(self) -> bool:
        try:
            return self.get_signing_key() is not None
        except InvalidSigningKey:
            return False

    def get_hmac_key(self) -> bytes | None:
        reject_key_material_in_env()
        return _hmac_bytes(self.hmac_key)

    def set_hmac_key(self, key: bytes) -> None:
        if _hmac_bytes(key) is None:
            raise InvalidSigningKey("HMAC_SHORT")
        self.hmac_key = key

    def get_rpc_url(self) -> str | None:
        reject_key_material_in_env()
        return self.rpc_url


class KeyringSecretStore:
    """Windows Credential Manager through the keyring package. Values are never logged."""

    def __init__(self, rpc_env_file: Path | None = None) -> None:
        self._rpc_env_file = rpc_env_file

    def get_signing_key(self) -> bytes | None:
        reject_key_material_in_env()
        raw = _password(KEYRING_SIGNING)
        if raw is None:
            return None
        return parse_signing_key(raw)

    def has_signing_key(self) -> bool:
        try:
            return self.get_signing_key() is not None
        except InvalidSigningKey:
            return False

    def get_hmac_key(self) -> bytes | None:
        reject_key_material_in_env()
        raw = _password(KEYRING_HMAC)
        if raw is None:
            return None
        try:
            decoded = bytes.fromhex(raw.strip())
        except ValueError:
            return None
        return _hmac_bytes(decoded)

    def set_hmac_key(self, key: bytes) -> None:
        if _hmac_bytes(key) is None:
            raise InvalidSigningKey("HMAC_SHORT")
        import keyring

        keyring.set_password(KEYRING_SERVICE, KEYRING_HMAC, key.hex())

    def get_rpc_url(self) -> str | None:
        reject_key_material_in_env()
        raw = _password(KEYRING_RPC)
        if raw:
            return raw.strip()
        if self._rpc_env_file is not None:
            return read_rpc_env_file(self._rpc_env_file)
        return None


def _password(account: str) -> str | None:
    import keyring

    return keyring.get_password(KEYRING_SERVICE, account)


_FORBIDDEN_FILE_KEYS = (
    "SIGNER",
    "SEED",
    "SECRET",
    "HMAC",
    "PRIVATE",
    "MNEMONIC",
    "SIGNING",
)


def read_rpc_env_file(path: Path) -> str | None:
    """RPC URL only. A signing key in this file is refused."""

    if not path.is_file():
        return None
    url: str | None = None
    provider = RPC_PROVIDER_NAME
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        name = key.strip().upper()
        if any(part in name for part in _FORBIDDEN_FILE_KEYS):
            raise KeyMaterialInEnv(name)
        if name in {"ZOORA_RPC_URL", "HELIUS_RPC_URL"}:
            url = value.strip().strip('"').strip("'")
        elif name == "ZOORA_RPC_PROVIDER":
            provider = value.strip() or provider
    if provider != RPC_PROVIDER_NAME:
        return url
    return url
