# AAI development update — capacity before payment

We have implemented the next economy simulation layer inside the existing BuildWithAAI repository. The previous study showed that a queue could accept a client's payment and still have no time or capacity to start the work. The new study tests an explicit permission step before the simulated client pays.

The permission binds the client, provider, agreement, amount and deadlines. It can be used once. Three policies compare no capacity hold, holding only through the send window, and holding through the evidence window. Tokens are offline fixtures, not production wallet signatures.

We ran **240 new matched configurations** and retained all 240 full journals. An independent audit reconstructed 128,765 permits, 678,455 authorization events and 123,593 synthetic transfer facts. These are separate seeded research replicas, not real economic activity or autonomous AI performance results.

Under paid spam, the policy without a capacity hold left **1,462 paid ordinary requests without a start** across ten seeds. Holding through the evidence window left **zero** in that scenario by refusing overloaded requests before payment. The held policy accepted 2,868 of 4,320 intended ordinary requests; it did not serve everyone. Under delayed evidence inside the promised window, unstarted paid requests fall from 155 to zero.

The tradeoffs remain visible. Attackers who repeatedly request reservations without paying reduce ordinary throughput. Paying attackers can still occupy slots. Providers can fail after work starts. Evidence arriving outside the promised window leaves **1,440 paid requests without a start** even under the full hold. Expiry cannot undo a transfer or create a refund.

The local normal and optimized Rust suites each pass **155 tests**, including 17 new authorization tests. CLI checks cover replay, input mutation, corruption, checkpoint recovery and false evidence. Published-source Linux/Windows CI, browser checks and artifact verification are pinned in the development PR on [the AE-014 branch](https://github.com/BuildWithAAI/buildwithAAI/tree/feature/ae-014-capacity-authorization). The offline interactive report and full data preserve both improvements and failures.

This milestone uses **SYNTHETIC / SIMULATED_UNITS** and zero fees. It does not activate live AAI payments, burns, locks, liquidity deposits or customer-fund custody. Existing fee experiments remain available. Real signed authorization, independent useful-work verification, reservation-spam controls, production operations and iPhone/Safari acceptance remain unfinished.

The next reinforcement is controlling repeated unpaid reservations without hiding refused clients or weakening payment protection. We will need to test quota/fairness rules and incentives alongside provider accountability. [Method and runnable commands](../../projects/zoora-agent-economy-simulator/review/AE014.md) · [Complete results and limitations](../../projects/zoora-agent-economy-simulator/review/VALIDATION_AE014.md).
