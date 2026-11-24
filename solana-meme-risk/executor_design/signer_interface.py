"""Signer interface STUB. Design-only: there is deliberately no implementation, no key loading, no keypair code.

On Zoorped's machine a real implementation would decrypt the burner key from the encrypted keystore
(scrypt + AES-256-GCM, passphrase typed at start, optional DPAPI wrap; see docs/INHOUSE_EXECUTOR_DESIGN.md §5)
into memory only, and sign ONLY messages the transaction
inspector approved. It must never log, print, serialize, or return key material."""
from abc import ABC, abstractmethod


class Signer(ABC):
    @property
    @abstractmethod
    def pubkey(self) -> str: ...

    @abstractmethod
    def sign(self, inspected_message: bytes) -> bytes: ...


class NoSigner(Signer):
    """Used in shadow and dry-run phases. Simulation uses sigVerify=false, so no key is ever needed."""

    def __init__(self, pubkey: str):
        self._pubkey = pubkey

    @property
    def pubkey(self) -> str:
        return self._pubkey

    def sign(self, inspected_message: bytes) -> bytes:
        raise NotImplementedError("design skeleton: signing is not implemented and must not run on the bot box")
