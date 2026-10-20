"""Bounded, source-pinned FlyEM graph import. No neuronal or market dynamics."""
from __future__ import annotations

import csv
from dataclasses import asdict, dataclass
import hashlib
import io
import json
from pathlib import Path
import tarfile
from typing import Iterable

SOURCE_ID = "flyem_hemibrain_v1_2"
ARCHIVE_BYTES = 45_872_577
ARCHIVE_SHA256 = "07d8946eb0c4e3a5cb23d5769c9817847494f9fcadbc0ca239eed7bbd5555cf7"
SOURCE_URL = "https://storage.googleapis.com/hemibrain/v1.2/exported-traced-adjacencies-v1.2.tar.gz?generation=1608664696223156"
LICENSE_URL = "https://creativecommons.org/licenses/by/4.0/"
PREFIX = "exported-traced-adjacencies-v1.2/"
MAX_SELECTED_NODES = 512
MAX_SOURCE_NODES = 50_000
MAX_SOURCE_EDGES = 5_000_000


class GraphError(ValueError):
    """Fixed diagnostics, with no paths, submitted values or row text."""


def canonical(value: object) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True,
                      allow_nan=False).encode("ascii")


def _integer(value: str, maximum: int) -> int:
    if not value or len(value) > 20 or not value.isascii() or not value.isdecimal():
        raise GraphError("INVALID_INTEGER")
    number = int(value)
    if not 1 <= number <= maximum:
        raise GraphError("INVALID_INTEGER")
    return number


def _lines(stream: io.BufferedIOBase) -> Iterable[str]:
    while raw := stream.readline(1025):
        if len(raw) > 1024:
            raise GraphError("ROW_TOO_LONG")
        try:
            yield raw.decode("utf-8")
        except UnicodeError:
            raise GraphError("INVALID_ENCODING") from None


def parse_neurons(stream: io.BufferedIOBase) -> tuple[int, ...]:
    rows = csv.reader(_lines(stream), strict=True)
    try:
        if next(rows, None) != ["bodyId", "type", "instance"]:
            raise GraphError("INVALID_NEURON_HEADER")
        ids = set()
        for row in rows:
            if len(row) != 3 or len(ids) >= MAX_SOURCE_NODES:
                raise GraphError("INVALID_NEURON_DIMENSIONS")
            identifier = _integer(row[0], 2**64 - 1)
            if identifier in ids:
                raise GraphError("DUPLICATE_NEURON")
            ids.add(identifier)
    except csv.Error:
        raise GraphError("INVALID_CSV") from None
    if not ids:
        raise GraphError("EMPTY_NEURONS")
    return tuple(sorted(ids))


def parse_connections(stream: io.BufferedIOBase, nodes: tuple[int, ...],
                      selected: tuple[int, ...]) -> tuple[tuple[tuple[int, int, int], ...], int]:
    """Keep all observed edges induced by selected IDs; preserve directed synapse counts."""
    if (type(nodes) is not tuple or not 1 <= len(nodes) <= MAX_SOURCE_NODES
            or any(type(n) is not int or not 1 <= n < 2**64 for n in nodes)
            or len(set(nodes)) != len(nodes)
            or type(selected) is not tuple or not 1 <= len(selected) <= MAX_SELECTED_NODES
            or any(type(n) is not int or not 1 <= n < 2**64 for n in selected)
            or len(set(selected)) != len(selected)
            or not set(selected) <= set(nodes)):
        raise GraphError("INVALID_SELECTION")
    known, keep = set(nodes), set(selected)
    rows = csv.reader(_lines(stream), strict=True)
    edges = {}
    count = 0
    try:
        if next(rows, None) != ["bodyId_pre", "bodyId_post", "weight"]:
            raise GraphError("INVALID_EDGE_HEADER")
        for row in rows:
            count += 1
            if len(row) != 3 or count > MAX_SOURCE_EDGES:
                raise GraphError("INVALID_EDGE_DIMENSIONS")
            pre, post = (_integer(v, 2**64 - 1) for v in row[:2])
            weight = _integer(row[2], 2**32 - 1)
            if pre not in known or post not in known:
                raise GraphError("UNKNOWN_NEURON")
            if pre in keep and post in keep:
                key = (pre, post)
                if key in edges:
                    raise GraphError("DUPLICATE_SELECTED_EDGE")
                edges[key] = weight
    except csv.Error:
        raise GraphError("INVALID_CSV") from None
    return tuple((pre, post, weight) for (pre, post), weight in sorted(edges.items())), count


@dataclass(frozen=True)
class GraphArtifact:
    source_id: str
    source_archive_sha256: str
    neuron_csv_sha256: str
    connection_csv_sha256: str
    source_neuron_count: int
    source_connection_rows: int
    selected_ids: tuple[str, ...]
    edges: tuple[tuple[str, str, int], ...]

    def payload(self) -> dict:
        return {"schema_version": 1, "classification": "DERIVED_MEASURED_CONNECTIVITY_SUBGRAPH",
                **asdict(self), "species": "Drosophila melanogaster",
                "coverage": "partial_central_brain_non_cropped_traced_neurons",
                "selection_rule": "first_n_numeric_sorted_traced_body_ids_v1",
                "edge_unit": "observed_total_synapse_count",
                "external_connections": "OMITTED_NOT_ZERO",
                "neuronal_dynamics": "NOT_IMPLEMENTED", "market_model": "NOT_IMPLEMENTED",
                "source_url": SOURCE_URL, "license": "CC-BY-4.0", "license_url": LICENSE_URL,
                "attribution": "Janelia FlyEM hemibrain v1.2; Scheffer et al. 2020, eLife 57443. Subset selection by BuildWithAAI; no endorsement."}

    def to_dict(self) -> dict:
        payload = self.payload()
        return {**payload, "graph_sha256": hashlib.sha256(
            b"BUILDWITHAAI_MB_GRAPH_V1\0" + canonical(payload)).hexdigest()}


class _HashReader:
    def __init__(self, stream: io.BufferedIOBase):
        self.stream = stream
        self.hash = hashlib.sha256()

    def readline(self, count: int) -> bytes:
        raw = self.stream.readline(count)
        self.hash.update(raw)
        return raw


def import_hemibrain(path: Path, selected_count: int = 128) -> GraphArtifact:
    if type(selected_count) is not int or not 1 <= selected_count <= MAX_SELECTED_NODES:
        raise GraphError("INVALID_SELECTION")
    try:
        with path.open("rb") as source:
            raw = source.read(ARCHIVE_BYTES + 1)
    except OSError:
        raise GraphError("SOURCE_UNAVAILABLE") from None
    if len(raw) != ARCHIVE_BYTES or hashlib.sha256(raw).hexdigest() != ARCHIVE_SHA256:
        raise GraphError("SOURCE_HASH_OR_SIZE_MISMATCH")
    try:
        with tarfile.open(fileobj=io.BytesIO(raw), mode="r:gz") as archive:
            members = archive.getmembers()
            if len(members) > 16 or sum(m.size for m in members) > 256 * 1024 * 1024:
                raise GraphError("ARCHIVE_DIMENSIONS")
            # Never extract paths to disk, execute code, or follow archive links.
            for member in members:
                if not (member.isfile() or member.isdir()) or not member.name.startswith(PREFIX.rstrip("/")):
                    raise GraphError("UNSUPPORTED_ARCHIVE_MEMBER")
            neurons = archive.extractfile(PREFIX + "traced-neurons.csv")
            connections_name = PREFIX + "traced-total-connections.csv"
            if neurons is None:
                raise GraphError("MISSING_SOURCE_MEMBER")
            neuron_stream = _HashReader(neurons)
            node_ids = parse_neurons(neuron_stream)
            if selected_count > len(node_ids):
                raise GraphError("INVALID_SELECTION")
            connections = archive.extractfile(connections_name)
            if connections is None:
                raise GraphError("MISSING_SOURCE_MEMBER")
            edge_stream = _HashReader(connections)
            selected = node_ids[:selected_count]
            edges, count = parse_connections(edge_stream, node_ids, selected)
    except (tarfile.TarError, KeyError, OSError, EOFError):
        raise GraphError("INVALID_ARCHIVE") from None
    return GraphArtifact(SOURCE_ID, ARCHIVE_SHA256, neuron_stream.hash.hexdigest(),
                         edge_stream.hash.hexdigest(), len(node_ids), count,
                         tuple(str(n) for n in selected), tuple((str(a), str(b), w) for a, b, w in edges))
