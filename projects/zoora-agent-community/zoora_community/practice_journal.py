"""Private paper experiment evidence; linked files are not external attestations."""

from contextlib import contextmanager
import hashlib
import os
from pathlib import Path
import re
import sqlite3
import stat

from .store import exclusive_file, private_regular
from .validation import DIGEST, Problem, canonical, fields, identifier, matching, parse_json, text

MAX_FILE = 65_536
STAGES = ("observation", "decision", "acceptance", "settlement", "failure")
RECORD = re.compile(r"tick-(\d{3})-(observation|decision|acceptance|settlement|failure)\.json\Z")


def digest(value):
    return hashlib.sha256(canonical(value).encode("utf-8")).hexdigest()


def bounded(value, low, high):
    if type(value) is not int or not low <= value <= high:
        raise Problem(400, "INVALID_PRACTICE_WORKER_INTEGER")
    return value


def validate_scope(scope):
    fields(scope, ("version", "experiment_id", "episode_id", "agent_id", "instance_id",
                   "model", "model_pipeline_sha256", "created_at_ms", "expires_at_ms",
                   "max_decisions", "max_buy_micro"))
    if type(scope["version"]) is not int or scope["version"] != 1:
        raise Problem(400, "INVALID_PRACTICE_SCOPE")
    for key in ("experiment_id", "episode_id", "agent_id", "instance_id"):
        identifier(scope[key])
    matching(scope["model_pipeline_sha256"], DIGEST, "INVALID_PIPELINE_SHA256")
    text(scope["model"], 96)
    bounded(scope["created_at_ms"], 1, 9_000_000_000_000_000)
    bounded(scope["expires_at_ms"], scope["created_at_ms"] + 1, scope["created_at_ms"] + 86_400_000)
    bounded(scope["max_decisions"], 1, 64)
    bounded(scope["max_buy_micro"], 1, 250_000_000)
    return scope


def validate_decision(action, snapshot, scope):
    fields(action, ("side", "coin_id", "amount", "min_output", "note"))
    text(action["note"], 512)
    bounded(action["amount"], 0, 9_000_000_000_000_000)
    bounded(action["min_output"], 0, 9_000_000_000_000_000)
    if action["side"] == "HOLD":
        if action["coin_id"] != "" or action["amount"] != 0 or action["min_output"] != 0:
            raise Problem(400, "INVALID_PAPER_HOLD")
        return action
    if action["side"] not in ("BUY", "SELL"):
        raise Problem(400, "INVALID_PAPER_DECISION")
    identifier(action["coin_id"])
    coin = next((c for c in snapshot["market"]["coins"] if c["id"] == action["coin_id"]), None)
    if coin is None or action["amount"] == 0 or action["min_output"] == 0:
        raise Problem(400, "INVALID_PAPER_ORDER")
    account = snapshot["account"]
    if coin["stage"] not in ("CURVE", "AMM"):
        raise Problem(409, "PAPER_MARKET_UNAVAILABLE")
    gas = snapshot["market"]["policy"]["gas_micro"]
    if account["cash_micro"] < gas + (action["amount"] if action["side"] == "BUY" else 0):
        raise Problem(409, "PAPER_CASH_LIMIT")
    if action["side"] == "BUY" and (account["buy_halted"] or action["amount"] > scope["max_buy_micro"]):
        raise Problem(409, "PAPER_BUY_LIMIT")
    positions = {p["coin_id"]: p["tokens"] for p in account["positions"]}
    if action["side"] == "SELL" and action["amount"] > positions.get(action["coin_id"], 0):
        raise Problem(409, "PAPER_POSITION_LIMIT")
    return action


def order_body(manifest, snapshot, action):
    scope = manifest["scope"]
    identity = {key: scope[key] for key in ("experiment_id", "instance_id", "episode_id", "agent_id")}
    identity["tick"] = snapshot["tick"]
    return {"request_id": digest(identity)[:32], "observation_tick": snapshot["tick"],
            **{key: action[key] for key in ("coin_id", "side", "amount", "min_output")}}


class Journal:
    def __init__(self, folder):
        self.folder = Path(folder).absolute()

    @contextmanager
    def locked(self):
        self.folder.mkdir(mode=0o700, exist_ok=True)
        info = self.folder.lstat()
        if not stat.S_ISDIR(info.st_mode) or (os.name == "posix" and
                (stat.S_IMODE(info.st_mode) & 0o077 or info.st_uid != os.getuid())):
            raise Problem(503, "UNSAFE_PRACTICE_JOURNAL")
        path = self.folder / "worker-lock.sqlite3"
        try:
            with exclusive_file(path):
                pass
        except FileExistsError:
            pass
        private_regular(path, 1_048_576)
        connection = sqlite3.connect(path.as_uri() + "?mode=rw", uri=True, timeout=0, isolation_level=None)
        try:
            connection.execute("CREATE TABLE IF NOT EXISTS mutex (id INTEGER PRIMARY KEY)")
            connection.execute("BEGIN EXCLUSIVE")
            yield self
        except sqlite3.OperationalError:
            raise Problem(409, "PRACTICE_WORKER_BUSY_OR_STORAGE_UNAVAILABLE") from None
        finally:
            connection.close()

    def read(self, name):
        path = self.folder / name
        private_regular(path, MAX_FILE)
        return parse_json(path.read_bytes(), MAX_FILE)

    def exists(self, name):
        path = self.folder / name
        return path.exists() or path.is_symlink()

    def save(self, name, value):
        raw = (canonical(value) + "\n").encode("utf-8")
        if len(raw) > MAX_FILE:
            raise Problem(413, "PRACTICE_EVIDENCE_TOO_LARGE")
        with exclusive_file(self.folder / name) as output:
            if output.write(raw) != len(raw):
                raise OSError("short evidence write")
            output.flush()
            os.fsync(output.fileno())
        if os.name == "posix":
            directory = os.open(self.folder, os.O_RDONLY | os.O_DIRECTORY)
            try:
                os.fsync(directory)
            finally:
                os.close(directory)

    @staticmethod
    def name(tick, stage):
        return f"tick-{tick:03d}-{stage}.json"

    def records(self, manifest):
        records = {}
        for path in self.folder.iterdir():
            if path.name in ("manifest.json", "worker-lock.sqlite3", "worker-lock.sqlite3-journal"):
                continue
            match = RECORD.fullmatch(path.name)
            if match is None:
                raise Problem(503, "PRACTICE_JOURNAL_UNKNOWN_FILE")
            tick, stage = int(match[1]), match[2]
            bounded(tick, 0, 119)
            records.setdefault(tick, {})[stage] = self.read(path.name)
        if len(records) > manifest["scope"]["max_decisions"]:
            raise Problem(503, "PRACTICE_JOURNAL_BUDGET_MISMATCH")
        for tick, record in sorted(records.items()):
            observation = record.get("observation")
            fields(observation, ("snapshot", "snapshot_sha256", "binding_sha256", "observed_at_ms"))
            snapshot = observation["snapshot"]
            fields(snapshot, ("episode_id", "commitment", "tick", "market", "account", "history"))
            if (snapshot["tick"] != tick or snapshot["market"]["tick"] != tick
                    or snapshot["episode_id"] != manifest["scope"]["episode_id"]
                    or snapshot["account"]["agent_id"] != manifest["scope"]["agent_id"]
                    or snapshot["account"]["model_pipeline_sha256"] != manifest["scope"]["model_pipeline_sha256"]
                    or [f["tick"] for f in snapshot["history"]] != list(range(max(0, tick - 7), tick + 1))
                    or observation["snapshot_sha256"] != digest(snapshot)
                    or observation["binding_sha256"] != digest(manifest)):
                raise Problem(503, "PRACTICE_OBSERVATION_MISMATCH")
            decision = record.get("decision")
            if decision is not None:
                fields(decision, ("snapshot_sha256", "action", "provider", "model_evidence", "decided_at_ms"))
                if decision["snapshot_sha256"] != digest(snapshot):
                    raise Problem(503, "PRACTICE_DECISION_MISMATCH")
                validate_decision(decision["action"], snapshot, manifest["scope"])
            for stage, key in (("acceptance", "result"), ("settlement", "receipt")):
                if stage not in record:
                    continue
                value = record[stage]
                fields(value, ("decision_sha256", key))
                if (decision is None or decision["action"]["side"] == "HOLD"
                        or value["decision_sha256"] != digest(decision)):
                    raise Problem(503, "PRACTICE_DELIVERY_MISMATCH")
                expected = order_body(manifest, snapshot, decision["action"])
                received = value[key]
                if (type(received) is not dict or any(canonical(received.get(k)) != canonical(v) for k, v in expected.items())
                        or received.get("state") not in (("PENDING",) if stage == "acceptance" else ("FILLED", "REJECTED"))):
                    raise Problem(503, "PRACTICE_RECEIPT_MISMATCH")
            if "failure" in record:
                fields(record["failure"], ("snapshot_sha256", "error"))
                if record["failure"]["snapshot_sha256"] != digest(snapshot):
                    raise Problem(503, "PRACTICE_FAILURE_MISMATCH")
                matching(record["failure"]["error"], re.compile(r"[A-Z][A-Z0-9_]{0,95}\Z"), "INVALID_FAILURE_CODE")
        return records


def review_locked(journal, manifest):
    fields(manifest, ("protocol", "scope", "credential_id", "origin", "model_port"))
    if manifest["protocol"] != "ZOORA_PRACTICE_WORKER_V1":
        raise Problem(503, "PRACTICE_MANIFEST_MISMATCH")
    validate_scope(manifest["scope"])
    identifier(manifest["credential_id"])
    records = journal.records(manifest)
    counts = {"HOLD": 0, "BUY": 0, "SELL": 0, "FILLED": 0, "REJECTED": 0, "UNRESOLVED": 0, "ABSTAINED": 0}
    pins = {"manifest.json": digest(manifest)}
    for tick, record in sorted(records.items()):
        for stage, value in record.items():
            pins[journal.name(tick, stage)] = digest(value)
        decision = record.get("decision")
        if decision is None:
            counts["ABSTAINED"] += 1
        else:
            side = decision["action"]["side"]
            counts[side] += 1
            if "settlement" in record:
                counts[record["settlement"]["receipt"]["state"]] += 1
            elif side != "HOLD" and "failure" not in record:
                counts["UNRESOLVED"] += 1
    last = records[max(records)]["observation"]["snapshot"]["account"] if records else None
    return {"protocol": manifest["protocol"], "scope_sha256": digest(manifest["scope"]),
            "experiment_id": manifest["scope"]["experiment_id"], "decisions": len(records), "counts": counts,
            "last_observed_account": last, "pins": pins, "evidence_sha256": digest(pins),
            "live_execution_allowed": False, "model_training": "NOT_PERFORMED",
            "model_identity": "HOST_DECLARED_NOT_ATTESTED", "performance_evaluation": "NOT_ESTABLISHED",
            "scope": "LOCAL_INTERNAL_CONSISTENCY"}


def review_practice(journal_dir, out):
    journal = Journal(journal_dir)
    with journal.locked():
        result = review_locked(journal, journal.read("manifest.json"))
        raw = (canonical(result) + "\n").encode("utf-8")
        with exclusive_file(out) as output:
            output.write(raw)
            output.flush()
            os.fsync(output.fileno())
        return {"report_sha256": hashlib.sha256(raw).hexdigest(), "decisions": result["decisions"],
                "counts": result["counts"], "live_execution_allowed": False}
