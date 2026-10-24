# Ecosystem connection inventory

This inventory describes implemented interfaces and remaining integration work in the current draft stack. It is not a claim that the ecosystem is deployed or complete. Code and evidence remain inside the existing BuildWithAAI repository; pinned component checkouts are branches of that same repository. The draft stack has not been merged.

| Connection | What is implemented and exercised | Remaining work before the complete live ecosystem |
| --- | --- | --- |
| Solana source history → research data | Real finalized RPC capture, retained bytes, decoding, chronological preparation and independent replay | Representative history, broader decoder coverage, calibration and qualified decisions; a single RPC assertion is not independent chain attestation |
| Scanner → community agent | [Actual scanner HTTP/TLS intake](SCANNER_FEED.md), retained response bodies, source/freshness gates, bounded durable collection and a separate authenticated observation job beside the four shared models | A qualified scanner-to-model feature adapter, independent upstream receipts, exhaustive forensics, representative training outcomes and an installed continuous supervisor remain unfinished |
| FlyVis → readout research | Actual pinned CPU inference and native feature reexecution; bounded synthetic readout fitting | No established neural advantage or qualified market signal; additional animal-brain runtimes and a validated fusion interface are missing |
| Specialist models → learned memory | Four bounded pattern learners, historical retention, verified experience admission and contradiction suppression | Broader independent task corpora and qualified continuous learning beyond the fixed registry |
| Shared memory → controlled execution | Local ownership, fencing, atomic checkpoints and explicit process-crash recovery | Earlier overlapping-builder root cause remains unresolved; distributed ownership and arbitrary unattended service concurrency remain unqualified |
| Learned models → community agents | New implemented project-scoped HTTP artifact endpoint, real authenticated jobs, actual model bytes and receiver-side guarded inference | Public/physical-host commissioning, certificate/hostname configuration and real operator credentials |
| Community → two separate agent processes | Real Waitress/SQLite, signed enrollment, instance/agent pins, project permissions, private job records and successful-job replay after restart | Two physical computers, operational credential lifecycle and interruption/lease recovery commissioning; tests use disposable unfunded identities |
| Agent state → observer | Implemented network read command returning an allowlisted JSON projection | Hosted visualization/civilization world, streaming UI and assistant installation are not delivered by a JSON endpoint |
| Jarvis/local language-model agents | Existing community runner code and distinct model-provider interfaces exist in the pinned project | No real local language-model server is commissioned or connected to this model-distribution stage; missing providers fail rather than receive a fake reply |
| Agent commerce → payment providers | Separate community authority, routing and sandbox/reconciliation components exist | No real-value provider settlement is connected or qualified by this stack |
| Agent → Solana trade execution | Research signal remains ABSTAIN with execution disabled | Implemented/authorized quote, signing, submission, reconciliation and funded-wallet commissioning must precede real trading; a simulated fill is not a live connector |
| AAI token → access/rewards | Separate community and utility proposals | No real burn/lock, holder reward or economic-volume flywheel is implemented by these research/network stages |
| Economy → Zoora native chain | Separate chain direction and simulator work | No native consensus/ledger connection is added here; AAI on Solana does not become Zoora genesis currency |
| Scanner → Telegram | A separate scanner Telegram adapter exists in its pinned component | This supervisor does not install/configure a bot or deliver messages; no outbound social messages are part of these tests |
| Discord, broker and other asset classes | No qualified connection is claimed in this stack | Real provider adapters, permissions, instrument rules and operational tests remain necessary |
| Agent businesses / ASE / civilization | Design and separate simulator work | A running business exchange, tokenized equities, real earnings and the visual world are not established by the current model API |

## Completion rule

An interface counts as implemented only when it has an executable path, actual supported protocol, bounded inputs, explicit permissions and an observed result. Missing configuration is an error or a blocked state. There is no automatic sample-data/model/provider fallback in the operational commands. Explicit test fixtures stay in test workflows and retain their research classification.

The operating mode must distinguish network transport from data freshness, model quality, financial authority and public deployment. A live HTTPS connection can carry a replayed synthetic research model; it does not establish a live market model or permission to spend.

Automated checks run during development to catch broken interfaces before the stack grows. Final physical-computer commissioning remains a later stage and has not occurred. It must verify the actual chosen hosts, certificates, identities, local models, network paths, shutdown/restart behavior and every separately authorized external action. Finishing one connection never marks unrelated connections complete.
