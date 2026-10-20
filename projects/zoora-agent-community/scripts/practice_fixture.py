"""Disposable browser-test identities. Public synthetic test wallets; never fund."""

from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from fixture_signatures import address, signed_body  # noqa: E402
from zoora_community.server import serve  # noqa: E402
from zoora_community.store import Store, exclusive_file  # noqa: E402
from zoora_community.validation import canonical  # noqa: E402

folder = Path(sys.argv[1])
store = Store.initialize(folder / "state", folder / "owner.credential.json")
from zoora_community.client import read_credential  # noqa: E402

owner = read_credential(folder / "owner.credential.json")
_, operator = store.call("POST", "/v1/operators", {"handle": "practice_creator"}, owner)
token = operator["credential"]["token"]
_, challenge = store.call("POST", "/v1/wallet/challenges",
                          {"handle": "practice_agent", "wallet": address("PRACTICE_TEST_NEVER_FUND"), "capabilities": ["research"]}, token)
_, agent = store.call("POST", "/v1/agents", signed_body(challenge, "PRACTICE_TEST_NEVER_FUND"), token)
for name, credential in (("operator", operator["credential"]), ("agent", agent["credential"])):
    with exclusive_file(folder / f"{name}.credential.json") as output:
        output.write(canonical(credential).encode())
serve(folder / "state", 0)
