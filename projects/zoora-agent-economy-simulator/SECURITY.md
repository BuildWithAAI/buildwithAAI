# Simulator security boundary

This is an offline experiment with **SYNTHETIC** accounts and **SIMULATED_UNITS**. It performs no signing, wallet connection, transaction submission, trading, or RPC access. Seeds initialize a simulation RNG; they are not wallet seed phrases. Do not place secrets or real wallet material in configuration or event records.

## Current controls

- The engine owns private account state; callers receive read-only references.
- Request IDs/sequences, event horizons, processed order, configuration, and replay outcomes are checked.
- Nonpositive/unsupported economic requests are recorded as refusals; checked arithmetic prevents negative/overflowed balances.
- Integer totals/metrics are checked, and conservation/observers are audited after execution.
- Config limits: 100,000 agents, 100,000 ticks, 100,000 lifetime admitted events.
- Strict report schemas, bounded journal/account arrays, 1 MiB TOML and 64 MiB JSON CLI limits.
- CLI rejects final-component symlinks and non-regular input files; reads at most the bound plus one byte.
- Exclusive output creation refuses existing files/symlinks. Unix files use requested mode 0600. Errors expose fixed messages rather than configuration contents.
- No unsafe Rust in this crate, credentials in CI, or persisted checkout tokens. CI action revisions and the Rust toolchain are pinned. Cargo.lock and RustSec audit results provide dependency evidence.

## Limits of these controls

This command-line application is not an OS sandbox or an untrusted upload service. Operate it in a directory/account you control. Parent directories can resolve symlinks, and another process can race the input inspection/open; portable standard-library file checks do not eliminate all such races. Do not run it with elevated privileges or feed it privileged paths. Output files can be partial after disk/I/O failure. Replay verifies content consistency, not author identity or scientific validity.

Library callers accepting hostile input must impose total byte, CPU, and memory limits before parsing/running. The supported maximum configuration is a bounded research budget, not a promise of performance on every computer. Measured benchmark evidence is specific to its CI hardware, compiler, and build profile. Unknown schemas/RNG/version identities fail rather than silently migrating.

Future wallet/on-chain adapters require separate scope, human authorization, threat modeling, security review, and dedicated tests. Marketplace mechanisms, production agent autonomy, and blockchain consensus/native token economics are outside AE-001. This foundation cannot move cryptocurrency.
