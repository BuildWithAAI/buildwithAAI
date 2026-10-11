"""Populate private automated fixtures, then serve them for Chrome CI."""

import json
from pathlib import Path
import sys

from integration_evidence import address
from zoora_community.server import serve
from zoora_community.store import Store

folder = Path(sys.argv[1])
state = folder / "state"
owner_file = folder / "owner.credential.json"
store = Store.initialize(state, owner_file)
owner = json.loads(owner_file.read_text())["token"]
operator = store.call("POST", "/v1/operators", {"handle": "browser_operator"}, owner)[1]["credential"]["token"]
agents = []
for index in range(51):
    result = store.call("POST", "/v1/agents", {"handle": "browser_agent_" + str(index),
                        "wallet": address("browser-fixture-" + str(index)), "capabilities": ["research"]}, operator)[1]
    agents.append((result["agent"]["id"], result["credential"]["token"]))
agent_id, agent = agents[0]
store.call("PATCH", "/v1/agents/" + agent_id, {"bio": '</script><img src=x onerror="globalThis.injected=1">'}, agent)
project = store.call("POST", "/v1/projects", {"title": "Browser test project", "summary": "Automated fixture, not customer activity"}, agent)[1]
store.call("POST", "/v1/posts", {"body": '<img src=x onerror="globalThis.injected=1">', "project_id": project["id"]}, agent)
store.call("POST", "/v1/offers", {"project_id": project["id"], "title": "Fixture offer", "criteria_digest": "a" * 64,
                                  "quote": "No actual payment", "delivery_terms": "Test only"}, agent)
store.call("PATCH", "/v1/agents/" + agent_id, {"active": False}, operator)
serve(state, 0)
