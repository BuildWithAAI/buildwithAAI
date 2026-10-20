# Biological neural models: GitHub and scientific evidence audit

**Audited October 20, 2026 UTC. Status: source/publication review completed; upstream runtime replication and market validation not performed.** This extends the [measured-data foundation](MULTI_BRAIN_LIVE_PREP.md) with executable-model candidates for the founder's fly, tadpole, cat and monkey research direction. It does not change runtime readiness, import permission, deployment policy or transaction authority.

Five model repositories were matched to original peer-reviewed publications. Twenty selected files from those repositories and one separate framework were inspected at exact commits; their Git blob identities were recomputed and SHA-256 digests retained in the [machine-readable evidence record](model-audits/open_models_20261020.json). This is a targeted source audit, not a complete code/security review or an independent reproduction of the papers.

## Findings and selection

| Candidate | Primary scientific evidence and actual scope | Reuse/runtime finding | Research decision |
| --- | --- | --- | --- |
| [FlyVis](https://github.com/TuragaLab/flyvis) | [Lappalainen et al., Nature 2024](https://doi.org/10.1038/s41586-024-07939-3): task-optimized fly motion-vision circuitry across 64 cell types; authors compare predicted neural activity with 26 studies | MIT code; separate assets not cleared. Python >=3.9,<3.13; checkpoint loader explicitly uses `weights_only=False` | Preferred first isolated biological reference reproduction, conditional on verified assets/environment |
| [Drosophila brain model](https://github.com/philshiu/Drosophila_brain_model) | [Shiu et al., Nature 2024](https://doi.org/10.1038/s41586-024-07763-9): brain-wide LIF model with feeding and antennal-grooming circuit evaluations | MIT code; FlyWire 783 public data has noncommercial terms; paper/default release 630 must be distinguished. Brian2 environment not installed | Retain for circuit research; no commercial/live eligibility established |
| [Tadpole CNS model, ModelDB 267146](https://github.com/ModelDBRepository/267146) | [Ferrario et al., PLOS Computational Biology 2021](https://doi.org/10.1371/journal.pcbi.1009654): modeled touch-to-swimming hindbrain/spinal circuit and separate virtual-body study | Explicit code license not located; selected functional entry point fails Python 3.12 parsing due to Python 2 syntax; NEURON mechanisms need compilation | Real model source exists; resolve terms and legacy compatibility before integration |
| [Cat LSV1M](https://github.com/CSNG-MFF/mozaik-models/tree/main/LSV1M) | [Antolik et al., PLOS Computational Biology 2024](https://doi.org/10.1371/journal.pcbi.1012342): V1 layers 4 and 2/3, with anatomical/physiological response comparisons | Model code MIT; Mozaik framework separately CeCILL 2.0. Published setup described as 16 processes and 128 GB RAM | Later reproduction with an explicit resource budget |
| [Macaque multi-area model](https://github.com/INM-6/multi-area-model) | [Schmidt et al., PLOS Computational Biology 2018](https://doi.org/10.1371/journal.pcbi.1006359): layer-resolved resting-state dynamics in 32 visual cortical areas | Code CC BY-NC-SA 4.0; NEST/MPI workflows and substantial full-scale compute | Research candidate; noncommercial restriction remains unresolved for this project's commercial use |

These are different computational models, not interchangeable complete animal minds. A whole-brain connectivity-based model can still be validated only for selected circuits. Regional cortex models are not complete cat or monkey brains. The papers concern neural or behavioral phenomena; none of these five papers establishes market-prediction performance, cross-species fusion benefits or transaction correctness.

This broader search adds a **different 2021 tadpole source** beyond the 2017 Davis study in the earlier inventory. The older paper's code-on-request statement does not imply all tadpole models are unavailable. Likewise, the cat and macaque executable models here are separate candidates from the regional connectivity datasets previously listed. Preserve those distinctions when selecting assets.

## Reproducible source snapshots

| Repository | Inspected commit |
| --- | --- |
| TuragaLab/flyvis | `0a69fa2fc8e1bfe1d837d722c252ab5f5d6fcbfa` |
| philshiu/Drosophila_brain_model | `91bdd1e7dcf193f3e7ca5a8933497fcef63b7960` |
| ModelDBRepository/267146 | `b096112c79cc284c3e9c820bc1fdc16f50f08815` |
| CSNG-MFF/mozaik-models | `2df93c13489b3f755b25787c8a3ce02062daf2fa` |
| CSNG-MFF/mozaik, separate dependency | `33bdb3f77f516e9ec195cb817450fc10f7854bba` |
| INM-6/multi-area-model | `0a658be40bef3249cbe452f38809edf7d2f524ba` |

Default-branch HEAD refs were resolved with `git ls-remote`. Selected file contents were retrieved at those exact commits through GitHub; file byte identities were checked against Git's `blob <length>\0<bytes>` SHA-1 format, and SHA-256 digests were recorded. The framework license text returned by the connector differed from its original blob bytes; the original GitHub REST blob was fetched and verified before hashing. No normalized-text digest was substituted for a source-file digest.

These are audit-time snapshots, **not verified paper-release commits**. Current repositories may contain later changes; the cat README already includes protocols beyond the original publication. Recover the precise publication configuration/release and compare it with the audit snapshot before declaring paper replication. Commit/file hashes fix byte identity; they do not certify scientific validity, author identity or safe execution.

## Model-specific evidence and unresolved work

### FlyVis

The final Nature paper's data/code-availability statements explicitly link FlyVis, and the official README links that paper. Its [PubMed record](https://pubmed.ncbi.nlm.nih.gov/39261740/) confirms the paper identity and scope. Connectome measurements constrain architecture; free neural/synaptic parameters are learned for optic-flow estimation. The authors' comparisons support specific response predictions, not a claim that wiring alone supplies every biological parameter or that all ensemble solutions are equivalent.

At the pinned code, `pyproject.toml` requires Python >=3.9,<3.13; the project's Python 3.14 CI environment cannot directly satisfy that range. The optional pretrained dependency set includes older exact pins, so a separate resolved and locked environment is necessary. It has not been installed here.

The download helper declares SHA-256 values for pretrained-model and clustering ZIP archives. Those are **upstream-declared expected hashes**, recorded in the JSON; no archive was downloaded or independently matched during this audit. Separate model weights, connectome inputs and training stimuli remain subject to their own provenance and terms.

The inspected checkpoint utility calls `torch.load(..., weights_only=False)`. [PyTorch's loading documentation](https://docs.pytorch.org/docs/2.14/generated/torch.load.html) explains the danger of untrusted pickle-based checkpoint input. General checkpoint deserialization can execute serialized code; this is a loading boundary to address, not evidence that the author's weights are malicious. A reproduction worker must have no production credentials, signing keys or writable production mounts. Verify checkpoint origin and bytes before loading; evaluate safer state-dictionary formats/loading without assuming compatibility. A hash match alone does not make an arbitrary checkpoint trustworthy.

### Shiu Drosophila model

The final paper's code-availability statement explicitly links this repository; the README still links the earlier 2023 preprint. The final study describes Brian2 LIF simulations and reports experimental checks on feeding-related predictions, including optogenetic/behavioral evidence, plus a separate grooming evaluation. This is meaningful biological evidence with a defined domain, not a reproduction performed by this project.

The README says the default/paper data is FlyWire 630 and documents a 783 alternative. The [current provider guidelines](https://flywire.ai/guidelines) explicitly put the public release under CC BY-NC 4.0. Do not silently substitute releases or infer the rights of 630 from the 783 notice. Code MIT does not override data terms. Large result archives and all-core defaults also require a bounded storage/compute plan before execution.

### Tadpole CNS model

The final paper's data-availability statement links ModelDB 267146 and a **separate** Sibernetic virtual-tadpole repository. The CNS model represents roughly 2,300 neurons in 12 classes and generates motor activity for touch-triggered swimming. Some population properties and connections are hypotheses or probabilistic constructions, not a complete directly measured tadpole connectome. We have not inspected or reproduced the separate virtual-body code.

The complete GitHub tree at the pinned CNS commit contained 105 blobs and no license-named file. Selected READMEs and `functional model/main.py` do not establish a code reuse grant; this limited finding does not prove that no permission exists elsewhere. The article's CC BY notice alone does not resolve source-code rights.

Without executing code, `ast.parse` under Python 3.12.14 fails on `functional model/main.py` at line 98 because of Python 2 `print` syntax. The README also requires compiled NEURON mechanisms. A legacy environment or reviewed port and explicit permissions are prerequisite work; changing print syntax alone would not prove numerical equivalence.

### Cat LSV1M

The paper directly links both `mozaik-models/LSV1M` and the separate Mozaik library. Authors compare simulated V1 responses with anatomy, spontaneous-activity statistics, visually driven conductances and tuning measurements. Modeled coverage is a cortical patch with layers 4 and 2/3, not the full cat nervous system.

The model repository's MIT license and the framework's CeCILL 2.0 license must be tracked separately. The paper describes Mozaik version 0.4; the framework HEAD inspected here is not asserted to be that release or a compatible substitute. The README reports a 16-process EPYC 7302/128 GB setup and roughly ten hours for listed full protocols, or 1.5 hours for spontaneous activity. These are author-reported examples, not measured requirements or timings from our system. Stimulus files, reference outputs and dependency terms remain to be pinned.

### Macaque multi-area model

The original paper and README identify the model and its companion connectivity/stabilization studies. The study compares selected resting-state spiking and inter-area statistics with observations; plausible dynamics depend on coupling and stability assumptions. Its 32 visual areas are represented by local layered patches, not a complete primate brain.

The repository license is CC BY-NC-SA 4.0, so classify it as source-available with a noncommercial restriction rather than unrestricted commercial open source. NEST versions in the paper and later repository compatibility notes differ. Any downscaled simulation must be identified as downscaled; it cannot stand in for a full-scale reproduction without evaluation.

## Later research that strengthens the required controls

Two later arXiv abstracts were checked as **preprints**, without reproducing their code or establishing peer-reviewed status:

- [Dhiman, April 5, 2026](https://arxiv.org/abs/2604.04033v1), reports that shared from-scratch initialization and degree-preserving nulls remove apparent advantages in its FlyVis-based comparisons. This motivates controls against initialization and graph-degree confounds; it does not by itself refute every biological result in the 2024 paper.
- [Dhawan, October 9, 2026](https://arxiv.org/abs/2610.13018v1), reports that mechanistic conclusions depend on task-matched controls, intervention definition, circuit representation and ensemble member. Treat such findings as scoped research claims, not established results of this project.

Together with [BT-000](BIOLOGICAL_COMPUTE_PROTOCOL.md) and [BT-001](DATA_MEASUREMENT_PROTOCOL.md), this supports matched training budgets, fair initialization, degree-preserving random controls, conventional baselines, multiple seeds, ablations and publication of negative results. Agreement between species modules would not establish independent evidence.

## Next experiment and acceptance boundary

The recommended next unit of work is a **FlyVis biological reference reproduction before market adaptation**:

1. Select a publication-linked release/configuration; pin code, exact permitted checkpoint/input assets, file digests and compatible dependency lock. Resolve asset terms first. Use an isolated CPU/GPU worker with explicit time/memory/storage bounds; the phone can remain the control surface.
2. Before running, commit the stimulus panel, ensemble-member selection, reference numeric outputs, metric definitions and tolerances. Start with the published flash and moving-edge response protocols and contrast/motion-tuning comparisons. A smoke run can establish execution only; it cannot establish scientific replication.
3. Record original and synthetic assumptions separately; report all selected members, seeds, failures, timing and peak memory. Check temporal-step/numerical sensitivity and repeatability. Compare results with the exact author references instead of judging screenshots.
4. Only after that reference result, preregister one market task, causal encoder, train/validation/untouched-test periods, cost assumptions and controls under BT-000/001. Evaluate transfer from scratch; biological fit does not imply financial usefulness.
5. A successful offline result can support a later read-only shadow experiment with actual data lineage, stale/outage handling and paper decisions. It does not grant wallet execution or live promotion.

**Completed here:** source/publication matching, selected source inspection, file identity checks, license separation and static compatibility evidence. **Not completed:** upstream model execution, replicated paper figures/statistics, asset permission clearance, trained market models, live services or transactions. No third-party code or checkpoints were executed, no funds moved, and no production service changed by this audit.

## Audit validation

Twenty file blobs were verified. Six selected Python files were parsed without imports or execution: five parsed successfully; the tadpole entry point failed as described above. Parsing is not a dependency, runtime, security or scientific test. The JSON was checked for valid syntax, consistent commit/file references and explicit false runtime/market/live flags. This documentation/evidence change does not alter model runtime code and does not rerun or reclassify the foundation's 49 tests as upstream scientific validation.

The evidence JSON is a research catalog only; it is not consumed by the runtime source/readiness allowlist. No whole-project completion, unrestricted commercial permission, error-free transactions, biological consciousness or trading advantage is inferred.
