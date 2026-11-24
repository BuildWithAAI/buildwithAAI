# Daily forex scan — Fri Nov 6, 2026 (~7:14 AM America/Chicago)
Analysis only. No MT5 orders. Public data: yfinance AUDUSD=X + GC=F (gold proxy), cross-checked with FXStreet/Exa quotes. Zoora rules from `/workspace/aai-forex` (research-finalized; docs say not robust for live).

## Headline
**0 clean setups** into US NFP (~7:30 AM America/Chicago / 13:30 GMT). Zoora: **no triggers** on AUDUSD or XAUUSD (D1/H4). Gold sensible stops remain far too large for a $100 / 0.01-lot account.

## Calendar (high-impact today)
- **USD Non-Farm Payrolls** 7:30 AM America/Chicago — consensus ~65K (prev 29K); with Unemployment 4.2% and AHE m/m 0.3% cons
- **CAD Employment / Unemployment** same print window
- **USD FOMC speakers**: Williams (already ~3:30 AM), Musalem ~8:10 AM, Bowman ~11:15 AM America/Chicago
- **USD Prelim UoM Consumer Sentiment** ~9:00 AM America/Chicago
- No RBA decision today (cash-rate hike + Bullock “pause options” already this week). AUD foreign reserves overnight was low-impact.

## AUDUSD+ (~0.6875)
Cross-check spot ~0.6874. Today (Chicago H1 agg): O 0.6887 / H 0.6892 / L 0.6865 / C 0.6875. Session low near **0.6862** (fresh multi-month low per FXStreet).

| TF | Bias | Close | EMA200 | EMA800 | EMA198 | EMA792 | ATR14 |
|----|------|-------|--------|--------|--------|--------|-------|
| D1 | mixed | 0.6875 | 0.6985 (below) | 0.6793 (above) | 0.6986 (below) | 0.6793 (above) | ~57 pips |
| H4 | bearish | 0.6875 | 0.7013 (below) | 0.7027 (below) | 0.7013 (below) | 0.7027 (below) | ~22 pips |

Zoora regime: D1 **+1** (price & EMA200 still above EMA800; no turn). H4 **−1** (no turn). No pullback-band tag, no 200/800 or 198/792 cross on either TF → **no Zoora entry**.

Key S/R: support **0.6862 / 0.6833 / 0.6828 / 0.6800**; resistance **0.6900–0.6913 / 0.6950 / 0.6970 (9-EMA) / 0.7000**.

## XAUUSD+ (GC=F ~4068.8; spot quotes ~4058–4064)
Basis: futures proxy vs spot — treat levels as approximate until Bybit MT5 tick confirmed. Today: O 4050.7 / H 4090.7 / L 4047.5 / C 4068.8.

| TF | Bias | Close | EMA200 | EMA800 | EMA198 | EMA792 | ATR14 |
|----|------|-------|--------|--------|--------|--------|-------|
| D1 | mixed | 4068.8 | 4281 (below) | 3484 (above) | 4283 (below) | 3493 (above) | ~$86 |
| H4 | bearish | 4068.8 | 4131 (below) | 4290 (below) | 4130 (below) | 4289 (below) | ~$37 |

Zoora: D1 regime **+1** (no turn); H4 **−1** (no turn). No pullback/cross → **no Zoora entry**.

Key S/R: support **4050 / 4035–4039 / 4022 / 4006 / 3973**; resistance **4080 / 4090–4100 / 4146–4157**.

## Risk note ($100 account, 0.01 lots)
- AUDUSD ≈ $0.10/pip → 1–3% = **10–30 pips** stop budget
- XAUUSD ≈ $1 per $1 → 1–3% = **$1–3** stop — any ATR-based gold stop (H4 ATR ~$37) is **~37%+ of account at 0.01 lots** → skip / flag oversized

## Setups
**None.** Reasons: NFP in minutes; Zoora silent; H4 bearish but chasing lows into payrolls is poor R:R; gold cannot be sized to 1–3% at 0.01 lots with a sensible stop.

Post-NFP watch only (not entries now): AUDUSD reject of 0.6900–0.6915 for shorts toward 0.6833 if H4 stays below EMAs; gold only if balance grows enough to absorb ≥$10–15 risk or lot size can drop below 0.01 (Bybit min still assumed 0.01).

