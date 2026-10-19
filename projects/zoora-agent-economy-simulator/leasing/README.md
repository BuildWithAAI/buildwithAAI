# VL-001/002: Virtual Business Spaces definitions and validator

**SYNTHETIC laboratory; no monetary value.** This isolated Rust crate implements bounded data definitions and validation against one compiled synthetic registry/template under [approved issue #19](https://github.com/BuildWithAAI/buildwithAAI/issues/19). It does not accept leases, grant access, verify real authority, move funds or connect to a network. Existing simulator/review/marketplace source and replay identities are unchanged.

[VL-001 schema](../../virtual-business-spaces/SCHEMA_VL001.md) · [VL-002 rules and limitations](../../virtual-business-spaces/VALIDATOR_VL002.md) · [Project scope](../../VIRTUAL_BUSINESS_SPACES.md) · [Mandatory controls](../../virtual-business-spaces/CONTRACT_RULES.md).

With Rust 1.99.0 and Python 3:

```sh
cargo fmt --all -- --check
cargo clippy --locked --all-targets -- -D warnings
cargo test --locked --all-targets
cargo test --locked --release --all-targets
cargo build --locked --release --bin vl-validate
python scripts/verify_vl002.py
```

The CLI displays its controlled fixture or validates bounded JSON on stdin at an explicit Unix millisecond instant:

```sh
cargo run --locked --bin vl-validate -- fixture
cargo run --locked --bin vl-validate -- validate 1000 < fixtures/valid_request.json
```

The redirect works in POSIX shells/Windows cmd; the cross-platform Python verifier invokes the executable directly. Times are laboratory instants. `VALID_DRAFT` describes synthetic eligibility at that instant, with ungranted access and unobserved payment. It is not consent or reusable authorization. Refusals exit 1 and return a fixed reason without echoing submitted values; invalid arguments/I/O exit 2. The CLI writes no journal.

The 38 Rust tests cover schema/parser bounds, exact units, duplicate/unknown fields, closed clauses, version/content/registry bindings, altered recipients/operators/authority, quote timing, notice/expiry, complete hashes and deferred renewal. Twenty independent Python checks exercise the compiled CLI and rebuild its hashes. CI runs both test modes and the independent check on Linux/Windows, plus a separate leasing dependency audit. The verifier writes reproducible synthetic evidence under ignored `target/validation-evidence/`.

Serde/serde_json and RustCrypto sha2 are pinned with a committed lockfile. VL-001 records retain their constructor/getter API; closed enum serialization was added there. Matching an opaque pin to a synthetic fixture does not verify a real identity, authority or source document.

VL-003 acceptance/booking/persistence/replay, VL-004 accounting and VL-005–007 scenarios/reporting/production review remain open. The crate is not wired into the pilot, other engines, wallets or real PCs. No license decision or grant is introduced.
