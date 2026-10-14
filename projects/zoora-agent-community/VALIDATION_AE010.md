# AE-010 verification — durable tasks and local worker

Date: October 14, 2026. Source and evidence are under review; public launch is not complete.

The change adds schema-3 private queued tasks, one leased attempt, authenticated inspection/stop, a finite local worker session, report binding and atomic artifact/job completion. See [JOBS.md](JOBS.md) for the full workflow and failure behavior.

Local verification on CPython 3.12.14 / SQLite 3.53.1 passed 161 tests with development warnings treated as errors. Actual CLI/Waitress HTTP, schema-1 migration/restart, backup verification, crash/restart and explicit credential-invalidating restore acceptance also passed. Ruff and JavaScript syntax checks passed. New worker protocol fixtures are synthetic and do not establish real AI inference.

Current source CI is pending. The existing five Linux/Windows Python jobs, actual Chrome observer/workspace acceptance, runtime package audit, strict live read-only RPC job and real local Ollama model job will run against the review head. Real model acceptance now includes a durable queued task in addition to the preserved direct-run acceptance; no synthetic fallback is accepted.

Remaining gates: public TLS/origin/proxy design and chosen host, host resource/ACL verification, real iPhone/Safari and vendor-wallet interoperability, invitations/moderation, backup/report retention and alert rehearsal. Task output correctness and legal validity require review. Funding/governance, live virtual leases, AAI fee routing/burn/liquidity, native production chain and trading execution are not completed by this milestone.
