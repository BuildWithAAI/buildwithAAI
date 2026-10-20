# FV-SMOKE-001: checkpoint-free FlyVis CPU execution

This experiment runs the real, pinned upstream FlyVis implementation on synthetic visual inputs. It establishes a bounded **technical execution result only**. It does not reproduce the published trained-network experiments, infer market behavior, train a readout or connect a live service.

The [registration](registration.json) fixes the hypothesis, source, synthetic stimuli, parameters, resource bounds and acceptance criteria. Its bytes are checked before execution; changing the criteria requires a new experiment ID. The registration and first implementation were committed locally as `a868b720958625f3135aa88fa594f88b8a1a4403` before the first model measurement. GitHub publication uses a content-identical tree with a separate commit ID; the [source-equivalence record](evidence/source-equivalence.json) retains that mapping. Public publication followed the local run; no independently timestamped public preregistration or execution attestation is claimed.

## First local measured result

The pinned upstream network ran on CPU with a reduced hexagonal patch (`extent=3`, gap-fill disabled). It constructed **2,345 modeled neurons and 57,663 directed modeled edges**, including 2,049 non-input neurons. These counts are not the separate 128-neuron FlyEM importer fixture and are not directly measured synapse counts for this constructed patch.

Three synthetic conditions were presented: constant gray, ON flash and OFF flash. The model used untrained upstream parameter initialization, with no checkpoint or optimizer. Two independently initialized repeats produced finite float32 activity with **maximum absolute difference 0.0**. The registered maximum non-input response difference from gray was **0.03334683179855347** for each flash. This shows stimulus-dependent execution, not useful vision or a biologically accurate response.

Measured local worker time was **30.21 seconds** and peak RSS approximately **577.54 MiB**, including imports and both runs. These are measurements from this environment, not performance guarantees. The four evidence artifacts total **2,272,710 bytes**. The 4 MB artifact budget excludes private package/model caches and the worker log; caches are not published as scientific evidence. A 180-second supervisor timeout, 170 CPU-second worker limit, per-file limits and fixed graph/tensor limits bound the run.

The [original local report](evidence/first-local-report.json) and [verification result](evidence/first-local-verification.json) preserve the first measurement. The raw activity arrays are generated artifacts, not committed training data; hosted reproduction uploads them with the report, node labels and logs for 14 days. Regenerate them with the commands below after expiry. Model-state and activity digests, source pins, environment versions and worker/verifier hashes are retained.

## Reproduce on Linux x86_64 with Python 3.12

Start from a clean trusted checkout of this project and a separate trusted checkout of FlyVis. The dependency environment is separate from the dependency-free research interfaces. Downloads and package installation need network access; the measured worker needs no remote input.

```sh
python -m pip install --require-hashes --only-binary=:all: -r experiments/flyvis_cpu_smoke/bootstrap-linux.lock
git clone https://github.com/TuragaLab/flyvis.git .flyvis-upstream
git -C .flyvis-upstream checkout 0a69fa2fc8e1bfe1d837d722c252ab5f5d6fcbfa
uv venv .flyvis-venv --python python3.12 --no-python-downloads
uv pip sync experiments/flyvis_cpu_smoke/requirements-linux-py312.lock --python .flyvis-venv/bin/python --torch-backend cpu --require-hashes
uv pip install --python .flyvis-venv/bin/python --no-deps --no-build-isolation ./.flyvis-upstream
python scripts/run_flyvis_smoke.py --source .flyvis-upstream --python .flyvis-venv/bin/python --output experiments/flyvis_cpu_smoke/generated/run-001
python scripts/verify_flyvis_smoke.py experiments/flyvis_cpu_smoke/generated/run-001
```

Use a new output directory for every attempt. An incomplete run retains a failure record and local log; it must not be overwritten or relabeled successful. The dependency lock includes exact versions and distribution hashes. It is an integration environment, **not the original paper's training environment**. One explicit compatibility constraint selects Hydra >=1.3,<2; an all-wheel-only trial otherwise selected an obsolete API. A transitive source distribution may be built by the installer; the runtime lock is not an attestation of all build-system behavior.

## What verification checks

The standard-library verifier does not import NumPy, PyTorch or FlyVis. It reads only bounded, fixed-name C-order little-endian float32 NPY arrays, with literal headers; object arrays and pickle payloads are refused. It independently checks finite values, registered dimensions, identical-repeat tolerance and non-input stimulus dependence, then compares those measurements with the report.

It also checks artifact digests, frozen registration/source/lock IDs, graph/resource claims and explicit false biological-replication, market-validation and live-execution flags. Tests include forged success, silent/input-only activity, nonrepeatable output, invalid provenance, malformed/truncated/nonfinite/object artifacts and an altered array accompanied by a recomputed digest. A self-reported valid record is not proof that trusted code executed; content consistency and independent attestation remain distinct.

## Source, safety and scientific boundaries

Upstream: [TuragaLab/flyvis at the audited pin](https://github.com/TuragaLab/flyvis/tree/0a69fa2fc8e1bfe1d837d722c252ab5f5d6fcbfa), MIT code. Scientific reference: [Lappalainen et al., Nature 2024](https://doi.org/10.1038/s41586-024-07939-3). The bundled `fib25-fib19_v2.2.json` specification is checksum-pinned. No external pretrained weights, Sintel frames or other stimulus archives are acquired here. Commercial clearance of all source research assets remains unestablished.

The worker has a sanitized environment and private working/cache directory, CPU-only execution, disabled dotenv loading and guards against accidental Python network/checkpoint-loading calls. Trusted source/interpreter paths are required. This is **not an OS security sandbox**: container/user namespaces were unavailable locally, and Python guards can be bypassed by arbitrary native or malicious code. Do not use this worker to execute untrusted plugins or load unknown model artifacts. It is unsuitable for a process holding production credentials or wallet keys.

Uniform flashes, untrained dynamics, reduced geometry, missing external connections and one seed cannot validate the paper's tuned neural predictions. At this checkpoint the 65 implementation labels versus 64 published biological types remained unreconciled. The subsequent [FV-REF-001](../flyvis_trained_reference/README.md) records the paper's explanation: CT1 has two modeled compartment populations. That later experiment separately evaluates a fixed pretrained model; it does not change the untrained smoke result.

The next scientific step remains a separately registered reproduction with the exact permitted trained assets, reference stimuli, numeric targets and tolerances. Market adaptation requires its own causal encoder, labels, chronological data splits, controls and benchmark. The existing source/readiness gates remain unchanged; this technical PASS grants no live-model promotion or wallet execution.
