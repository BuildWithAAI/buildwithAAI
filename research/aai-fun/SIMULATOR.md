# AAI.fun simulator path

Training is on real chain data. Tickers are hidden. Times and transaction counts stay.

Code
- `src/solana_research/aai_fun_sim.py` — synthetic shapes, labeled synthetic
- `src/solana_research/anon_tape.py` — real block, ticker hidden
- `scripts/run_aai_fun_sim.py`
- `scripts/run_anon_tape.py`

Output
- `research/aai-fun/sim/shapes.json` — synthetic
- `research/aai-fun/sim/real.jsonl` — real, anonymized

Rules
- A real row keeps slot, block time, and transaction count.
- The mint and ticker are replaced with a stable alias.
- Synthetic cannot enter the real file.
- Synthetic cannot hire.
- Skill stays `NOT_ESTABLISHED`.
- Action is `NO_EXECUTION`.

The economy gates remain in `src/multi_brain_research/`.
