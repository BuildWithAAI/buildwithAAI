# Research verification and repaired integration joints

The new-module audit covers the 253 multi-brain files added after the October 27 consolidation. Every audited source blob matched `3358ad17bb168c7f0063219202315a094eac01ac` / tree `cf8f8d28de4aa597df06647ef6cd4952e3734e38` before the repairs below. All 253 compiled with Python 3.12.14.

Of 197 self-check entry points, 123 passed, three failed and 71 were explicitly skipped. The skips were 27 network-dependent checks, 35 checks requiring filesystem writes, eight missing `/tmp` fixtures and one required graph argument. Another 56 modules expose no self-check. Each subprocess used a clean environment without credentials and Linux seccomp restrictions denying network calls, process execution and new filesystem writes before imports, with five CPU seconds, ten wall seconds and 512 MiB limits. Inputs were not fabricated to make a check pass. [Per-check evidence](evidence/RESEARCH_SELFCHECK_AUDIT_2026-10-29.json).

## Repaired defects

| Defect | Correction and regression |
| --- | --- |
| `cohort_binder` imported `feature_loader` as an unavailable top-level module | Use the package-relative import; exercise the cohort through its real package and retain `SYNTHETIC_STAND_IN` / `NOT_ESTABLISHED`. |
| `reputation_gate.self_check()` expected a score of 72 to fail a floor of 70 | Preserve the existing arithmetic. Test 72 against floors 70, 72 and 73, including the inclusive boundary. |
| `tape_pass` imported nonexistent `curve_tape.to_tape` | Reuse the existing seven-field curve fixture decoder. Require the exact configured token and curve, reject malformed or foreign rows and unsupported provenance claims, and detach nested inputs before hashing. Do not invent a chain/account-to-trade converter. |
| The closed tape pass discarded fixture provenance while returning a demo `paid` flag | Retain `CURVE_FIXTURE_NOT_CHAIN_ATTESTED`, event hash, `MICRO_DEMO_USD`, `DEMO_CREDITS_ONLY` and `financial_execution=False`; refused events cannot create a demo fee log. Use a private temporary directory for its self-check. |

Seven focused root regressions pass. These repairs do not make the 71 skipped checks pass, fix every admission defect in the production audit, qualify a model or authorize financial execution. The tape pass remains outside the production tool registry.

## Production artifact and grant checks

Completed platform work records its logical input hash, runtime version and the source revision supplied by the host, alongside output hashes and completion time. Unknown source identity remains null. The worker rechecks authority and deadline before completion; removing an operator compute grant blocks its queued and subsequent model steps. These behaviors are covered by the 38-test platform suite, in normal and optimized Python.

Final CI and deployment evidence are recorded in the production audit and implementation PRs. No real funded transaction was performed by this verification.
