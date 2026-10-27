# Biological data attribution

The `hemibrain_v1_2_first128.json` connectivity subset is derived from Janelia FlyEM's **hemibrain v1.2** traced adjacency export, described by Scheffer et al., **A connectome and analysis of the adult Drosophila central brain** (2020), [eLife 57443](https://elifesciences.org/articles/57443).

The [provider's dataset page](https://www.janelia.org/project-team/flyem/hemibrain) links the dataset to [Creative Commons Attribution 4.0 International](https://creativecommons.org/licenses/by/4.0/). That attribution/license applies to the derived data file; it does not assign the repository's code a new license. No endorsement by HHMI, Janelia, Google, the researchers or other contributors is implied.

Changes: select the first 128 numerically sorted body IDs from `traced-neurons.csv`, retain every directed connection in `traced-total-connections.csv` whose endpoints are both selected, and encode source/provenance and graph metadata as JSON. IDs are exact decimal strings. Edge weights remain the source-reported total synapse counts. No normalized weights, learned values, missing-neuron connections or cross-species links are inserted. External connections are omitted, not set to zero. Selection is a bounded software fixture, not a functional or representative brain region.

The export README identifies non-cropped Traced Neurons, generated using neuprint-python v0.4.12 against `hemibrain:v1.2`. It distinguishes total connection counts from per-primary-ROI counts, which omit synapses outside primary ROIs. This import uses the total table and does not sum the ROI table a second time.

Pinned public export: `https://storage.googleapis.com/hemibrain/v1.2/exported-traced-adjacencies-v1.2.tar.gz?generation=1608664696223156`, 45,872,577 bytes, SHA-256 `07d8946eb0c4e3a5cb23d5769c9817847494f9fcadbc0ca239eed7bbd5555cf7`. Acquired and checked October 20 UTC / October 19 America/Chicago, 2026. The full archive is not bundled. The file retains the source/license links and describes this transformation.

Other catalog entries are source pointers and scoped research facts only. Their data/code are not copied here; an article's open-access terms are not assumed to license a separate dataset or software export. FlyWire's public guidelines list **CC BY-NC 4.0** for release 783; this project does not import it or infer commercial permission.
