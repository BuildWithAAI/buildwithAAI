# Initial brain-data source inventory

**Initial source check: September 22, 2026. RESEARCH; not exhaustive, not a downloaded dataset collection, and not a license approval.** The table records candidate evidence from original research and project-maintained resources. It does not verify any Pump.fun coin, its code, or its claims.

| Candidate | What the cited resource supports | Permission / use status | Next question |
| --- | --- | --- | --- |
| Adult female fruit fly / FlyWire | The [2024 wiring paper](https://www.nature.com/articles/s41586-024-07558-y) describes 139,255 reconstructed neurons and roughly 50 million chemical synapses | [FlyWire guidelines](https://flywire.ai/guidelines) specify CC BY-NC 4.0 for the stated public release; do not assume commercial trading use is permitted | Pin exact release, export, attribution, intended use, and any permission needed; check newer releases separately |
| Fly / Janelia hemibrain | [Project page](https://www.janelia.org/project-team/flyem/hemibrain) describes a partial central-brain reconstruction of about 25,000 neurons and connectivity exports | Project lists CC-BY; check exact asset/version, attribution, and accompanying tool terms | Select a manageable table/subgraph and preserve coverage limits |
| C. elegans worm | [OpenWorm Connectome Toolbox](https://openworm.org/ConnectomeToolbox/) organizes anatomical, functional, and extrasynaptic sources | Dataset and software terms must be checked separately | Choose one source and consistent neuron identifiers; do not mix datasets without provenance |
| Mouse / MICrONS | [2025 primary paper](https://www.nature.com/articles/s41586-025-08790-w) describes functional/connectivity data from a region of visual cortex | Data/export/tool terms not yet reviewed for this experiment | Scope one tractable region; do not describe it as a whole mouse brain |
| Xenopus tadpole | [2017 primary paper](https://www.nature.com/articles/s41598-017-13804-3), also available in [PubMed Central](https://pmc.ncbi.nlm.nih.gov/articles/PMC5648846/), studies model-generated spinal-cord connectivity and swimming behavior | Code/data availability and terms need verification | Separate simulated circuitry from a complete measured brain reconstruction |
| Jellyfish | Earlier founder research interest; no selected verified dataset in this inventory | SOURCE_REQUIRED | Locate original neural mapping/model studies and evaluate access and scope |
| Cat, monkey, crow | Founder-suggested targets; no equivalent complete neuron-level dataset established by this initial audit | SOURCE_REQUIRED | Audit each species independently; regional imaging is not a neuron-level whole-brain connectome |

These are source pointers and scoped summaries. Pages may describe historical releases; do not call an old release the latest without a fresh check. Differences in sampling, anatomy, resolution, and dynamics prevent treating the rows as interchangeable brains ready to plug together.

## Record for every candidate before selection

Title, authors/institution, primary URL/DOI, release date, exact dataset version, species/specimen/life stage, anatomy, measurement method, resolution, missing/estimated connections, neuron IDs, synapse types/weights, functional observations, available files/API, sizes, compute/storage estimate, license text, attribution, permitted use assessment, and open questions. Distinguish source facts from our proposed transformations.

No inference that a public research license authorizes every downstream use is made. Resolve terms for the actual dataset and intended deployment before implementation or distribution. Avoid raw imaging downloads until needed for a scoped experiment.

## Initial evaluation requirements

Document which weights/dynamics are observed, inferred, randomized, or learned; how market features map into the network; how outputs are read; and how species modules are connected. Evaluate against randomized topology/weights and comparable-size/cost baselines, module ablations, and a no-trade option. Publication should include negative findings.

[Multi-Brain Lab](../projects/MULTI_BRAIN_LAB.md) · [Task AAI-T-023](../tasks/BACKLOG.md#aai-t-023)
