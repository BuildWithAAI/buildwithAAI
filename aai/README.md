# AAI unified pipeline (`/workspace/aai`)

Read-only market/on-chain data + **paper trading only**. There is no live-execution code; `place_order`-style
commands return 403. No exchange API keys, no wallet private keys.

```bash
.venv/bin/aai healthcheck            # one pass/fail JSON for store, audit chain, risk config, longterm ring-fence, adapters
.venv/bin/aai hud --port 57025       # Zoora voice HUD on 127.0.0.1 only; AAI_HUD_TOKEN (or /home/box/.config/aai/hud_token) required by scripts/hud_restart.sh
.venv/bin/aai score <MINT>           # runs /workspace/solana-meme-risk, stores the signal
.venv/bin/aai ingest-perps BTC-USDT  # Blofin public instruments/ticker/funding/candles -> store
.venv/bin/aai submit '{"sector":"perps","venue":"blofin","symbol":"BTC-USDT","side":"long","entry":78000,"stop":76500,"target":81000}'
.venv/bin/aai kill "reason" | aai resume --confirm RESUME "reason" | aai risk | aai audit --verify
.venv/bin/aai lt-seed | aai lt-summary | aai ingest-report <report.json>
.venv/bin/python -m pytest -q        # add -m "not network" to skip the live Blofin test
```

Layout: `aai/store.py` (single SQLite/WAL store, schemas), `aai/audit.py` (append-only, SHA-256 hash-chained log),
`aai/risk.py` (pre-trade checks + sizing), `aai/ledger.py` (paper OMS, circuit breakers), `aai/longterm.py`
(separate long-term bucket, LT-01..LT-10 guards, draft tickets only), `aai/reports.py` (agent report JSON Schema),
`aai/adapters/` (solana-meme-risk via subprocess, Blofin public REST, Billy read-only, placeholders),
`aai/backtest.py` (metrics + walk-forward splitter), `aai/hud.py`, `aai/cli.py`, `config/default.toml`.

Endpoints: GET `/api/health /api/score /api/ideas /api/positions /api/risk /api/longterm /api/reports /api/audit_log`,
GET `/api/audit` (501 until trader_audit is available), POST `/api/command`
(`kill|resume|submit_idea|mark|close|scan_perps|lt_draft|lt_confirm|lt_done|ingest_report|audit_verify`).

## Zoora voice HUD
`http://127.0.0.1:57025/` (also `/zoora`; the old HUD is at `/classic`). It is a live view of risk, positions, ideas, pipelines, meme-risk,
security intel, the long-term bucket, data freshness and the audit chain. Everything shown is read from the store and the sibling
pipelines, and anything not built is labelled NOT BUILT or UNVERIFIED.

- **Voice:** push-to-talk (mic button or hold Space), an optional "Hey Zoora" wake word, and spoken replies with captions. There is also a typed fallback. It uses the browser Web Speech API,
  so it needs Chrome or Edge on your own device in a secure context (localhost counts).
- **Intents** (`POST /api/zoora {"text": ...}`): status, risk, positions, ideas [+ sector], blockers, security, 2040/long-term,
  `score <mint>` (async job), `run healthcheck` (async job), help, and `paper long|short SYMBOL at X stop Y target Z` (goes through the
  risk engine; ideas more than 10% from the last quote are rejected). Real trades, kill/resume/lt_confirm, limit changes and key requests are
  refused with 403 and audited. Voice and LLM text never change state. Free-form questions use an LLM only if `XAI_API_KEY` or
  `OPENAI_API_KEY` is set.
- **Auth:** set `AAI_HUD_TOKEN` and send it as `X-AAI-Token`, as a Bearer token, or once via `/zoora/login`, which sets an HttpOnly cookie.
  If the variable is unset, `scripts/hud_restart.sh` loads it from `/home/box/.config/aai/hud_token` (mode 0600, outside git; the value is never logged). The restart script refuses to start the HUD unlocked. Kill, resume, RUN AUDIT and the other state-changing routes require the token.
- **Host allowlist:** only `127.0.0.1`, `localhost`, `127.0.0.1:57025` and `localhost:57025` are accepted; any other `Host` header is 403 (DNS-rebinding defence).
  POSTs must be JSON with a matching Origin. The CSP is `script-src 'self'`.
- **Untrusted text:** all external and agent text is sanitised with agent-guard (`safe_field`), and LLM context is wrapped with `wrap_untrusted`.
- **Self-improvement:** see `IMPROVEMENTS.md` (backlog and changelog) and `aai improve-lock acquire|release|status`.
- **Ops:** `scripts/hud_restart.sh` (loads the token file, drops Telegram/LUMEN bot tokens from the HUD env, records the PID in `data/hud.json`). `scripts/zoora_shot.sh W H OUT '?noboot'` takes headless screenshots (through a single-use `aai hud-ticket` login URL when the HUD is locked), saved in
  `docs/screenshots/`.

## Set up Zoora voice on your PC
Zoora voice is push-to-talk "ask anything" on the HUD orb: hold the orb (or **Space**) and speak, release to send. Your clip goes
to speech-to-text, then to the LLM (its **only** tool is web search), and the answer comes back in a holographic pop-up with its
sources and is spoken aloud. There is also a typed **Ask Zoora anything** box. Voice can never trade, spend, write the ledger or
edit Zoora's world: `/api/voice/*` hold no reference to the store, ledger, audit log or command routes, and only status words,
alarm titles and routine names are sent as context (never balances, equity, PnL, positions, tokens, keys or wallet data).
The mic opens only while you hold, with a hard 60 s cap and a visible countdown; nothing is stored.

1. Install the voice deps into the Python that runs the HUD: `pip install -r aai/voice/requirements.txt`
   (httpx and keyring). Without them the HUD still boots and voice reports **VOICE UNAVAILABLE**.
2. Put your keys in the OS keyring (Windows Credential Manager), service `zoora-voice`. Each slot is bound to one host:
   ```powershell
   py -m keyring set zoora-voice xai-key      # required: xAI LLM + speech-to-text + text-to-speech (api.x.ai only)
   py -m keyring set zoora-voice brave-key    # optional: web search with sources (api.search.brave.com only)
   # alternatives: tavily-key (search via Tavily), openai-key (OpenAI STT/TTS), llm-key / stt-key / tts-key (custom hosts)
   ```
   Keys are read from the keyring on each call. There is no env var or file fallback, and they never appear in logs or errors.
3. Restart the HUD (`scripts/hud_restart.sh`; voice requires `AAI_HUD_TOKEN` and never runs unlocked) and open
   `http://127.0.0.1:57025/`. The chip under the orb says **ZOORA VOICE · READY**; until then it says
   **VOICE KEYS NOT SET UP** and tapping the orb shows which slots are missing (by name only).
4. Test it: `GET /api/voice/status` (with `X-AAI-Token`) lists the configured slots. Type a question into **Ask Zoora anything**,
   then hold the orb and ask out loud. Tests: `pytest -q tests/test_hud_voice.py tests/voice` (and
   `tests/test_zoora_voice_ui.py` with Playwright + Chrome for the browser checks).

Endpoints (localhost only; HUD token as `X-AAI-Token` or the HUD's HttpOnly session cookie): `GET /api/voice/status`,
`POST /api/voice/transcribe?duration_s=<0-60>` (raw `audio/*` body, max 10 MB), `POST /api/voice/ask {"text"}` returning
`{answer, sources, speak_text}`, `POST /api/voice/speak {"text"}` returning audio. Missing keys return 503 `{"state": "keys_missing"}`.
Provider choice: optional `[voice] stt / tts = "xai"|"openai"`, `search = "brave"|"tavily"|"none"` in the config.

## OnePay Roth: user-executed, audit-only
Zoorped buys everything in the OnePay Roth himself. `lt_account_policies` records owner=user, executor=user,
agent_role=auditor, ticketing=disabled. No agent can create an order ticket for it: `longterm.draft_ticket` raises
`TicketingDisabled` (HUD returns 403), and SQLite triggers reject INSERTs, account moves, and status flips on its tickets,
and lock the policy row. It produces only audit reports (`aai lt-audit onepay_roth`, `GET /api/longterm/audit`):
holdings vs target weights, off-plan names, cap breaches, drift. Missing or unverified holdings -> `UNVERIFIED` with null
actuals, never invented. Robinhood and the other accounts are unchanged.
