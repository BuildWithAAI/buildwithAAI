"""Public synthetic purchase setup shared by protocol and actual-model rehearsals."""

from pathlib import Path
import time

from bridge_fixture import KEY, intent
from durable_commerce_evidence import policy, purchase
from zoora_community.payment_pipeline import PaymentPipeline
from zoora_community.validation import canonical


def private_json(path, value):
    path = Path(path)
    path.write_text(canonical(value), encoding="utf-8")
    path.chmod(0o600)
    return path


def setup_payments(client, folder, operator, agents, actors):
    config = policy()
    aliases = ["agent_one", "agent_two"][:len(agents)]
    config["authority"].update(agents=aliases, payment_budget=100, fee_budget=100)
    bindings = [{"alias": alias, "agent_id": agent["principal_id"]} for alias, agent in zip(aliases, agents, strict=True)]
    book = client.request("POST", "/v1/commerce/books", {"request_id": "a" * 32, "policy": config,
        "bindings": bindings}, operator)[1]["book"]
    source = client.request("GET", "/v1/status")[1]
    owner = client.request("GET", "/v1/me", token=operator)[1]["principal_id"]
    at = time.time_ns() // 1_000_000
    mandate = {"mandate_id": "b" * 32, "environment": "BRIDGE_SANDBOX", "real_funds_authorized": False,
        "instance_id": source["instance_id"], "operator_id": owner, "agents": [a["principal_id"] for a in agents],
        "customer_id": intent()["customer_id"], "source_address": intent()["source_address"],
        "merchants": [{"merchant": "supplier", "destination_address": intent()["destination_address"],
                       "activities": ["white_label_supply"]}],
        "payment_limit_usdc": "2", "admission_budget_usdc": "10", "valid_from_ms": at - 1000, "expires_ms": at + 900_000}
    pipeline = PaymentPipeline(folder / "pipeline")
    pipeline.initialize(mandate, client, operator)
    orders = []
    for index, actor in enumerate(actors, 1):
        command = purchase(index, amount=1)
        result = client.request("POST", "/v1/commerce/books/" + book["id"] + "/actions", {
            "request_id": f"{index + 1000:032x}", "command": command}, agents[actor]["token"])[1]
        if result["outcome"] != "AUTHORIZED":
            raise AssertionError("fixture purchase not authorized")
        record = next(p for p in result["book"]["state"]["purchases"]
                      if p["request"]["quote"]["purchase_id"] == f"{index:032x}")
        envelope = {"book_id": book["id"], "purchase_id": f"{index:032x}",
            "commerce_binding_sha256": record["binding_sha256"], "amount_usdc": "1.250000"}
        orders.append(pipeline.stage(envelope, client, agents[actor]["token"]))
    key = folder / "sandbox-key"
    key.write_text(KEY, encoding="ascii")
    key.chmod(0o600)
    return {"pipeline": pipeline, "orders": orders, "book": book, "key_file": key, "source": source, "at": at}


def scope_file(folder, setup, agent, keys, *, limit=1, expires=None):
    value = {"instance_id": setup["source"]["instance_id"], "agent_id": agent["principal_id"],
        "order_ids": keys, "max_advances": limit,
        "expires_at_ms": expires if expires is not None else setup["at"] + 600_000}
    return private_json(folder / "payment-scope.json", value)
