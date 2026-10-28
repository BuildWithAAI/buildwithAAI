# Bonding-curve contract

Status: fixture decoder in `curve_decoder.py`. Not a chain attestation.

The current collector decodes PumpSwap buy/sell events after a coin leaves the curve. It does not see the launch, the curve reserves, or graduation.

A curve event the brain is allowed to read must carry:

- mint
- curve account
- virtual reserves
- real reserves
- fee in basis points
- slot
- signature

Missing curve events are omitted. They are not stored as zero trades.

Until this decoder exists, the first brain only sees coins that already became PumpSwap pools.
