# AAI.fun — contiguous historical source sessions

This stage extends source-to-model research with resumable public-RPC collection and histories that continue across retained archive files. It does not automatically fit a real-data model.

The original source archive stays bounded to four requested slots and 8 MiB of received response bytes. A session captures one slot per archive, up to 64 slots. That is a small collection window, not a comprehensive historical dataset. Dense blocks can still exceed the per-archive bound and fail. There is no sampling, truncation presented as complete, interpolation, endpoint substitution or synthetic fallback.

## Collection and recovery

A retained finalized getSlot response fixes the session range. Each segment also retains its existing genesis, finalized boundary, produced-slot coverage and full-block response evidence. Only the existing allowlisted public endpoints and four read-only RPC methods are used.

Each segment has up to three immutable attempt directories. A failed request remains available. Resume verifies completed segments, then requests unfinished slots in the original range using the same pinned collector code. A segment interrupted before writing an archive remains an explicit interrupted attempt. A completed session is verified without further network calls.

An OS advisory lock prevents concurrent writers and releases when the process exits or crashes. The one-byte lock file remains. Root, segment and attempt paths are fixed and checked. Capture does not overwrite an existing session.

A failure during the initial anchor, before request.json exists, cannot establish a resumable range. Its response is retained; start a new output directory. Exhausted attempt or storage budgets also require a new collection rather than deletion or replacement of retained evidence.

Collection allows at most 64 segments, three attempts each, 128 MiB of stored files and 900 seconds per invocation. It reserves one full archive-file budget before starting another attempt. Production RPC requests are spaced by at least 0.8 seconds and retain the existing 15-second request timeout. Resume is explicit; nothing is scheduled.

The final manifest is reconstructed from retained inputs. It binds the request, anchor, every attempt digest, selected archives, produced block hashes/parents and source counts. The raw-byte total covers selected complete archives; failed attempts remain hashed separately. Incomplete sessions do not become prepared training sources.

## Joining market histories

The optional AAI_CONTIGUOUS_TRADE_DATASET_V1 format retains individual archive provenance and adds ordered source windows. Adjacent requested intervals are joined only after verifying produced-block parent slots and hashes across archive boundaries. Explicit skipped slots can be bridged; a missing requested interval starts a separate window. An omitted produced block cannot be substituted with a skipped-slot claim when subsequent parent linkage contradicts it. Endpoint changes within a joined interval are rejected.

A market remains identified by pool, base mint and quote mint. All supported swaps from the same market transaction stay atomic. Features, recurrent episode state and delayed observed-price labels can continue across archive files inside a verified window. No observation or label is invented for an empty/skipped slot. Horizon limits still exclude stale targets.

Each episode references a source-window digest; the window retains all source-archive digests. Both joined-window and original-archive trade totals are checked. Reconstruction from the original raw inputs remains required: dataset metadata and self-consistent hashes alone do not establish genuine on-chain evidence.

The existing unjoined dataset/package formats remain the default. Existing control inputs and hashes are regression checked. The extended package advertises its mode explicitly; CLI fitting, source verification and native neural input copying preserve that mode. The source package accepts up to 64 archives under a shared 128-MiB input bound. Existing 512-episode, 8,192-observation, 16-MiB-per-JSON and tighter native inference limits still apply; excess data is rejected.

Assessment reports joined boundaries and candidate next-transaction pairs crossing archive boundaries. These are availability counts, not training-readiness or performance claims. Asset-group isolation, chronological partitions, horizon gaps, minimum sample counts and an explicit pinned plan are still necessary. training_ready and training_performed remain false during source preparation.

## Commands

~~~sh
python scripts/collect_trade_history.py capture --slots 6 --output /private/aai-history
python scripts/collect_trade_history.py resume --directory /private/aai-history
python scripts/collect_trade_history.py verify --directory /private/aai-history
python scripts/collect_trade_history.py prepare --directory /private/aai-history --output /private/aai-prepared
python scripts/train_trade_readout.py verify-sources --directory /private/aai-prepared
~~~

Use --start-slot with capture to fix a historical starting slot; the entire requested interval must already be finalized. With no start, collection ends at its retained finalized anchor.

Existing archives can also be prepared with explicit joining:

~~~sh
python scripts/train_trade_readout.py prepare --archive /private/a.json --archive /private/b.json --stitch-contiguous --output /private/prepared
~~~

The normal train command accepts this prepared source and an explicit valid plan. Source preparation performs no fitting.

## Evidence and limits

Mocked transport tests establish software behavior only. Hosted real-history evidence must separately show actual capture, complete raw-source verification and a prepared source reconstruction. The native workflow additionally processes a three-slot joined source through the frozen FlyVis model, while its readout fitting remains synthetic.

The retained source assertion is SINGLE_RPC_ASSERTION_NOT_INDEPENDENT. The first produced block's predecessor is outside the captured range. Decoder coverage is still the existing PumpSwap fixed-prefix CPI subset. Program version at each event, complete platform mechanics, historical observer latency, executable quotes/depth, rug/bundle ground truth and a financial advantage remain unestablished.

Six slots are only a short integration sample. A larger, representative, independently assessed historical corpus remains future work. Existing benchmark evidence favored the raw-feature control over the neural encoding; joining source files does not reverse that result.

No wallet, signing, order submission, funding, paid provider, token launch, merge or deployment is introduced.
