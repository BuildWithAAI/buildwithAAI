# SFP research addition — validation record

Date: October 14, 2026. Base: `BuildWithAAI/buildwithAAI` main commit `7e4ae535ce3ba16cdf8544e9cb57533e4370e5de`.

Scope: [BT-004 research dossier](SWING_FAILURE_PATTERNS.md), an original synthetic SVG, [AAI-T-041](../tasks/BACKLOG.md#aai-t-041), and linked project/index/planning documents. This is documentation and research specification; no trading implementation is introduced.

Checks performed:

- Parsed the structured backlog: 41 unique sequential IDs, valid status vocabulary, existing dependencies and an acyclic dependency graph.
- Compared the first 40 task objects with the base commit: every existing object is unchanged. Only the snapshot date and appended research task change in the structured backlog.
- Matched all 41 task titles, status/commitment/priority, scopes, acceptance criteria and limits between Markdown and JSON.
- Verified all 41 IDs occur exactly once across the planning-board table, with each lane's count and status matching the structured backlog.
- Resolved relative links and heading anchors in changed Markdown; checked whitespace with `git diff --check`.
- Checked nine cited original/first-party sources. NBER's landing page returned an access error during one retrieval; the paper's identity and abstract claims were verified on the authors' MIT page. The dossier does not claim a complete literature search.
- Parsed the SVG and visually reviewed its rendered PNG. Each panel uses 14 synthetic bars; pivot 4 is confirmed after bar 6 and candidate 13 crosses/reclaims the specified level. No future outcome is displayed. The short illustration is not represented as a complete volatility/strategy fixture.
- Independently checked bullish/bearish illustration prices, strict pivot geometry and the hypothetical cost-adjusted break-even arithmetic.

The source descriptions support the limited definitions/mechanisms stated in the dossier. They do not establish the performance of these proposed SFP rules. The report keeps pattern observations, inferred stop activity, synthetic assumptions and future labels separate.

No historical performance replay, strategy unit suite, detector, data-provider benchmark or unseen forward experiment was run for this addition. Existing application/replay tests are not presented as SFP performance evidence. Runtime code, dependencies, workflows, wallet/account integration, trading policy, token behavior and financial operations are unchanged.

Remaining work includes verified market/quote history and reuse rights, exact benchmark/risk specifications, frozen numerical acceptance thresholds, detector fixtures after accepted implementation scope, costed replay and an unseen offline-forward study. Negative or underpowered results remain valid outcomes. See [the research task](../tasks/BACKLOG.md#aai-t-041).
