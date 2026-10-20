from dataclasses import replace
import hashlib
import io
import json
from pathlib import Path
import tempfile
import unittest

from src.multi_brain_research.contracts import ContractError, Measurement, ModuleOutput, Snapshot, compare
from src.multi_brain_research.graph import (GraphError, canonical, import_hemibrain,
                                           parse_connections, parse_neurons)
from src.multi_brain_research.readiness import CATALOG, source_gate

PIN = "1" * 64


def measurement(**changes):
    values = dict(feature_id="M-001", value=1200, unit="quote_atomic_per_base", classification="OBSERVED",
                  event_time_ms=10, observed_time_ms=20, available_time_ms=30,
                  source_id="fixture_market", source_version="fixture_v1", lineage_sha256=PIN, missing_reason=None)
    return Measurement(**(values | changes))


def snapshot(**changes):
    values = dict(entity_id="fixture_token", decision_time_ms=40, feature_set_sha256=PIN,
                  max_observation_age_ms=20, measurements=(measurement(),))
    return Snapshot(**(values | changes))


def output(s, **changes):
    values = dict(module_id="synthetic_module", source_id="synthetic_fixture", graph_sha256=PIN,
                  model_sha256=PIN, task_sha256=PIN, horizon_ms=60000, snapshot_sha256=s.sha256(),
                  produced_time_ms=40, prediction_ppm=600000, uncertainty_ppm=400000, abstain_reason=None)
    return ModuleOutput(**(values | changes))


class GraphTests(unittest.TestCase):
    def test_observed_neuron_identifiers_are_exact_sorted_and_bounded(self):
        self.assertEqual(parse_neurons(io.BytesIO(b"bodyId,type,instance\n20,cell,cell_a\n10,cell,cell_b\n")), (10, 20))
        for raw in [b"bodyId,type,instance\n", b"wrong,type,instance\n1,a,b\n",
                    b"bodyId,type,instance\n1,a,b\n1,c,d\n", b"bodyId,type,instance\n1.0,a,b\n",
                    b"bodyId,type,instance\n18446744073709551616,a,b\n"]:
            with self.assertRaises(GraphError):
                parse_neurons(io.BytesIO(raw))

    def test_directed_counts_and_external_edges_are_not_silently_merged(self):
        raw = b"bodyId_pre,bodyId_post,weight\n1,2,7\n2,1,4\n2,3,11\n"
        edges, count = parse_connections(io.BytesIO(raw), (1, 2, 3), (1, 2))
        self.assertEqual(edges, ((1, 2, 7), (2, 1, 4)))
        self.assertEqual(count, 3)

    def test_duplicate_selected_edges_unknown_neurons_and_invalid_weights_refuse(self):
        for rows in [b"1,2,1\n1,2,1\n", b"1,3,1\n", b"1,2,-1\n", b"1,2,1.0\n", b"1,2,0\n", b"1,2,4294967296\n"]:
            with self.assertRaises(GraphError):
                parse_connections(io.BytesIO(b"bodyId_pre,bodyId_post,weight\n" + rows), (1, 2), (1, 2))

    def test_selection_types_sizes_duplicates_and_unknowns_refuse(self):
        for selected in [(), (1, 1), (3,), (True,), tuple(range(1, 514))]:
            with self.assertRaises(GraphError):
                parse_connections(io.BytesIO(b"bodyId_pre,bodyId_post,weight\n"), (1, 2), selected)

    def test_oversize_lines_and_invalid_encoding_refuse_without_echo(self):
        for line in [b"x" * 1025, b"1,\xff,b\n"]:
            with self.assertRaises(GraphError) as raised:
                parse_neurons(io.BytesIO(b"bodyId,type,instance\n" + line))
            self.assertNotIn("x" * 20, str(raised.exception))

    def test_wrong_archive_size_or_hash_refuses_before_tar_processing(self):
        with tempfile.TemporaryDirectory() as folder:
            p = Path(folder) / "untrusted.tar.gz"
            p.write_bytes(b"not an archive")
            with self.assertRaisesRegex(GraphError, "SOURCE_HASH_OR_SIZE_MISMATCH"):
                import_hemibrain(p)
            with p.open("wb") as f:
                f.truncate(45872577)
            with self.assertRaisesRegex(GraphError, "SOURCE_HASH_OR_SIZE_MISMATCH"):
                import_hemibrain(p)
            for count in (True, 0, 513, -1):
                with self.assertRaisesRegex(GraphError, "INVALID_SELECTION"):
                    import_hemibrain(p, count)

    def test_committed_measured_subgraph_has_expected_identity_and_content_digest(self):
        p = Path(__file__).resolve().parents[1] / "research/brain-assets/hemibrain_v1_2_first128.json"
        graph = json.loads(p.read_bytes())
        digest = graph.pop("graph_sha256")
        self.assertEqual(digest, "014a6eebb4ff0586e6a94acb88b188ba0ddaf8421a924dad16cd104ad16cd43b")
        self.assertEqual(hashlib.sha256(b"BUILDWITHAAI_MB_GRAPH_V1\0" + canonical(graph)).hexdigest(), digest)
        self.assertEqual((len(graph["selected_ids"]), len(graph["edges"])), (128, 1055))
        self.assertEqual(graph["source_neuron_count"], 21739)
        self.assertEqual(graph["source_connection_rows"], 3550403)
        self.assertEqual(graph["external_connections"], "OMITTED_NOT_ZERO")
        self.assertEqual(graph["market_model"], "NOT_IMPLEMENTED")


class ContractTests(unittest.TestCase):
    def test_input_record_is_immutable_and_snapshot_hash_is_repeatable(self):
        s = snapshot()
        self.assertEqual(s.sha256(), snapshot().sha256())
        with self.assertRaises(AttributeError):
            s.decision_time_ms = 1

    def test_labels_and_unknown_feature_ids_cannot_enter_input_snapshots(self):
        for change in [dict(feature_id="Y-001"), dict(feature_id="S-999"), dict(feature_id="C-008"),
                       dict(classification="LABEL"), dict(classification=[]), dict(feature_id="M-000")]:
            with self.assertRaises(ContractError):
                measurement(**change)

    def test_time_order_and_boolean_times_are_rejected(self):
        for change in [dict(event_time_ms=21), dict(observed_time_ms=31), dict(available_time_ms=True),
                       dict(event_time_ms=-1), dict(observed_time_ms=253402300800000)]:
            with self.assertRaises(ContractError):
                measurement(**change)

    def test_source_availability_and_observation_age_have_exact_boundaries(self):
        self.assertEqual(snapshot().decision_time_ms, 40)
        with self.assertRaisesRegex(ContractError, "FUTURE_DATA"):
            snapshot(decision_time_ms=29)
        with self.assertRaisesRegex(ContractError, "STALE_DATA"):
            snapshot(decision_time_ms=41)

    def test_missingness_is_explicit_and_not_zero_imputation(self):
        m = measurement(value=None, missing_reason="SOURCE_UNAVAILABLE")
        self.assertIsNone(m.value)
        for change in [dict(value=None), dict(missing_reason="UNKNOWN"), dict(value=True), dict(value=1.5),
                       dict(value=2**64), dict(value=None, missing_reason=[])]:
            with self.assertRaises(ContractError):
                measurement(**change)

    def test_duplicate_features_unbounded_arrays_and_mutable_inputs_refuse(self):
        for values in [(), [measurement()], (measurement(), measurement()), (measurement(),) * 65]:
            with self.assertRaises(ContractError):
                snapshot(measurements=values)

    def test_snapshot_order_is_canonical_but_content_change_is_detected(self):
        one, two = measurement(), measurement(feature_id="Q-001", classification="DERIVED", unit="milliseconds", value=10)
        self.assertEqual(snapshot(measurements=(one, two)).sha256(), snapshot(measurements=(two, one)).sha256())
        self.assertNotEqual(snapshot().sha256(), snapshot(measurements=(replace(one, value=1201),)).sha256())

    def test_malformed_source_ids_and_empty_lineage_refuse(self):
        for change in [dict(source_id="https://secret"), dict(source_version=""), dict(lineage_sha256="0" * 64), dict(unit="dollars\nsecret")]:
            with self.assertRaises(ContractError):
                measurement(**change)

    def test_outputs_bind_to_snapshot_time_task_and_horizon(self):
        s = snapshot()
        output(s).bind(s)
        for change in [dict(snapshot_sha256="2" * 64), dict(produced_time_ms=39)]:
            with self.assertRaises(ContractError):
                output(s, **change).bind(s)
        for change in [dict(task_sha256="2" * 64), dict(horizon_ms=1000)]:
            with self.assertRaisesRegex(ContractError, "TASK_OR_HORIZON_MISMATCH"):
                compare((output(s), output(s, module_id="other_module", **change)), s)

    def test_output_values_and_abstention_are_not_interchangeable(self):
        s = snapshot()
        o = output(s, prediction_ppm=None, uncertainty_ppm=None, abstain_reason="UNCALIBRATED")
        self.assertEqual(compare((o,), s)["abstentions"], 1)
        for change in [dict(prediction_ppm=True), dict(uncertainty_ppm=1000001), dict(horizon_ms=True),
                       dict(prediction_ppm=None), dict(abstain_reason="UNCALIBRATED"), dict(prediction_ppm=None, uncertainty_ppm=None, abstain_reason=[])]:
            with self.assertRaises(ContractError):
                output(s, **change)

    def test_matching_predictions_never_imply_execution_calibration_or_independence(self):
        s = snapshot()
        result = compare((output(s), output(s, module_id="other_module")), s)
        self.assertEqual(result["reported_range_ppm"], 0)
        self.assertEqual(result["action"], "NO_EXECUTION")
        self.assertEqual(result["calibration"], "NOT_ESTABLISHED")
        self.assertEqual(result["independence"], "NOT_ESTABLISHED")

    def test_duplicate_modules_and_unbounded_receipts_refuse(self):
        s = snapshot()
        for outputs in [(), [output(s)], (output(s), output(s)), (output(s),) * 17]:
            with self.assertRaises(ContractError):
                compare(outputs, s)


class ReadinessTests(unittest.TestCase):
    def test_catalog_retains_all_requested_species_and_distinct_evidence_types(self):
        sources = json.loads(CATALOG.read_bytes())["sources"]
        self.assertEqual(len({s["source_id"] for s in sources}), len(sources))
        self.assertEqual(len(sources), 9)
        kinds = {s["source_kind"] for s in sources}
        self.assertTrue({"neuron_level_reconstruction", "model_generated_spinal_circuit", "region_level_tracer_collation", "hybrid_region_level_connectivity"} <= kinds)

    def test_only_the_supported_pinned_cc_by_source_can_enter_asset_import(self):
        self.assertEqual(source_gate("flyem_hemibrain_v1_2", "ASSET_IMPORT"), ())
        self.assertIn("COMMERCIAL_REUSE_UNRESOLVED_OR_RESTRICTED", source_gate("flywire_783", "ASSET_IMPORT"))
        self.assertEqual(source_gate("invented_brain", "ASSET_IMPORT"), ("UNKNOWN_OR_DUPLICATE_SOURCE",))

    def test_no_source_is_a_promoted_live_model_or_wallet_permission(self):
        for s in json.loads(CATALOG.read_bytes())["sources"]:
            self.assertIn("NO_REGISTERED_MODEL_OR_MARKET_ENCODER", source_gate(s["source_id"], "LIVE_SHADOW"))
            self.assertIn("EXECUTION_NOT_AUTHORIZED_OR_IMPLEMENTED", source_gate(s["source_id"], "WALLET_EXECUTION"))
        with self.assertRaises(ValueError):
            source_gate("flyem_hemibrain_v1_2", "AUTO_TRADE")


if __name__ == "__main__":
    unittest.main()
