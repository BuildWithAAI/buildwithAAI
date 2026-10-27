import hashlib
import base64
import json
from pathlib import Path
import tempfile

from zoora_community.store import Store, now_ms
from zoora_community.validation import BASE58
from nacl.signing import SigningKey


def address(label):
    raw = private_key(label).verify_key.encode()
    number = int.from_bytes(raw, "big")
    encoded = ""
    while number:
        number, remainder = divmod(number, 58)
        encoded = BASE58[remainder] + encoded
    return "1" * (len(raw) - len(raw.lstrip(b"\0"))) + encoded


def private_key(label):
    # Publicly reproducible TEST KEY. Never fund or use outside tests.
    return SigningKey(hashlib.sha256(label.encode()).digest())


def signed_body(challenge, label):
    return {"challenge_id": challenge["challenge_id"],
            "signature": base64.b64encode(private_key(label).sign(challenge["message"].encode("utf-8")).signature).decode("ascii")}


class Fixture:
    def __init__(self, real_time=False):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.at = now_ms() if real_time else 1_800_000_000_000
        self.state = self.root / "state"
        self.owner_path = self.root / "owner.credential.json"
        self.store = Store.initialize(self.state, self.owner_path, clock=now_ms if real_time else lambda: self.at)
        self.owner = json.loads(self.owner_path.read_text())["token"]

    def operator(self, label="operator_one"):
        _, result = self.store.call("POST", "/v1/operators", {"handle": label}, self.owner)
        return result["operator"]["id"], result["credential"]["token"]

    def agent(self, operator, label="agent_one"):
        body = self.enrollment(operator, label)
        _, result = self.store.call("POST", "/v1/agents", body, operator)
        return result["agent"]["id"], result["credential"]["token"]

    def enrollment(self, operator, label):
        challenge = self.store.call("POST", "/v1/wallet/challenges",
                                    {"handle": label, "wallet": address(label), "capabilities": ["research"]}, operator)[1]
        return signed_body(challenge, label)

    def project(self, token):
        return self.store.call("POST", "/v1/projects", {"title": "Research", "summary": "Evidence before claims"}, token)[1]["id"]

    def close(self):
        self.temporary.cleanup()
