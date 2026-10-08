# BT-003 P0 audit and fixes — 2026-10-08

Audited historical PR #9 head `ae18eb8ae23c45bd8c423d77b924427bf9f32b25`. Its existing 15 offline tests passed. The previous successful CI run #8 is historical evidence only.

Fixed independently from the scanner branch:

- Reject oversized and invalid slot windows before range allocation or acquisition. Validate returned slots.
- Enforce research RPC allowlist (`getBlock`, `getBlocks`), HTTPS, no redirects, bounded timeout/response size and validated JSON-RPC envelopes. Reject missing block-list results rather than treating failed data as an empty list.
- Preserve missing transaction execution metadata as unknown success with a quality flag. Reject null, boolean, negative and unknown transaction versions.
- Copy payload input and verify its hash before serialization/normalization; reject non-finite canonical JSON. The nested dict is still mutable, but mutation is detected at these boundaries.
- Compare timezone-aware availability instants for replay cutoffs/order; reject unsupported modes and accept valid string modes without bypassing commitment filters.

Validation: all 27 offline tests passed on Python 3.12.14 (15 original + 12 audit regressions), syntax compilation and Ruff E9/F passed. Live block acquisition was not reverified by this audit. Bounded acquisition can reject larger legitimate blocks, explicitly as an acquisition failure. Requested commitment remains a provider request, not independent consensus verification. This harness is not a scanner launch dependency and contains no wallet signing or execution paths.

Final-head CI and review are still required before merging. No merge or production deployment was performed.
