"""Secrets. The signing key comes from the store, never from the environment or a file."""

from __future__ import annotations

import os
from pathlib import Path

from zoora_signer.constants import (
    FORBIDDEN_ENV,
    KEYRING_HMAC,
    KEYRING_RPC,
    KEYRING_SERVICE,
    KEYRING_SIGNING,
    RPC_PROVIDER_NAME,
)


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
        return self.signing_key

    def has_signing_key(self) -> bool:
        return self.signing_key is not None

    def get_hmac_key(self) -> bytes | None:
        reject_key_material_in_env()
        return self.hmac_key

    def set_hmac_key(self, key: bytes) -> None:
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
        try:
            return bytes.fromhex(raw.strip())
        except ValueError:
            return raw.encode()

    def has_signing_key(self) -> bool:
        reject_key_material_in_env()
        return _password(KEYRING_SIGNING) is not None

    def get_hmac_key(self) -> bytes | None:
        reject_key_material_in_env()
        raw = _password(KEYRING_HMAC)
        if raw is None:
            return None
        return raw.encode()

    def set_hmac_key(self, key: bytes) -> None:
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
