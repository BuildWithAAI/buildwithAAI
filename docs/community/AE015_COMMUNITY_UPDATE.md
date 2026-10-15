# AAI development update — reservation abuse and client access

We have built the next economy simulation layer inside BuildWithAAI. The previous milestone reserved work capacity before payment. This milestone tests how unpaid reservations can be abused and what happens when we limit them.

Three rules now run against the same work engine: the existing evidence-window hold, one unpaid hold per declared wallet/provider pair, and that quota with a waiting period after an unused permission expires. The rules inspect permission history, not a fixture's attack label. They never seize funds, freeze a wallet or invent a refund.

We ran **270 configuration rows**: 240 main comparisons and 30 cases testing a longer cooldown. All 270 full journals are retained and independently audited. They include 141,150 permits and 699,393 rule decisions. These are separate synthetic replicas, not live transactions, independent AI workers or evidence of economic stability.

The results show both a benefit and a limit. Across ten seeds, the wallet quota improves acknowledgments under concentrated unpaid requests from **1,737 to 2,563**. When the attack rotates wallet IDs, the quota alone stays at **1,737**. Adding an eight-tick cooldown restores acknowledgments to **2,570** in that bounded rotating-wallet test. A wallet limit does not prove who controls the wallets.

Honest clients also pay a cost. Slow-payer acknowledgments fall from **2,501 to 2,379** under the quota rules. The eight-tick cooldown does not reduce the total further in this sample, even though it refuses honest requests. With a sixteen-tick cooldown, acknowledgments fall to **1,737**. Stricter restrictions are not automatically better.

The reports now show outcomes per declared ordinary wallet alongside total throughput and payment exposure. Under the modeled evidence window, paid requests remain startable. Evidence arriving after that window still leaves **1,440 paid requests without a start per policy**. Paying attackers and failed providers remain harmful. Starting or acknowledging scripted work does not independently establish useful output.

Both local Rust build modes pass **172 tests**, including 17 new reservation tests. The new CLI acceptance suite passes 38 checks. Previous campaign fingerprints and checks are retained. Published-source Linux/Windows CI, browser checks and artifact verification are pinned in the development PR on [the AE-015 branch](https://github.com/BuildWithAAI/buildwithAAI/tree/feature/ae-015-reservation-controls). The offline report, sensitivity data and all complete journals make the measured failures inspectable.

Everything here uses **SYNTHETIC / SIMULATED_UNITS** and zero fees. No real AAI payment, burn, lock, LP deposit or chain-policy activation is introduced. Signed permissions, adaptive-abuse defenses, real ownership evidence, useful-work verification, provider accountability and public operation remain unfinished. Actual iPhone/Safari acceptance is unverified.

The next reinforcement needs to improve access under adversarial demand without hiding refused clients or weakening payment protection. The study provides a baseline for testing that tradeoff. [Method and reproduction](../../projects/zoora-agent-economy-simulator/review/AE015.md) · [Complete results and boundaries](../../projects/zoora-agent-economy-simulator/review/VALIDATION_AE015.md).
