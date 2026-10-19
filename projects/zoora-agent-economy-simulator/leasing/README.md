# VL-001: Virtual Business Spaces schema

**SYNTHETIC laboratory definitions; no monetary value.** This isolated, dependency-free Rust crate implements the data-definition portion of [approved issue #19](https://github.com/BuildWithAAI/buildwithAAI/issues/19). It does not implement lease acceptance, access activation, payment, accounting, cryptographic verification or a network service. No existing simulator/review/marketplace source or replay identity is changed.

[Schema and lifecycle specification](../../virtual-business-spaces/SCHEMA_VL001.md) · [Project scope](../../VIRTUAL_BUSINESS_SPACES.md) · [Mandatory controls](../../virtual-business-spaces/CONTRACT_RULES.md).

Run with Rust 1.99.0:

```sh
cargo fmt --all -- --check
cargo clippy --locked --all-targets -- -D warnings
cargo test --locked --all-targets
cargo test --locked --release --all-targets
```

Seventeen test cases cover byte/identifier/time/capacity/selection bounds, exact separate amounts and overflow, scoped party/space relationships, correlated operators, inert drafts and separate renewal references. Passing these checks proves only those structural properties. A caller-declared hash, source ID or authority claim is not independently verified evidence. Expired or unknown-authority material may exist in a draft, which always has no granted access.

The crate is not wired into the live pilot, existing engine or any wallet. The next milestone is VL-002: approved synthetic template registry, canonical term hashing, strict bounded input parsing, policy/authority/time validation and explicit refusal results. Runtime leases, booking conflicts, replay journals and ledger accounting remain VL-003–006. Production prerequisites remain VL-007. No license decision or grant is introduced by this crate.
