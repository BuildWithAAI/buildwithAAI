# Host capture plan

Status: steps and bounds. No send. No signer. No order.

Token: `27RP3fkHt6T2QpCzsrJjk9oMZXAP5cya77VaR3UMpump`  
Curve: `Eq93BkkDVBLkjgHxZU6qVk7hrnzTnAyVfCNrXCVix1PL`  
This is Anything AI. Do not capture `4YfDqz…pump`.

## Bounds

- Read-only HTTPS RPC. Methods: `getAccountInfo`, `getSignaturesForAddress`, `getTransaction`.
- Commitment: `finalized`.
- One mint per run. Response cap 256 KiB. Total raw cap 8 MiB.
- A missing field is omitted. It is not stored as zero.
- No private key on the host that runs this. No `sendTransaction`.
- Dead coins are required. A set of only live winners is refused.

## Dead coin

A coin is dead for this capture if either:

- It graduated, then 24-hour volume is under $100 and the pool has not moved in 7 days, or
- It never graduated and the curve has had no buy in 7 days.

Record the reason. Do not invent a death.

## Steps

1. On the host, set `RPC_URL` to an HTTPS endpoint you control or a public one. Do not put a key in the URL.
2. Read the Anything AI curve account. Save mint, curve, slot, and the raw account. If the account is missing, stop.
3. Pull finalized signatures for that curve, newest first, cap 1,000.
4. For each signature, fetch the transaction. Keep it only if it has mint, curve, virtual reserves, real reserves, fee, slot, and signature.
5. Decode with `curve_decoder.py`. A row that fails the required fields is omitted.
6. Repeat steps 3 to 5 for at least 20 other mints, of which at least 5 are dead by the rule above.
7. Write one JSONL file per mint. Name it by the mint, not by a nickname.
8. Run `cohort_binder.py` on the directory. It must refuse the set if a dead coin is missing or the set is too small.
9. Do not send, sign, or add liquidity from this host.

## What this does not do

- It does not graduate the coin.
- It does not clean the chart.
- It does not prove market skill.
- It does not replace a later live tape. This is the first bounded capture.
