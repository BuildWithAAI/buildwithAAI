"""Rebuild the CC-BY FlyEM fixture and audit it independently from the importer."""
import argparse
import csv
import hashlib
import io
import json
import os
from pathlib import Path
import sys
import tarfile
import tempfile
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from src.multi_brain_research.graph import ARCHIVE_BYTES, ARCHIVE_SHA256, SOURCE_URL, import_hemibrain


def independently_check(archive_path, graph):
    with archive_path.open("rb") as source:
        raw = source.read(ARCHIVE_BYTES + 1)
    if len(raw) != ARCHIVE_BYTES or hashlib.sha256(raw).hexdigest() != ARCHIVE_SHA256:
        raise ValueError("source identity differs")
    prefix = "exported-traced-adjacencies-v1.2/"
    with tarfile.open(fileobj=io.BytesIO(raw), mode="r:gz") as archive:
        neuron_bytes = archive.extractfile(prefix + "traced-neurons.csv").read()
        nodes = sorted(int(r["bodyId"]) for r in csv.DictReader(io.StringIO(neuron_bytes.decode())))
        selected = set(nodes[:128])
        stream = archive.extractfile(prefix + "traced-total-connections.csv")
        sha = hashlib.sha256()

        def lines():
            for line in stream:
                sha.update(line)
                yield line.decode()

        edges = []
        rows = 0
        for row in csv.DictReader(lines()):
            rows += 1
            a, b, weight = int(row["bodyId_pre"]), int(row["bodyId_post"]), int(row["weight"])
            if a in selected and b in selected:
                edges.append([str(a), str(b), weight])
        edges.sort(key=lambda e: (int(e[0]), int(e[1])))
    if (graph["selected_ids"] != [str(n) for n in nodes[:128]] or graph["edges"] != edges
            or graph["source_neuron_count"] != len(nodes) or graph["source_connection_rows"] != rows
            or graph["source_archive_sha256"] != ARCHIVE_SHA256
            or graph["neuron_csv_sha256"] != hashlib.sha256(neuron_bytes).hexdigest()
            or graph["connection_csv_sha256"] != sha.hexdigest()):
        raise ValueError("source reconstruction differs")
    payload = {key: value for key, value in graph.items() if key != "graph_sha256"}
    encoded = json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=True, allow_nan=False).encode("ascii")
    if hashlib.sha256(b"BUILDWITHAAI_MB_GRAPH_V1\0" + encoded).hexdigest() != graph["graph_sha256"]:
        raise ValueError("graph digest differs")


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ValueError("source redirects are not permitted")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--archive", type=Path)
    args = parser.parse_args()
    with tempfile.TemporaryDirectory() as folder:
        path = args.archive
        if path is None:
            path = Path(folder) / "hemibrain.tar.gz"
            opener = urllib.request.build_opener(NoRedirect)
            with opener.open(SOURCE_URL, timeout=30) as response, path.open("wb") as output:
                total = 0
                while chunk := response.read(1024 * 1024):
                    total += len(chunk)
                    if total > ARCHIVE_BYTES:
                        raise ValueError("source exceeds fixed acquisition bound")
                    output.write(chunk)
        artifact = json.loads((ROOT / "research/brain-assets/hemibrain_v1_2_first128.json").read_bytes())
        rebuilt = import_hemibrain(path).to_dict()
        # Compare JSON-shaped values (the importer's frozen tuples encode as arrays).
        if json.loads(json.dumps(rebuilt)) != artifact:
            raise ValueError("reproducible import differs")
        independently_check(path, artifact)
        for tamper in ("edge", "node_count", "digest"):
            changed = json.loads(json.dumps(artifact))
            if tamper == "edge":
                changed["edges"][0][2] += 1
                payload = {k: v for k, v in changed.items() if k != "graph_sha256"}
                changed["graph_sha256"] = hashlib.sha256(b"BUILDWITHAAI_MB_GRAPH_V1\0" + json.dumps(
                    payload, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode()).hexdigest()
            elif tamper == "node_count":
                changed["source_neuron_count"] += 1
            else:
                changed["graph_sha256"] = "0" * 64
            try:
                independently_check(path, changed)
            except ValueError:
                pass
            else:
                raise ValueError("altered graph escaped independent verification")
    report = {"classification": "MEASURED_CONNECTIVITY_IMPORT_ONLY", "source_head_sha": os.environ.get("SOURCE_HEAD_SHA", "local_unpublished"),
              "archive_sha256": ARCHIVE_SHA256, "graph_sha256": artifact["graph_sha256"],
              "nodes": len(artifact["selected_ids"]), "edges": len(artifact["edges"]),
              "source_rows": artifact["source_connection_rows"], "altered_artifacts_rejected": 3,
              "trained_models": 0, "live_market_connections": 0, "wallet_execution": False}
    output = ROOT / "research/brain-assets/generated"
    output.mkdir(exist_ok=True)
    (output / "verified-import.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report, sort_keys=True))


if __name__ == "__main__":
    main()
