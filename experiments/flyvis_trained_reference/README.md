# FV-REF-001: fixed pretrained FlyVis reference

This bounded scientific check follows the [untrained smoke test](../flyvis_cpu_smoke/README.md). It evaluates one author-provided pretrained model without training, full-paper replication or market/live promotion.

The [registration](registration.json) was [published before response evaluation](https://github.com/BuildWithAAI/buildwithAAI/commit/7279b9cbfa11856789f548a3f451ba4428942610), SHA-256 `874a1487de5288b2a99769c0b3eb841040147e885519cc50715f3f7f42e1309f`. Model **000** was selected by lowest ID before inspecting validation losses or responses. Use its author-provided `best_chkpt`; do not substitute another model after evaluation.

## Scientific scope

The full modeled architecture has 45,669 neurons, 1,513,231 connections and 734 learned parameters. The [original paper](https://doi.org/10.1038/s41586-024-07939-3) explains that CT1 has two compartment populations, resolving 65 implementation labels versus 64 biological types. These modeled connections differ from the measured FlyEM hemibrain importer.

Two fresh CPU instances receive synthetic upstream `Flashes`: off/on, full field/radius 6, one second pre/flash/post at 200 Hz, plus one second initial gray. Save central-cell responses: four samples × 600 frames × 65 labels. Independently compute radius-6 FRI over frames 200–400 inclusive, including the author's absolute-minimum shift and float32 arithmetic. Compare with the upstream xarray function on identical responses.

PASS requires finite responses, repeat maximum difference ≤`1e-6`, independent/upstream FRI difference ≤`1e-6`, and **18/24** matching known non-input polarity labels. The constant-majority baseline is 14/24. Our threshold is not a published effect size. These literature-compiled labels are not raw recordings; CT1 compartments and T4/T5 subtypes are dependent, so no IID significance is claimed.

Completed compliant failures are `REJECT_SCOPED_HYPOTHESIS`; incomplete/incompatible runs are `INCONCLUSIVE`. Preserve all attempts. Different models or criteria require a new experiment ID. PASS never permits live execution.

## Recorded result, October 20, 2026

Both completed environments passed the scoped requirement: **22/24**, with **C3 and T4d disagreeing** with the reference. No model substitution or threshold change was made.

| Measurement | Local completed attempt 2 | GitHub completed attempt 1 |
| --- | ---: | ---: |
| Wall seconds | 43.15 | 53.69 |
| CPU seconds | 37.72 | 44.49 |
| Peak RSS MiB | 2,387.21 | 2,460.22 |
| Known polarities correct | 22/24 | 22/24 |
| Same-environment repeat max difference | 0 | 0 |
| Independent/upstream FRI max difference | 0 | 0 |

Local and hosted raw responses also match byte-for-byte. Four raw NPY files, reports, cell mappings and independent verification results are retained in [evidence/](evidence/). The verifier can run directly on either completed directory. Response SHA-256: `54742bcb19142ada745935f08958978457ae118d35412ad0dc995a026017b010` (the authoritative full digest is in each report). The [attempt ledger](evidence/attempt-ledger.json) preserves the initial graph-cache guard failure as INCONCLUSIVE before response evaluation, plus the initial workflow YAML parse failure. The cache guard was corrected separately from the unchanged 4 MB evidence limit.

The hosted run is [39397091111](https://github.com/BuildWithAAI/buildwithAAI/actions/runs/39397091111), job 118542381351, at commit `bc14a8886956a19e4204fa5d2ec48b80b29d3c5f`. Downloaded artifact 12251804373 has ZIP SHA-256 `cc209271bce9095c257eb2ba8fe0f88e4774f15cc2dd387978ff5e4c66e1716f`. Its raw arrays were independently verified after download, including worker/verifier code hashes. [Source equivalence](evidence/source-equivalence.json) maps the local commit to the identical published source tree. These are reproducible artifact checks, not signed execution attestation, full-paper replication or evidence of market utility.

## Provenance and loading

The pinned [author downloader](https://github.com/TuragaLab/flyvis/blob/0a69fa2fc8e1bfe1d837d722c252ab5f5d6fcbfa/flyvis_cli/download_pretrained_models.py) identifies the [public asset folder](https://drive.google.com/drive/folders/15_8gPaVVJV6wGAspwkrdN8r-2NxMY4Kj). Its adjacent MIT notice is retained verbatim in [LICENSE-model-assets.txt](LICENSE-model-assets.txt). Separate training/image datasets are not cleared or acquired. All file IDs, byte lengths and SHA-256 values are frozen in the registration; archive 3,417,042 bytes, notice 1,146 bytes, selected checkpoint 49,378 bytes, metadata 2,222 bytes.

Acquisition uses fixed public HTTPS IDs without API keys, cookies or user credentials. Require exact bounded bytes/digests before inspection. Never extract ZIP members; refuse traversal, links, duplicates, encryption and excessive expansion. Read only the selected checkpoint and metadata; use `yaml.safe_load` and instantiate only the network, never the task or decoder.

Load once with `torch.load(weights_only=True, map_location="cpu")`, with no extra globals or unsafe fallback. Check exact tensor keys/dtypes/shapes/finite values and use `strict=True`. Apply upstream `Network.clamp()` before disabling gradients and record raw/inference state digests separately. Further checkpoint/network calls are refused. No checkpoint is committed.

The supervisor clears inherited environment variables, disables dotenv/CUDA and enforces 900-second wall, 850-second CPU, 6 GiB RSS and bounded evidence output. Temporary HDF5 graph caches have a separate 512 MiB workspace bound and 64 MiB per-file guard; they are not retained scientific evidence. Python guards and a virtual environment are **not an OS sandbox**. This is trusted pinned-source execution, not arbitrary plugin hosting. Artifact consistency is not execution attestation.

## Reproduce on Linux x86_64 / Python 3.12

Prepare the source/environment using the [smoke installation instructions](../flyvis_cpu_smoke/README.md), with the same pinned source and hash-locked CPU dependencies. Then:

```bash
python scripts/run_flyvis_reference.py --source .flyvis-upstream --python .flyvis-venv/bin/python --output experiments/flyvis_trained_reference/generated/attempt-1
python scripts/verify_flyvis_reference.py experiments/flyvis_trained_reference/generated/attempt-1
```

The output directory must not exist. For already downloaded assets supply both `--archive /absolute/path/results_pretrained_models.zip` and `--license /absolute/path/license.txt`; all checks still apply. Completed failures preserve arrays and return nonzero. Incomplete attempts preserve `worker.log` and `incomplete.json`.

The verifier uses the standard library only and recomputes decisions from raw NPY arrays. Adversarial tests cover the 17/18 boundary, ordering, object/nonfinite arrays, forged metrics, provenance, unsafe archives and resource claims. CI retains arrays/logs for 14 days; durable summaries and digests belong in `evidence/`.

The ensemble, moving-edge direction tuning, all 26 comparisons, training reproduction, topology controls, market encoder/evaluation and read-only live feed remain separate gates under [BT-000](../../research/BIOLOGICAL_COMPUTE_PROTOCOL.md), [BT-001](../../research/DATA_MEASUREMENT_PROTOCOL.md) and the readiness contracts. Other species retain their [source audit](../../research/OPEN_MODEL_SCIENTIFIC_AUDIT_20261020.md) gates.
