# Multi-brain market research — first measured-data foundation

**Trained-model reference checkpoint:** [FV-REF-001](../experiments/flyvis_trained_reference/README.md) registers one fixed pretrained model and a full-architecture synthetic-flash polarity check. Its MIT asset notice and weights-only loader address earlier open gates. Results and retained attempts are recorded with that experiment; existing live gates remain in force.

**Later implementation checkpoint:** [FV-SMOKE-001](../experiments/flyvis_cpu_smoke/README.md) executes a pinned upstream FlyVis model with untrained defaults and synthetic flashes, preserving raw-output digests and independent numerical verification. This is separate from the FlyEM graph importer below. Its technical result does not establish biological replication, a trained market model or a connected live service, and does not change readiness gates.

**October 20 UTC / October 19 America/Chicago, 2026.** The founder requested fly, tadpole, cat, monkey and later suitable sources in a shared system, and selected **market research** as the first live-input use. This checkpoint implements source-pinned graph preparation and a common causal research interface. It does not implement a biological market model, train a readout, demonstrate prediction quality, connect a live market service or authorize transactions.

Governing contracts: [BT-000](BIOLOGICAL_COMPUTE_PROTOCOL.md), [BT-001](DATA_MEASUREMENT_PROTOCOL.md) and [BT-002](SOLANA_GROUND_TRUTH_REPLAY.md). The work is isolated from paid products, the live agent pilot and native-chain protocol. It builds on the existing [BT-003 replay draft #9](https://github.com/BuildWithAAI/buildwithAAI/pull/9); that harness's limitations remain in force. The existing 27 replay tests and source remain unchanged.

**Subsequent source research:** the [GitHub/scientific model audit](OPEN_MODEL_SCIENTIFIC_AUDIT_20261020.md) adds distinct executable-model candidates beyond the dataset rows below, including a public 2021 tadpole CNS source, cat V1 and macaque visual-cortex models. Their existence does not change this foundation's import/live gates. Exact model code, asset rights, environments and scientific replication are tracked separately.

## Verified source distinctions

| Source | What we can substantiate | Current use boundary |
| --- | --- | --- |
| Janelia FlyEM hemibrain v1.2 | Partial adult central-brain reconstruction; provider-linked CC BY 4.0; public traced adjacency export acquired and checksum-pinned | First bounded graph import implemented; no dynamics or learned market model |
| FlyWire 783 | Adult female fly whole-brain reconstruction; current public guidelines name release 783 and CC BY-NC 4.0 | Commercial reuse unresolved; not downloaded/imported here |
| Xenopus tadpole, Davis et al. 2017 | Developmental spinal-circuit/axon-growth model; paper states experimental code is available from authors on request | Neither a measured whole tadpole brain nor an already licensed reusable code export; no outreach or code import performed |
| Cat cortical connectivity | Cited analysis describes one-hemisphere regional connectivity, 65 regions and 1,139 projections with ordinal strengths | Exact dataset version/export/reuse terms unresolved; not neuronal synapse-count weights |
| Macaque TVB, Shen et al. 2019 | Regional cortical tracer connectivity supplemented by tractography-derived estimates, with explicit coverage limits | Exact Zenodo asset/version/terms not verified; not a whole neuron-level monkey brain |

The [machine-readable source catalog](brain-assets/source_catalog.json) also retains worm, regional mouse/MICrONS, crow and jellyfish targets. Those supplementary entries were **not reverified** in this checkpoint; unknown sources remain unknown. More species can be added through source-specific review. These rows are not interchangeable complete brains, and a scientific paper's reuse terms do not automatically license a separate dataset/software export.

Primary references checked: [FlyEM and download links](https://www.janelia.org/project-team/flyem/hemibrain), [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/), [FlyWire release guidelines](https://flywire.ai/guidelines), [Xenopus study](https://www.nature.com/articles/s41598-017-13804-3), [cat study](https://pubmed.ncbi.nlm.nih.gov/23926249/), [macaque data descriptor](https://www.nature.com/articles/s41597-019-0129-z). Nature/PMC/JNeurosci/Zenodo endpoints had intermittent access failures during parts of this audit; search-indexed primary study text and reachable provider pages are distinguished from actual file acquisition. No claim is made to have downloaded the cat, tadpole or macaque assets. Zenodo 1471588 could not be inspected successfully in this session.

## Real fly data acquired and rebuilt

The pinned FlyEM export is **45,872,577 bytes**, storage generation **1608664696223156**, SHA-256 **07d8946eb0c4e3a5cb23d5769c9817847494f9fcadbc0ca239eed7bbd5555cf7**. The anonymous public Google Cloud Storage object was fetched without a login or credentials. No raw imaging was downloaded.

Its own README identifies neuprint-python v0.4.12 and `hemibrain:v1.2`. The traced-neuron table has **21,739** records and the total-connection table has **3,550,403** rows. This export covers non-cropped traced neurons; it is not the full approximately 25,000-neuron reconstruction or the whole fly brain. The ROI table omits synapses outside primary ROIs; this importer uses the total table and does not double-count ROI rows.

The committed [derived data artifact](brain-assets/hemibrain_v1_2_first128.json) selects the first **128 numerically sorted body IDs** and retains all **1,055 directed connections** between them. Weights preserve the source-reported total synapse counts; no inferred activation signs, conductances, time constants, neuron dynamics or learned weights are invented. External edges are **omitted, not zero**. This deterministic selection tests the importer and is not a claim to select a functional, representative or useful market circuit.

Graph digest: **014a6eebb4ff0586e6a94acb88b188ba0ddaf8421a924dad16cd104ad16cd43b**. Node IDs are decimal strings to avoid integer truncation in future JavaScript displays. The file includes source-member digests, counts, coverage and licensing. [Attribution and transformation](brain-assets/ATTRIBUTION.md) apply CC BY 4.0 to the derived data without inventing a repository-code license.

## Implemented interfaces and boundaries

[Graph adapter](../src/multi_brain_research/graph.py): validates exact archive size/SHA before parsing, bounds selected nodes (1–512), source nodes (50,000), connection rows (5,000,000), line size and total declared archive bytes, and refuses malformed IDs/counts, unknown vertices and duplicate selected edges. It never extracts archive paths onto disk, follows archive links or runs downloaded code. Standalone parser helpers can process synthetic test rows; only the source-pinned importer produces the measured-data artifact used here. A self-reported digest is not a signature or independent biological proof.

[Shared research contracts](../src/multi_brain_research/contracts.py): immutable typed Python measurements and snapshots retain exact integer/scaled values, units, event/observed/available times, source versions, classification, lineage, explicit missingness and feature-set hash. BT-001 feature IDs are bounded to the current registry; Y labels are excluded. Snapshot construction rejects future availability, stale observations, duplicate/mutable input arrays and invalid type/time bounds. Canonical snapshot hashes normalize feature order. This is a typed Python contract, not a public transport/parser or authenticated data source.

Module receipts require module/source/graph/model/task/snapshot pins, horizon, production time, integer parts-per-million output/uncertainty or explicit abstention. Receipt comparison requires the same snapshot, task and horizon and refuses duplicate module IDs. Comparison always reports **NO_EXECUTION**, **NOT_ESTABLISHED** calibration and **NOT_ESTABLISHED** independence. Reported uncertainty is not empirically calibrated confidence. A receipt is an untrusted assertion, not proof that a model ran or a source was authenticated. No learned fusion or majority-vote trading rule is implemented.

[Readiness checks](../src/multi_brain_research/readiness.py) permit only the currently supported pinned CC-BY FlyEM source into asset import. Noncommercial/unknown rights and unsupported/unpinned sources remain blocked. Every source remains blocked from live shadow promotion because model/encoder, benchmark promotion and connected service are absent. Wallet execution remains outside scope and unimplemented. These reports do not change any production authorization or verify legal rights independently of the recorded provider evidence.

## Reproduction and checks

From repository root, Python 3.11 or newer:

```sh
python -m unittest discover -s tests -v
python -O -m unittest discover -s tests -v
python scripts/verify_brain_asset.py
```

The asset verifier downloads only the fixed public version/generation, rejects redirects and excessive bytes, rebuilds the fixture and independently parses the original CSVs without the importer's parsing helpers. It recomputes source-member/graph hashes, exact directed edges, counts and selection. Altered weights with a recomputed digest, wrong node counts and wrong graph digests must all fail. An already acquired archive can be supplied with `--archive PATH`. Reports under `research/brain-assets/generated/` are reproducible intermediate evidence; the full archive is not bundled.

The suite has **49 tests: 27 existing replay regressions and 22 new graph/interface/readiness tests**. Normal and optimized tests, actual source acquisition/rebuild and independent verification are required on Linux and Windows by the new CI workflow. Exact-source hosted outcomes belong to the focused draft PR; no unobserved CI result is claimed by this document. No new third-party Python dependency is added. Implementation assistance: Codex; this is not an independent professional security/scientific review.

## Path to live market research

1. Register a specific market task/horizon and pinned point-in-time data/encoder under BT-000/001; implement one bounded FlyEM-informed experimental module with every synthetic dynamic/readout assumption declared.
2. Compare it with no-action, simple/linear/conventional baselines, random and degree-matched topology controls, multiple seeds and ablations. Keep chronological train/validation/untouched tests and all negative results. This checkpoint performs **no training or market-model evaluation**.
3. Pin a permitted second dataset/adapter; characterize it independently, then test a combiner against the individual modules and simple ensembles. Cross-species links are engineered, not measured biological connections. Agreement alone cannot establish an advantage.
4. Promote only a verified candidate to bounded **read-only live market observation and paper decisions**, with stale/gap/outage handling, source/provider terms and operating cost recorded. Show actual disagreements and abstentions. No shadow service is deployed now.
5. Any wallet execution requires its own owner-visible policy, independent risk controls, security review and separate authorization. Neither this user-selected market-research phase nor a connectome license supplies signing or spending permission.

The next useful result is a falsifiable registered first-module experiment, not a claim that all named animal brains are already running together or ready to trade.
