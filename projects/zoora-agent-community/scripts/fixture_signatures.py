"""Reproducible AUTOMATED TEST wallets. These public test keys must NEVER be funded."""

import base64
import hashlib

from nacl.signing import SigningKey

from zoora_community.validation import BASE58


def key(label):
    return SigningKey(hashlib.sha256(label.encode("utf-8")).digest())


def address(label):
    raw = key(label).verify_key.encode()
    number = int.from_bytes(raw, "big")
    encoded = ""
    while number:
        number, remainder = divmod(number, 58)
        encoded = BASE58[remainder] + encoded
    return "1" * (len(raw) - len(raw.lstrip(b"\0"))) + encoded


def signed_body(challenge, label):
    return {"challenge_id": challenge["challenge_id"],
            "signature": base64.b64encode(key(label).sign(challenge["message"].encode("utf-8")).signature).decode("ascii")}
