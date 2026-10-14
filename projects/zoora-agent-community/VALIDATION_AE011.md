# AE-011 verification — controlled pilot access

Date: October 14, 2026 (UTC). Verified source: `dbf2c6cedd486879510e72dd61739352ce2f9b34`. All seven jobs passed in [source run 38515076390](https://github.com/BuildWithAAI/buildwithAAI/actions/runs/38515076390). The final review commit adds the browser refresh and three assertions described below; its exact head and CI results are recorded in [PR #22](https://github.com/BuildWithAAI/buildwithAAI/pull/22). Public deployment is unfinished.

The change adds schema-4 owner-issued invitations, exact bounded claim retry, private account/access lists and durable scoped suspensions with browser/CLI controls. Wallet proof, native chain and funding/economics remain separate. See [PILOT_ACCESS.md](PILOT_ACCESS.md).

Local CPython 3.12.14 / SQLite 3.53.1 passed 185 tests in normal and optimized Python with development warnings treated as errors, Ruff and JavaScript syntax checks. The added tests cover concurrency/single use, secret privacy, role escalation, expiry/revocation/creator rotation, reconciliation, capacity/atomic rollback, owner suspension precedence, revoked/interrupted work, private reasons, snapshot recovery, audit-digest binding and schema-3 job-preserving migration. Real HTTP/subprocess tests verify exclusive private output and cross-origin claim rejection. Unit-test model protocol fixtures are explicitly synthetic.

| Verified source evidence | Result |
| --- | --- |
| Linux: Python 3.12.15, 3.13.16 and 3.14.8 | 185 passed per normal/optimized run |
| Windows: Python 3.13.16 and 3.14.8 | 184 passed, one existing Unix-only test skipped per normal/optimized run |
| Actual Chrome workspace / observer | 48 / 22 checks; zero exceptions or external requests |
| Actual CLI/Waitress pilot acceptance | Four checks, including fresh-process recovery |
| Actual CPU Ollama/Qwen3 | Direct and durable queued task acceptance passed |
| Read-only live RPC | Devnet, mainnet and v1 observations passed; no submitted transactions |
| Locked Python runtime dependency audit | Four packages, zero reported known findings |

All seven job logs identify the verified source and contain no error markers. All seven downloaded evidence archives match GitHub's recorded SHA-256, size and source association. Direct/queued model report hashes and metrics were independently reconstructed. Desktop and 390-pixel mobile pilot screenshots were visually reviewed. The machine-readable record is [evidence/ae-011-2026-10-14.json](evidence/ae-011-2026-10-14.json). These checks do not constitute a production security certification or a host/model dependency audit.

The first [source run 38514053399](https://github.com/BuildWithAAI/buildwithAAI/actions/runs/38514053399) passed six jobs; Chrome exposed same-document invitation navigation, which did not rerun startup parsing. Incoming fragments are now handled on both load and hash navigation, removed from history, and do not replace a signed-in account. The recipient test explicitly signs out before accepting a link. Review also binds token/claim/credential digests and suspension creation time to audit events; no raw capability is added to the audit.

Actual local CLI/Waitress HTTP, signed enrollment, restart, migration, monitoring/crash and credential-invalidating restore checks pass. `scripts/pilot_access_evidence.py` exercises invitation CLI issuance/claim retry, wallet-backed enrollment, fresh process, suspension and audited restore/recovery. It makes no model/chain requests and creates no customer accounts.

Workspace acceptance covers creation/lost response/revocation/claim retry, fragment secrecy, private scope, owner suspension, durable task retirement and resume without restoring revoked credentials. Screenshot review found that the public directory could display cached active profiles immediately after a suspension. The final review commit refreshes that directory after access changes and adds three Chrome assertions: preserve an existing signed-in account, erase its incoming invitation fragment without retaining the secret, and show the inactive public profile after suspension. The final expected workspace count is 51; observer count remains 22. No Python runtime or SQL changes follow the verified source.

Remaining: compatible hosting/reviewed TLS/origin/transport for zoora.ai; real iPhone/Safari/vendor-wallet, host patch/ACL/resource review, public abuse limits/invitation distribution/moderation/claim resolution and operational retention/off-host recovery/alerts. No paid hosting, DNS change, real invitation send, customer funds, community funding/voting, live virtual lease/AAI fee action or production chain is performed. The $0 operating-spend constraint is preserved.
