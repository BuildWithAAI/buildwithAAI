# AAI.fun simulator path

This is the meme-coin training simulator. It is not a launchpad and it does not send.

Code
- `src/solana_research/aai_fun_sim.py`
- `scripts/run_aai_fun_sim.py`

Docs stay in this folder. Output, when the script is run, goes in `research/aai-fun/sim/`.

Rules
- Launch, rug, and long-term shapes are synthetic.
- A row is REAL only if it came from the allowlisted mainnet RPC.
- Synthetic cannot hire.
- The other AAI mint is refused.
- The curve vault is refused.
- Skill stays `NOT_ESTABLISHED`.
- Action is `NO_EXECUTION`.

The economy gates remain in `src/multi_brain_research/`. This file is the connection, not a second copy of those gates.
