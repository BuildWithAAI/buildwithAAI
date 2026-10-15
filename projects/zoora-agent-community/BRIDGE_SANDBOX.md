# AE-024 — durable Bridge sandbox connector

October 15, 2026. This adds executable provider transport and an operator-run CLI. The only destination is `https://api.sandbox.bridge.xyz/v0`; the only operations are creating a narrowly specified Solana/USDC transfer object and retrieving that same object. The implementation accepts only `sk-test…` keys. There is no production endpoint switch, arbitrary URL, redirect following, card-details endpoint or wallet signer.

**External Bridge account acceptance remains UNVERIFIED.** All retained acceptance traffic goes to a local TLS contract fixture, using a public test certificate/key and a fake API key. It exercises real HTTPS and independent CLI processes, not Bridge's actual sandbox service. No external Bridge request, blockchain transaction, bank payment or card issuance has been performed by this milestone. Provider route availability and response compatibility still require a credentialed vendor test.

The existing community service remains **0.9.0 / schema 6**. Its API-authorized commerce books contain synthetic units. This separate sandbox journal does not reinterpret those units as USDC, copy grants, debit budgets, mark purchases settled, or expose a new agent HTTP endpoint. Host operators explicitly prepare each sandbox instruction. Binding a verified provider account, real currency mandate, invoice and wallet signer to that service is subsequent work.

## Commands

Run from `projects/zoora-agent-community` with the locked Python runtime dependencies installed. Create an intent JSON file with exactly:

```json
{
  "request_id": "00000000000000000000000000000001",
  "customer_id": "00000000-0000-0000-0000-000000000001",
  "source_address": "REPLACE_WITH_SANDBOX_SOURCE_ADDRESS",
  "destination_address": "REPLACE_WITH_SANDBOX_DESTINATION_ADDRESS",
  "amount_usdc": "12.500001"
}
```

Replace the illustrative customer ID with an existing sandbox customer UUID, and both address placeholders with distinct canonical 32-byte Solana public addresses approved for your sandbox test. The placeholders deliberately fail validation. Amounts are positive decimal strings with at most six fractional places, normalized without floats; the local per-intent cap is 1,000,000 sandbox USDC units. This is not a production spending allowance or a quoted exchange rate.

```sh
python -m zoora_community.bridge_sandbox --state ./bridge-test-state prepare --intent-file ./intent.json
python -m zoora_community.bridge_sandbox --state ./bridge-test-state show --request-id 00000000000000000000000000000001
python -m zoora_community.bridge_sandbox --state ./bridge-test-state advance --request-id 00000000000000000000000000000001 --key-file ./bridge-test-key
```

The key file contains only your sandbox API key, optionally ending in a newline. It is read locally, never from an agent message or command-line value. On POSIX the file and state directory must exclude group/other permissions; symlink keys, non-regular files and changed file identities are refused. Windows ACL and power-loss guarantees are not certified here. The public test key/certificate in `tests/fixtures` is solely for the local TLS fixture and must not protect a real deployment.

`prepare` saves the normalized terms, a body digest and one generated UUID used as both client reference and provider idempotency key. Retrying the same request ID returns that record. Changed terms conflict. No network occurs during preparation or `show`.

`advance` performs at most one HTTP operation. Exit **0** means preparation/read or a bound provider observation was recorded; it never means money settled. Exit **2** prints an `UNKNOWN` record for a failed or rejected provider observation. Exit **1** reports a local refusal, such as an active lease, conflicting terms, changed key or closed retry window. There is no background retry loop or unattended purchase worker.

## Recovery contract

Bridge documents required POST idempotency keys, unchanged request bodies, a 24-hour guarantee and no idempotency header on GET. The connector stores its exact canonical body and key before transmission, then uses a conservative **23-hour local retry boundary** from the first attempt. It never generates a replacement key for an uncertain intent. [Official idempotency contract](https://apidocs.bridge.xyz/api-reference/introduction/idempotence), checked October 15, 2026.

| Recorded situation | Next permitted action |
| --- | --- |
| Prepared, never attempted | Commit the first attempt before one sandbox POST |
| Lost reply or invalid response; no accepted transfer ID | Retry identical bytes/key within the local retry boundary |
| Worker died with an incomplete attempt | Keep uncertainty; refuse dispatch during its 60-second lease; same-key retry after the lease within the retry boundary |
| A bound transfer ID is known | GET that exact transfer ID, including beyond the POST retry boundary |
| Poll fails or returns mismatched terms | Report latest outcome as UNKNOWN; retain prior observation, its timestamp and the known ID; continue GET rather than POST |
| Unknown ID beyond the retry boundary | Stop automatic submission and require external reconciliation |
| Credential fingerprint changes or wall clock moves backward | Refuse before HTTP and require reconciliation |

The response must bind the customer, client reference, exact normalized amount, currency, rails and source/destination addresses. GET additionally binds the retained transfer UUID. Missing or conflicting terms are refused. Provider state strings are bounded observations; even `payment_processed` does not credit the community ledger or verify settlement. Funding instructions, receipt URLs, personal/card data and provider error text are not returned or retained. Only a response hash and selected bound fields are stored.

SQLite commits claims before network activity and completes them afterward. A second process cannot claim a live lease. A stale worker cannot overwrite a newer attempt's result. Network errors and process death leave uncertainty retained. These checks depend on Bridge's documented idempotency behavior; they do not prove universal exactly-once side effects, service availability, or an honest local host.

The journal is private host state, with up to 64 intents and 32 attempts per intent. It stores a one-way credential fingerprint, not the bearer key. Automatic credential rotation is intentionally blocked because account continuity has not been authenticated. A known-ID import/recovery workflow is not implemented. This journal is separate from the community database and **is not included in community backup/restore commands**. Lost, cloned or rolled-back journals can forget earlier attempts; independently created journals do not provide global request deduplication. Complete host rewriting, clock manipulation and restored stale state are outside its consistency guarantee.

## Evidence and remaining integration

`python -bb -X dev -W error scripts/bridge_sandbox_evidence.py` runs the actual CLI in separate processes against a locally trusted HTTPS fixture. Its test harness redirects transport and injects clock values for lease/retry boundaries; the shipped CLI has neither switch. The fixture's generated effects model the documented provider contract and are not vendor transactions. Evidence goes to `evidence-output/bridge-sandbox.json` without bearer keys.

Unit and process checks cover narrow host/path/key policy, TLS certificate rejection, exact decimals, HTTP/JSON/size/deadline failures, mismatched response terms, duplicate requests, crash recovery, live leases, stale workers, retry closure, key changes, corruption and private file handling. CI runs the new acceptance on all five Python/OS targets while retaining previous checks. Final source/CI/archive results are recorded in the development PR.

The next external gate is a provider-approved sandbox account/key and verification of this exact Solana/USDC route. That test must establish actual response compatibility and account access; local fixtures cannot. Card integration is a separate product setup, and this general transfer adapter does not issue or fund cards. Later work must bind real mandate units, verified merchants, invoice/fees, an external constrained signer and authenticated settlement before enabling purchases.

Official sources checked October 15, 2026: [sandbox environment and limits](https://apidocs.bridge.xyz/get-started/introduction/quick-start/setting-up-sandbox), [create transfer](https://apidocs.bridge.xyz/api-reference/transfers/create-a-transfer), [get transfer](https://apidocs.bridge.xyz/api-reference/transfers/get-a-transfer), [card sandbox setup](https://apidocs.bridge.xyz/platform/cards/sandbox/sandbox).
