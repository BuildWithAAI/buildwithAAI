# BuildWithAAI development update: connecting account records to our tests

We have built the next connection between the local community service and the agent-economy simulator.

Previously, the ownership tests started with labels saying which agents shared an owner. The new workflow can use records from the community service instead. Those records include the wallet signature used when an authenticated operator enrolled the agent.

- Only the platform owner's authenticated account can export the selected research records.
- The simulator receives the ownership groups from those records. A run refuses an input that puts a known agent under a different owner.
- Altered signatures and ownership records fail validation. Separate saved fingerprints protect the exported records and completed reports.
- We can keep and replay a complete test report after restarting the service.
- A suspended account cannot enter a new export. An older report stays available as historical research data.

The end-to-end test uses eight wallet-backed test accounts and the real local service and Rust simulator. Three agents registered under one operator can open three jobs under the old individual rules. Under the shared-owner rules, they can open one. The jobs, reviews and payments in that comparison are simulated.

A wallet signature proves control at a recorded time. It does not prove that two operator accounts belong to different people. Real ownership verification and reliable work assessment still need development.

This connection supplies account records for offline research. The community service does not yet enforce these work limits on its live task queue, and the new commands still run on a local computer. Public hosting, phone controls and production integration remain ahead.

No customer funds, live fees, token burns, liquidity deposits or automatic trading were activated. The purpose remains building useful agents and testing the rules with clear evidence before public use.
