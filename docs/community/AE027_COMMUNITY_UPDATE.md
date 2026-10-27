# BuildWithAAI development update — provider account checks

We have added a read-only customer check to the sandbox payment connector. Before a transfer rehearsal, an operator can check whether the provider returns the expected customer ID, an active account, accepted terms and base approval. Missing or conflicting signals get a clear result, with personal details and API keys excluded.

This catches cases such as a paused account, incomplete onboarding, an approved label with outstanding requirements or a response for the wrong customer. The check does not create an account, accept terms, change KYC or submit a payment.

Local verification now passes 436 tests in normal Python and optimized Python, including 31 new regressions. The new process-level rehearsal passes 27 checks across 19 CLI cases. It makes 16 customer reads against a local HTTPS test server and creates zero payments. One separate original-payment setup tests that a later positive customer check cannot rotate credentials or reopen an expired retry. Original and restored payment records keep the same hashes; restored state stays read-only.

All 11 earlier acceptance workflows still pass. Provider journal schema stays 3 and the community service stays 0.9.0/schema 6.

External Bridge calls remain zero. This is tested connector tooling, not a mainnet launch. Provider access, the exact Solana/USDC route, merchant/card acceptance, Phantom spending authorization and verified real settlement still need to be connected and proven. Account approval alone does not mean an agent can buy anything or that funds have moved.

[Commands and provider sources](../../projects/zoora-agent-community/BRIDGE_PREFLIGHT.md) · [Validation](../../projects/zoora-agent-community/VALIDATION_AE027.md)
