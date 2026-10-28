# BuildWithAAI — SOL/USD data receipt

Classification: **SYNTHETIC**. Transport: **LOCAL_FILE_IMPORT_NOT_WITNESSED**.

Retained 720 completed hourly observations from the declared Kraken spot SOL/USD market. Recorded gaps: 0. Local data screen: PASS_LOCAL_DATA_SCREEN_ONLY. The provider's final uncommitted row was excluded; other not-yet-available rows excluded: 0.

The capture binds the exact pair/OHLC responses and their request receipts. Local verification reconstructs the CSV/dataset and quality report; it does not independently witness TLS, clock integrity, provider truth or an unseen experiment. File imports have no witnessed transport.

This is SOL against USD on Kraken spot, not AAI or a Pump.fun pool. It has no AAI mint identity or executable quote history. Availability is reconstructed at hourly close plus the declared delay. Costs and execution remain simulation assumptions. Historical study outcomes are retrospective.

The documentation states a 720-entry limit; current public observations can contain 721 rows including the uncommitted final row. That single-row compatibility case is bounded and recorded as a provider-contract warning. The recent endpoint cannot supply the default three-fold study window. The engine does not silently shrink a frozen study. Choose and disclose a separate research plan explicitly, or supply longer suitable history.

Source format references: [Kraken OHLC](https://docs.kraken.com/api-reference/market-data/get-ohlc-data), [market identity](https://docs.kraken.com/api-reference/market-data/get-tradable-asset-pairs). The adapter uses assetVersion=1 to require the explicit SOL/USD display identity.

Capture checksum: 8021dfd6def9c1103f6eb2a0111c5d723d2b218ee909ebc9e6e09f0df4654664.

Funds transferred: 0. Tokens purchased: 0. Tokens burned: 0. Funded readiness remains blocked.
