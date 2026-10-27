"""Bounded, order-scoped evidence transfer; reconstruct records, never remote SQL."""

from __future__ import annotations

import base64
from contextlib import contextmanager
from copy import deepcopy
from pathlib import Path
import tempfile

from . import network as n, scanner_feed as f
from ..multi_brain_research import training_lab as lab
from ..solana_research import coin_evidence as ev

PROTOCOL = "AAI_SERVICE_EVIDENCE_V1"
MAX_BYTES = 16 * 1024**2
CHUNK_BYTES = 512 * 1024
MAX_CHUNKS = MAX_BYTES // CHUNK_BYTES


def integer(value, low, high):
    lab.require(type(value) is int and low <= value <= high, "EVIDENCE_INTEGER")
    return value


class Export:
    def __init__(self, journal, head, policy):
        self.head, self.policy = lab.pin(head), lab.pin(policy)
        lab.require(lab.digest(journal.rules) == policy, "EVIDENCE_POLICY_PIN")
        state = journal.snapshot(head)
        lab.require(0 < len(state["events"]) <= f.MAX_RECORDS, "EVIDENCE_RECORD_BOUND")
        self.payload = n.raw({
            "protocol": PROTOCOL,
            "policy": journal.rules,
            "records": [e["record"] for e in state["events"]],
            "feed_head_sha256": head,
            "feed_policy_sha256": policy,
            "source_scope": "HISTORICAL_CAPTURE_REPLAY",
            "live_execution_allowed": False,
        })
        lab.require(0 < len(self.payload) <= MAX_BYTES, "EVIDENCE_BYTE_BOUND")
        self.sha = ev.sha(self.payload)
        self.count = len(state["events"])
        self.chunks = [self.payload[i:i + CHUNK_BYTES]
                       for i in range(0, len(self.payload), CHUNK_BYTES)]

    def manifest(self, catalog, order):
        return {
            "protocol": PROTOCOL, "catalog_sha256": lab.pin(catalog),
            "order_id": n.identity(order), "payload_sha256": self.sha,
            "bytes": len(self.payload), "records": self.count,
            "feed_head_sha256": self.head, "feed_policy_sha256": self.policy,
            "chunks": [{"index": i, "bytes": len(p), "sha256": ev.sha(p)}
                       for i, p in enumerate(self.chunks)],
            "source_scope": "HISTORICAL_CAPTURE_REPLAY",
            "financial_settlement": False, "live_execution_allowed": False,
        }

    def chunk(self, catalog, order, digest, index):
        lab.require(digest == self.sha, "EVIDENCE_EXPORT_CHANGED")
        integer(index, 0, len(self.chunks) - 1)
        payload = self.chunks[index]
        return {
            "protocol": PROTOCOL, "catalog_sha256": lab.pin(catalog),
            "order_id": n.identity(order), "payload_sha256": self.sha,
            "index": index, "bytes": len(payload), "sha256": ev.sha(payload),
            "raw_base64": base64.b64encode(payload).decode("ascii"),
            "live_execution_allowed": False,
        }


def validate_manifest(value, catalog, order, head, policy):
    lab.exact(value, ("protocol", "catalog_sha256", "order_id", "payload_sha256",
                     "bytes", "records", "feed_head_sha256", "feed_policy_sha256",
                     "chunks", "source_scope", "financial_settlement", "live_execution_allowed"))
    lab.require(value["protocol"] == PROTOCOL
                and value["catalog_sha256"] == lab.pin(catalog)
                and value["order_id"] == n.identity(order)
                and value["feed_head_sha256"] == lab.pin(head)
                and value["feed_policy_sha256"] == lab.pin(policy)
                and value["source_scope"] == "HISTORICAL_CAPTURE_REPLAY"
                and value["financial_settlement"] is False
                and value["live_execution_allowed"] is False, "EVIDENCE_MANIFEST_BINDING")
    lab.pin(value["payload_sha256"])
    size = integer(value["bytes"], 1, MAX_BYTES)
    integer(value["records"], 1, f.MAX_RECORDS)
    chunks = value["chunks"]
    lab.require(type(chunks) is list and len(chunks) == (size + CHUNK_BYTES - 1) // CHUNK_BYTES
                and len(chunks) <= MAX_CHUNKS, "EVIDENCE_CHUNK_COUNT")
    for index, chunk in enumerate(chunks):
        lab.exact(chunk, ("index", "bytes", "sha256"))
        lab.require(integer(chunk["index"], 0, MAX_CHUNKS - 1) == index
                    and integer(chunk["bytes"], 1, CHUNK_BYTES)
                    == min(CHUNK_BYTES, size - index * CHUNK_BYTES), "EVIDENCE_CHUNK_LAYOUT")
        lab.pin(chunk["sha256"])
    return deepcopy(value)


def decode_chunk(value, manifest, index):
    lab.exact(value, ("protocol", "catalog_sha256", "order_id", "payload_sha256",
                     "index", "bytes", "sha256", "raw_base64", "live_execution_allowed"))
    expected = manifest["chunks"][integer(index, 0, len(manifest["chunks"]) - 1)]
    lab.require(value["protocol"] == PROTOCOL
                and all(value[k] == manifest[k] for k in ("catalog_sha256", "order_id", "payload_sha256"))
                and integer(value["index"], 0, MAX_CHUNKS - 1) == index
                and integer(value["bytes"], 1, CHUNK_BYTES) == expected["bytes"]
                and value["sha256"] == expected["sha256"]
                and value["live_execution_allowed"] is False, "EVIDENCE_CHUNK_BINDING")
    payload = ev.unbase64(value["raw_base64"], CHUNK_BYTES)
    lab.require(len(payload) == expected["bytes"] and ev.sha(payload) == expected["sha256"],
                "EVIDENCE_CHUNK_CONTENT")
    return payload


def restore(payload, manifest, directory):
    """Validate and replay canonical records into a newly created local journal."""
    lab.require(type(payload) is bytes and 0 < len(payload) <= MAX_BYTES
                and len(payload) == manifest["bytes"]
                and ev.sha(payload) == manifest["payload_sha256"], "EVIDENCE_PAYLOAD_BINDING")
    value = ev.parse(payload)
    lab.exact(value, ("protocol", "policy", "records", "feed_head_sha256",
                     "feed_policy_sha256", "source_scope", "live_execution_allowed"))
    lab.require(n.raw(value) == payload and value["protocol"] == PROTOCOL
                and value["source_scope"] == "HISTORICAL_CAPTURE_REPLAY"
                and value["live_execution_allowed"] is False
                and all(value[k] == manifest[k] for k in ("feed_head_sha256", "feed_policy_sha256"))
                and lab.digest(value["policy"]) == manifest["feed_policy_sha256"],
                "EVIDENCE_PAYLOAD_SCOPE")
    records = value["records"]
    lab.require(type(records) is list and len(records) == manifest["records"]
                and 0 < len(records) <= f.MAX_RECORDS, "EVIDENCE_RECORD_BOUND")
    journal = f.ObservationJournal(Path(directory) / "observations.sqlite3", value["policy"]).initialize()
    head = manifest["feed_policy_sha256"]
    for record in records:
        added = journal.append(record, head)
        lab.require(not added["replayed"], "EVIDENCE_DUPLICATE_RECORD")
        head = added["head_sha256"]
    journal.snapshot(manifest["feed_head_sha256"])
    return journal


@contextmanager
def receive(client, token, catalog, order, head, policy):
    route = "/v1/services/orders/" + n.identity(order) + "/evidence"
    _, value = client.request("GET", route, token=token)
    manifest = validate_manifest(value, catalog, order, head, policy)
    pieces = []
    for index in range(len(manifest["chunks"])):
        _, chunk = client.request("GET", route + "/" + manifest["payload_sha256"] + "/" + str(index), token=token)
        pieces.append(decode_chunk(chunk, manifest, index))
    with tempfile.TemporaryDirectory(prefix="aai-evidence-") as temporary:
        journal = restore(b"".join(pieces), manifest, temporary)
        yield journal, {
            "mode": "AUTHENTICATED_RECORD_TRANSFER", "payload_sha256": manifest["payload_sha256"],
            "bytes": manifest["bytes"], "records": manifest["records"], "chunks": len(pieces),
            "feed_head_sha256": head, "feed_policy_sha256": policy,
            "independent_source_attestation": False,
        }
