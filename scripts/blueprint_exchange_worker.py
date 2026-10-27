"""Client operations for the blueprint extension; all executable work uses services."""

from src.ecosystem_research import blueprints as b, network as n, services as s
from src.multi_brain_research import training_lab as lab
from src.solana_research import coin_evidence as ev


def action(client, token, command):
    return client.request("POST", b.ROOT_ROUTE + "/actions", b.command_value(command), token)[1]


def automatic(kind, record, **fields):
    return {"kind": kind, "request_id": lab.digest([b.PROTOCOL, kind, record])[:32], **fields}


def fetch(client, token, cfg):
    _, catalog = client.request("GET", s.ROOT_ROUTE + "/catalog", token=token)
    lab.require(lab.digest(catalog) == cfg["catalog_sha256"], "BLUEPRINT_CATALOG_PIN")
    _, delivery = client.request("GET", b.ROOT_ROUTE + "/licenses/" + n.identity(cfg["license_id"]) + "/delivery", token=token)
    receipt = b.verify_delivery(delivery, cfg["license_id"], cfg["expected_principal"],
                                cfg["package_sha256"], cfg["terms_sha256"], catalog)
    return delivery, receipt


def leaf(verb, cfg, client, token, service_worker):
    lab.require(cfg.get("expected_role", "AGENT") == "AGENT", "BLUEPRINT_AGENT_REQUIRED")
    if verb == "blueprint-act":
        if cfg.get("action_file"):
            path = n.safe_path(cfg["action_file"])
            lab.require(path.is_file() and path.stat().st_size <= 12000, "BLUEPRINT_COMMAND_BOUND")
            command = ev.read(path)
        else:
            command = cfg["action"]
        return action(client, token, command)
    if verb == "blueprint-observe":
        return client.request("GET", b.ROOT_ROUTE + "/view", token=token)[1]
    if verb == "blueprint-terms":
        return client.request("GET", b.ROOT_ROUTE + "/listings/" + n.identity(cfg["listing_id"]) + "/terms", token=token)[1]
    delivery, receipt = fetch(client, token, cfg)
    if verb == "blueprint-fetch":
        if cfg.get("output"):
            target = n.safe_path(cfg["output"])
            if target.exists():
                lab.require(target.is_file() and target.stat().st_nlink == 1 and target.stat().st_size <= 20000
                            and target.read_bytes() == n.raw(delivery), "BLUEPRINT_OUTPUT_CONFLICT")
            else:
                ev.write(target, delivery)
        return receipt
    license_, listing = delivery["license"], delivery["listing"]
    lab.require(license_["state"] in ("ACQUIRED", "ACCEPTED"), "BLUEPRINT_ALREADY_DECIDED")
    _, view = client.request("GET", s.ROOT_ROUTE + "/view", token=token)
    source = view["listings"].get(listing["service_listing_id"])
    lab.require(source is not None and source["provider_id"] == listing["provider_id"]
                and source["project_id"] == listing["project_id"]
                and source["service"] == listing["recipe"]["service"]
                and source["resource_sha256"] == listing["recipe"]["resource_sha256"], "BLUEPRINT_TRIAL_BINDING")
    if verb == "blueprint-trial":
        # Stable identity makes a lost ORDER response recoverable, not a second reservation.
        result = service_worker.action(client, token, {
            "kind": "ORDER", "request_id": lab.digest([b.PROTOCOL, "TRIAL", license_["id"]])[:32],
            "mandate_id": n.identity(cfg["mandate_id"]), "listing_id": source["id"],
            "terms_sha256": source["terms_sha256"], "start_before_ms": b.integer(cfg["start_before_ms"], 0, 2**53 - 1),
        })
        return {**result, "blueprint_receipt": receipt}
    lab.require(verb == "blueprint-accept", "BLUEPRINT_CLIENT_ACTION")
    order = view["orders"].get(n.identity(cfg["trial_order_id"]))
    lab.require(order is not None and order["listing_id"] == source["id"]
                and order["buyer_id"] == cfg["expected_principal"]
                and order["state"] in ("DELIVERED", "ACCEPTED"), "BLUEPRINT_TRIAL_REQUIRED")
    # The buyer replays actual remote inputs before the existing service acceptance.
    trial = service_worker.for_order("accept", {**cfg, "order_id": order["id"]}, client, token, view)
    result = action(client, token, automatic("ACCEPT", license_["id"], license_id=license_["id"],
                                            package_sha256=receipt["package_sha256"], trial_order_id=order["id"]))
    return {**result, "blueprint_receipt": receipt, "trial": trial}
