# Real connection setup

October 17, 2026. This command performs real external reads with no sample-data fallback. It is separate from the sandbox payment executor. A successful connection proves only the explicitly observed read; it does not enable payment writes or certify a production launch.

From this project directory, use Python 3.12+ and the existing runtime hash lock:

```sh
python -m pip install --require-hashes --only-binary=:all: -r requirements.lock
python -m zoora_community.live_connections solana --network solana:mainnet --out mainnet-read.json
```

An optional **public** agent-wallet address adds a native SOL balance read:

```sh
python -m zoora_community.live_connections solana --network solana:mainnet --wallet YOUR_PUBLIC_ADDRESS --out wallet-read.json
```

The read checks the expected cluster genesis hash, a finalized slot, and, when requested, the balance context slot and exact integer lamports. It refuses a regressing balance slot. This is provider-reported evidence from one RPC, not a validator proof, verified wallet control, token inventory, payment receipt or profit/loss. AAI and USDC balances are not included. No wallet seed, private key, signing authority or transaction submission is accepted.

## Exact AAI membership receipt read

The new `solana-payment` command checks one submitted Mainnet signature against the exact quote values supplied by the caller. It reads `getTransaction` at finalized commitment and requires the expected mint, raw base-unit amount, decimals, payer signer/authority, treasury token-account owner, quote time window, unique order memo and matching pre/post token-account deltas. It only accepts a single classic SPL Token transfer. It refuses Token-2022 transfer-fee instructions, unknown or ambiguous transfer shapes, missing balance records and mismatched quote data.

The command accepts no private key or signer and cannot submit a transaction:

```sh
python -m zoora_community.live_connections solana-payment \
  --signature SUBMITTED_TRANSACTION_SIGNATURE \
  --payer PAYER_PUBLIC_WALLET \
  --recipient APPROVED_TREASURY_OWNER_WALLET \
  --mint OFFICIAL_AAI_MINT \
  --amount-raw QUOTED_INTEGER_BASE_UNITS \
  --decimals VERIFIED_MINT_DECIMALS \
  --memo ZOORA-MEMBER-0123456789abcdef0123456789abcdef \
  --quote-created-at UNIX_SECONDS \
  --quote-expires-at UNIX_SECONDS \
  --out private-payment-report.json
```

These values must come from a stored one-use quote. The repository has no verified AAI mint, treasury, price or order store, so do not substitute a ticker, sample address or guessed amount. `PAYMENT_VERIFIED` records a provider-reported receipt only; there is no membership issuance, refund, burn, LP deposit or automatic fulfillment. The checker does not prevent replay by itself: a production application must atomically bind unique transaction signatures and quote memos to durable orders.

More detail and the remaining gates are in [AAI payment integration](AAI_PAYMENT_INTEGRATION.md). The [membership-pass proposal](../../docs/AAI_MEMBERSHIP_PASS.md) describes burn and LP accounting; no split is configured.

The default Mainnet host is `api.mainnet.solana.com`, as listed in the current Solana documentation. Public endpoints have variable rate limits and are not the final production-hosting choice. No arbitrary RPC URL, redirects, proxy override, or model-selected method is accepted by this command. A separately reviewed dedicated-provider adapter is still needed for sustained public operation.

## Production provider account

Use an approved Bridge account and its exact customer UUID. Store the API key in a private regular file outside the repository using the host's secret-management procedure. Do not paste it into chat, a command argument, a model prompt or community evidence. POSIX files must be owned by the current user and have no group/other permissions; Windows ACL protection still needs verification on the actual host.

```sh
python -m zoora_community.live_connections bridge --environment production --customer-id YOUR_CUSTOMER_UUID --key-file /private/path/bridge.key --out bridge-account-read.json
```

`production` calls only `GET https://api.bridge.xyz/v0/customers/{customerID}`. `sandbox` explicitly selects the separate vendor sandbox and requires a sandbox key; a sandbox key is refused on production. Production key validation only checks bounded safe header syntax and excludes the known sandbox prefix; it does not establish that the key is genuine. Only an accepted external response can establish a successful account read.

The projection retains bounded status/terms/base-endorsement signals, contradictions and missingness. Personal names, email, document details, raw provider messages and key bytes are omitted. The private report still includes the customer ID and a domain-separated key fingerprint. Do not publish it without review. API keys may possess broader provider rights; this read-only CLI does not narrow the credential's privileges at Bridge.

An active customer with clear base requirements is still not evidence of Solana/USDC route entitlement, merchant acceptance, cards, available funds, externally paid fees, settlement, delivery or revenue. Those are separate unfinished integrations.

## Outcomes and evidence

| Report state | Exit | Meaning |
| --- | ---: | --- |
| `READ_VERIFIED` | 0 | Requested read passed response and binding checks. For Bridge, required onboarding signals were also observed. |
| `READ_VERIFIED_ACCOUNT_NOT_READY` | 2 | Real customer read succeeded, but signals were incomplete, blocked or contradictory. |
| `BLOCKED` | 2 | No accepted result. Inspect the redacted error; observation remains null. |
| JSON error on stderr | 1 | Local setup/output failure. No successful report is claimed. |

`--out` is required, private and exclusive: an existing file is refused **before** reading a secret or making a request. Reports contain start/end timestamps, elapsed time, runtime-source digest, exact target environment and response hashes on successful reads. This digest covers package Python files and the runtime dependency lock, not the OS, interpreter or an authenticated release signature. A response hash is a byte identifier, not independent proof of what a vendor sent. The CLI retains projected data, not raw customer payloads. A terminated process may leave a partial file; incomplete/non-JSON output is never success.

DNS, TLS, HTTP status, network timeout, schema, cluster and balance errors fail closed. No exception is substituted with an example account or sample balance. Each request has a three-second socket timeout and a ten-second application read budget; OS DNS resolution and a detached HTTP/1.0 response can exceed the exact application deadline. Use a host process supervisor for a strict wall-clock cap. There is no automatic retry, scheduler or continuous monitor.

These checks do not consume or modify the community, commerce, queue or provider journal. They are not called by a model and cannot grant new tool or payment permissions. `live_launch_ready`, wallet execution and payment writes remain false/zero even after a successful read.

## Checked official references

Checked October 17, 2026:

- [Bridge authentication](https://apidocs.bridge.xyz/api-reference/introduction/introduction)
- [Bridge exact customer GET](https://apidocs.bridge.xyz/api-reference/customers/get-a-single-customer-object)
- [Bridge vendor sandbox](https://apidocs.bridge.xyz/get-started/introduction/quick-start/setting-up-sandbox)
- [Solana clusters and public RPC endpoints](https://solana.com/docs/references/clusters)
- [Genesis hash](https://solana.com/docs/rpc/http/getgenesishash), [slot](https://solana.com/docs/rpc/http/getslot), [native balance](https://solana.com/docs/rpc/http/getbalance)

See the [current audit](LIVE_CONNECTION_AUDIT_20261017.md). The [AAI membership pass](../../docs/AAI_MEMBERSHIP_PASS.md) is a proposed access feature, not an issued collection or verified AAI payment gate.
