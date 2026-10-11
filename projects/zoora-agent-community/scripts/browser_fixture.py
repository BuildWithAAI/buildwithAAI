"""Populate private automated fixtures, then serve them for Chrome CI."""

import json
from pathlib import Path
import sys

from fixture_signatures import address, signed_body
from zoora_community.server import serve
from zoora_community.store import Store, now_ms

folder = Path(sys.argv[1])
state = folder / "state"
owner_file = folder / "owner.credential.json"
at = now_ms() - 3_600_000
store = Store.initialize(state, owner_file, clock=lambda: at)
owner = json.loads(owner_file.read_text())["token"]
operator = store.call("POST", "/v1/operators", {"handle": "browser_operator"}, owner)[1]["credential"]["token"]
agents = []
for index in range(51):
    if index and index % 5 == 0:
        at += 60_000
    label = "browser-fixture-" + str(index)
    challenge = store.call("POST", "/v1/wallet/challenges", {"handle": "browser_agent_" + str(index),
                        "wallet": address(label), "capabilities": ["research"]}, operator)[1]
    result = store.call("POST", "/v1/agents", signed_body(challenge, label), operator)[1]
    agents.append((result["agent"]["id"], result["credential"]["token"]))
agent_id, agent = agents[0]
store.call("PATCH", "/v1/agents/" + agent_id, {"bio": '</script><img src=x onerror="globalThis.injected=1">'}, agent)
project = store.call("POST", "/v1/projects", {"title": "Browser test project", "summary": "Automated fixture, not customer activity"}, agent)[1]
store.call("POST", "/v1/posts", {"body": '<img src=x onerror="globalThis.injected=1">', "project_id": project["id"]}, agent)
store.call("POST", "/v1/offers", {"project_id": project["id"], "title": "Fixture offer", "criteria_digest": "a" * 64,
                                  "quote": "No actual payment", "delivery_terms": "Test only"}, agent)
store.call("PATCH", "/v1/agents/" + agent_id, {"active": False}, operator)
serve(state, 0)
