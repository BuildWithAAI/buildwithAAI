# AE-027 — read-only provider customer preflight

October 16, 2026. The sandbox connector can now inspect one operator-supplied customer ID before a transfer rehearsal. `preflight` performs one narrowly allowed customer GET, projects bounded onboarding signals and reports missing or conflicting information. It requires no payment journal and refuses `--state`. It never creates a customer, accepts terms, changes KYC, requests an endorsement or creates a transfer.

This is an operator diagnostic, not an admission gate automatically inserted into `advance`. Existing transfer commands and journal authority are unchanged. Community service remains **0.9.0/schema 6** and the separate provider journal remains **schema 3**; no migration is added. Retained acceptance uses actual CLI processes and verified local TLS. **External Bridge requests remain zero; vendor interoperability remains UNVERIFIED.**

## Operator command

From this project directory, after obtaining an approved Bridge sandbox account and its customer ID:

```sh
python -m zoora_community.bridge_sandbox preflight --customer-id CUSTOMER_UUID --key-file ./bridge-sandbox.key
```

Replace `CUSTOMER_UUID` with the exact canonical lowercase customer UUID. The key must be in a private regular file accepted by the existing `read_key` checks; only `sk-test` credentials are supported. Use your approved secret-management workflow to populate that file. No bearer key belongs in a command argument, source file, community update or CI artifact. Keep the resulting report private: it contains a customer ID, response hash and credential fingerprint, although personal details and bearer keys are excluded.

The only customer endpoint allowed is `GET https://api.sandbox.bridge.xyz/v0/customers/{customerID}`. The request has no body or idempotency header. Customer listing, query expansion, customer updates, KYC simulation, endorsement requests, other hosts and redirects remain refused. TLS verification, ten-second total deadline, 64-KiB response cap, strict JSON and fixed error redaction are inherited from the transfer client.

## Reading a result

| Result | Meaning | CLI exit |
| --- | --- | ---: |
| `CUSTOMER_SIGNALS_OBSERVED` | Returned ID matches; customer is active; terms are explicitly accepted; base endorsement is approved; its supplied pending/missing/issue summary is clear; any supplied legacy KYC signal does not conflict. | 0 |
| `CUSTOMER_SIGNALS_INCOMPLETE` | At least one required observation is absent, with no supplied blocking signal. | 2 |
| `CUSTOMER_SIGNALS_BLOCKED` | A supplied signal is adverse, unrecognized or contradicts an approval. Missing fields remain visible too. | 2 |
| JSON error on stderr | Invalid input/key, rejected response, HTTP error, timeout or local I/O failure. | 1 |

Argument-usage errors also use argparse's exit 2 and stderr usage text; they produce no result object. Automation must inspect both the JSON assessment and exit code.

The report keeps `customer_status`, `kyc_status`, `terms_accepted`, `base_endorsement_status`, `base_requirements_clear`, fixed missing/blocking field names, the exact host/method/path, response-byte SHA-256 and domain-separated credential fingerprint. It excludes names, email, addresses, identity documents, internal rejection reasons, requirement contents, unrelated endorsement details and deprecated capabilities. Arbitrary unknown status strings become `UNRECOGNIZED`, preventing a provider error or reflected private value from leaking through that field. Malformed known fields, duplicate endorsement names, excessive collections and a different returned ID are rejected.

Absent data stays absent. Approval in an optional legacy `kyc_status` cannot manufacture a missing current `status`; an explicit adverse legacy signal blocks otherwise positive signals. A supplied base status of `approved` with outstanding requirements also blocks. A partial requirements summary stays incomplete. Nonempty missing-requirements objects are conservatively outstanding; the diagnostic does not interpret their logical expressions. Recognized nonapproval labels do not imply a universal vendor enum; all unrecognized labels remain blocked.

## Provider documentation and limits

Official documentation checked October 15, 2026:

- [Single-customer API](https://apidocs.bridge.xyz/api-reference/customers/get-a-single-customer-object): exact-ID GET, `status`, terms, endorsements and deprecated capabilities.
- [Customer guide](https://apidocs.bridge.xyz/platform/customers/customers/api) and [sandbox guide](https://apidocs.bridge.xyz/get-started/introduction/quick-start/setting-up-sandbox): guides also refer to `kyc_status`; sandbox configuration and approvals can differ from production.
- [Endorsements](https://apidocs.bridge.xyz/platform/customers/customers/endorsements): base concerns USD rails; it is not evidence of every rail or card product.
- [Authentication](https://apidocs.bridge.xyz/api-reference/introduction/introduction): HTTPS `Api-Key`; sandbox resource access is scoped to developer accounts.

These documented shapes guide the adapter; they do not prove that a credentialed external account accepts this implementation. The command does not establish account continuity across keys, entitlement to a particular Solana/USDC route, merchant acceptance, card eligibility, spendable balance, Phantom authorization or settlement. The report explicitly leaves those capabilities false/unavailable. A matching customer read under another key does not unblock a saved credential-bound transfer. Preflight does not consume a synthetic budget, release an uncertain reservation or reopen a retry window.

The result is a point-in-time observation, with no reusable grant or freshness guarantee. No payment code consumes it as authorization. Response hashes identify received bytes; they do not authenticate a later shared report or expose its complete preimage. An honest private host and TLS trust store remain assumptions.

## Verification

```sh
python -bb -X dev -W error scripts/bridge_preflight_evidence.py
```

The new separate-process/local-TLS rehearsal passes **27 checks across 19 preflight CLI cases**. It records **16 customer GETs**, with **zero payment-create requests from preflight**. A separate original unknown-payment setup contributes one CREATE POST and one fixture transfer, yielding 17 total local HTTPS requests. That original POST is not an effect of preflight. Read-only checks preserve byte hashes and audited histories of both an original credential-bound journal and a recovery-only journal.

Additional checks cover wrong IDs, absent status, paused accounts, conflicting KYC, terms, missing/duplicate endorsements, outstanding requirements, unknown strings, HTTP errors, production redirects, malformed JSON, response bounds, unsafe input and state refusal before HTTP. No external credentials are supplied. The fixture accepts test keys; its alternate-key scenario tests local credential guards, not real vendor account continuity.

The report is `evidence-output/bridge-preflight.json`. CI archives retain redacted results, wire summaries and journal hashes/audit summaries, not customer payloads, bearer keys or journal database files. See [source-specific validation](VALIDATION_AE027.md), [recovery rules](BRIDGE_RECOVERY.md) and the [community draft](../../docs/community/AE027_COMMUNITY_UPDATE.md).
