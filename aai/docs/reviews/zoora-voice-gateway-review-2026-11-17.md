# Zoora voice gateway — release-gate review (2026-11-17)

- Reviewer: Head of Systems & Trading Operations (HUD owner)
- Subject: local commit `e4972f0df49cdecb9362dfa807da922c3163c7c4`, branch `zoora-voice-gateway`, parent `1c62584` (= master HEAD = merge-base)
- Method: separate worktree `/workspace/rev-voice` (main checkout and its uncommitted edits untouched; worktree removed afterwards; branch left unmerged), throwaway venv `/tmp/voice-venv` (httpx 0.28.1, keyring 25.7.0, pytest 9.2.0, ruff 0.17.5, mypy 2.4.1, Python 3.13.5), 142 reviewer-written adversarial tests, a planted-bypass experiment, gitleaks 8.30.1, live doc checks.
- Artifacts: `docs/reviews/zoora-voice-gateway-2026-11-17-artifacts/test_adv.py` (run with `PYTHONPATH=<worktree> pytest test_adv.py -s`), `zz_plant.py` (deny-list bypass probe).

## Verdict: NO-GO to wire into the HUD — two small blockers

The runtime design is sound. I found no path from voice input, an LLM reply or web content to trading, spending, transfers, the signer, ledger writes, world edits, shell or file writes. Two of SE's safety claims are not true as written. Fix those two and I'll re-check the delta.

## Blockers

### B1. Deny-list scanner is bypassable, and the "planted-violation test" doesn't test it
`tests/voice/test_denylist.py:80-89` only bans direct `Name` calls (`__import__`, `eval`…) and a few attribute names. `tests/voice/test_denylist.py:92-102` only checks that `_imports()` collects import names; it never proves the dynamic-call scan fails. `aai/voice/allowlist.py:18,20,24,25` allowlists whole top-level packages (`logging`, `pathlib`, `typing`, `urllib`), which carry their own string-to-import, eval, fetch and write paths.

I planted `aai/voice/zz_plant.py` (imported from `__init__`) in a scratch copy. **All 34 deny-list tests still passed**, and executing the functions showed that:
- `__builtins__["__imp"+"ort__"]("subprocess")` → loads subprocess (dynamic import with strings);
- `getattr(...)("__import__")` chains are not flagged;
- `logging.config.dictConfig({... "()": "aai.ledger.PaperLedger"})` → **`aai.ledger` loaded** (string-based import of ledger code);
- `urllib.request.urlopen("file:///etc/hostname")` → arbitrary file read/any-scheme fetch;
- `pathlib.Path(...).write_text()` → arbitrary file write;
- `typing.get_type_hints` on a string annotation → eval.

Once wired in, voice runs inside the HUD process, where ledger/economy modules are already in `sys.modules`. That makes the fresh-interpreter runtime check (`test_runtime_import_loads_no_forbidden_module`) meaningless in production, so this static scan is the only tripwire against a future edit (including a self-improvement cycle).
**The shipped code contains none of these bypasses**, so this is a guard-strength blocker, not a live exploit.

Fix:
- narrow the allowlist to submodules (`urllib.parse` only; no `logging.config`; drop `typing` beyond `TYPE_CHECKING`/annotations or ban `get_type_hints`);
- ban the names `__builtins__`, `__import__`, `builtins`, `globals`, `vars`, `locals` and any `getattr`/`setattr` whose 2nd arg is not a plain identifier literal on an allowlisted object;
- ban `.urlopen`, `.dictConfig`, `.fileConfig`, `.listen`, `.get_type_hints`, `.write_text`, `.write_bytes`, `.open`, `.unlink`, `.rename` except at an explicit allowlisted call-site list (`gateway.py` `_Store` only);
- make the planted test write each bypass above into a temp module and assert the scanner **fails** on it.

### B2. A key with a non-ASCII character leaks in the exception repr
`aai/voice/keys.py:81-82` accepts any non-empty string. `aai/voice/net.py:60-82` only converts `httpx` errors. When a keyring value contains an interior non-ASCII character (e.g. a zero-width space or smart quote pasted from a web page; `.strip()` does not remove interior chars), httpx raises a raw `UnicodeEncodeError` whose `args`/`repr` contain the full header `Bearer <key>`.

Reproduced: `repr(e)` contains the key, and a HUD-style `log.error("voice failed: %r", e)` on any non-`aai.voice` logger (not scrubbed) writes the key to the log.

Fix:
- in `KeyringKeySource.get`, reject keys that aren't printable ASCII (`value.isascii() and value.isprintable()`), with a message naming only the key slot;
- in `Transport.request`, also catch `(ValueError, UnicodeError, TypeError)` around request building and raise `ProviderError(f"{provider} request could not be built")` `from None`;
- add a test with `"xai-\u200bXXXX…"`.

## Claims verified

| SE claim | Result |
|---|---|
| 19 new files, no existing file changed | ✅ `git diff --name-status master...zoora-voice-gateway`: 19 × `A`, all under `aai/voice/` and `tests/voice/`; master == merge-base 1c62584 |
| `from_keyring(token_verifier=constant_time_verifier(hud.hud_token))` | ✅ `hud.hud_token` is a function (`aai/hud.py:57`) returning `$AAI_HUD_TOKEN` or `""` |
| Every call rejected with no AAI_HUD_TOKEN | ✅ tested with the real `hud.hud_token` and env unset: `ask`/`transcribe`/`synthesize` all raise `UnauthorizedError`; also for expected `""`/`None` |
| Constant-time compare | ✅ `hmac.compare_digest` on UTF-8 bytes (`gateway.py:93-97`); length >512, non-str, empty and surrogate inputs → deny; a verifier exception → deny with no chained context; truthy non-`True` → deny; auth runs before any input or provider work (a 20 MB clip with a bad token never reaches STT) |
| Token never in logs/exceptions | ✅ caplog DEBUG over bad and good calls; error messages are fixed strings |
| xAI chat/STT/TTS + OpenAI fallback | ✅ defaults are xAI. The "fallback" is an explicit `stt="openai"`/`tts="openai"` choice; there is no automatic failover, so nothing silently goes to OpenAI |
| Brave or Tavily search | ✅ |
| Keys only from keyring `zoora-voice`, no env/file fallback | ✅ env vars `XAI_API_KEY`/`OPENAI_API_KEY`/etc. are ignored; null/fail backends, a fake `keyrings.alt.file` backend and a spoofed `keyring.backends.WindowsEvil` module are all refused; getter exceptions are suppressed (`from None`). ❌ See B2 |
| Error bodies never echoed | ✅ a 401 body reflecting the key isn't read (`net.py:69-71`); redirects aren't followed (a 302 to evil.example made one request only) |
| Deny-list: AST scan, fresh-interpreter check, planted test; web_search only tool | ⚠️ The runtime tool gate holds (below). ❌ The scanner is bypassable and the planted test doesn't exercise it (B1) |
| Mic never opened | ✅ no audio-capture imports; only accepts bytes |
| Nothing stored by default | ✅ no files are written with defaults; `store_*` needs an explicit `store_dir` (ValueError otherwise). ⚠️ See N5 (httpx INFO logs) |
| 10 MB / 60 s caps | ✅ bytes cap and `duration_s`/WAV-header/provider-duration checks. ⚠️ See N3 |
| 115 voice tests; ruff + mypy --strict clean | ✅ 115 passed; `mypy --strict aai/voice` clean. ⚠️ ruff 0.17.5 flags 1 `I001` (unsorted imports) in `tests/voice/test_keys.py:1` |
| Deps only in `aai/voice/requirements.txt` | ✅ pyproject untouched |
| Existing tests 346 / total 461 | ⚠️ I count **342 passed + 1 network-deselected = 343** existing (repo .venv; voice tests not collected) and **457 + 1 deselected** with deps. All pass, but SE's counts are off by 3–4 |

## Adversarial results (reviewer tests, 142/142 pass)

- **Tool-call injection.** These names never run anything and get "unknown tool" back:
  - `place_trade`, `WEB_SEARCH`, `"web_search "`, `" web_search"`, `"web_search\x00"`, `web_search;sell`, `functions.web_search`, `""`, `transfer`, `shell`, `write_file`, `signer.sign`, `world.edit`.

  Only `query` is used from web_search args; extra keys (`cmd`, `tool`, `url`) are ignored. Malformed or huge args are handled, and queries are capped at 300 chars. A flood of 50 calls × 10 turns → exactly 3 searches and 3 LLM calls, and the last call is offered no tools. Only `web_search` is ever offered, and no tools at all when search is off.
- **Search-result injection.**
  - A `</untrusted>`-spoofing result is neutralised: there's exactly one closing fence.
  - A follow-up `place_trade` request is refused.
  - The LLM never sees the HUD token or keys.
  - There are no action tools, so injected text has nothing to trigger.
- **Sources.** These are all dropped:
  - `javascript:` (any case or leading space), `data:`, `http:`, `file:`, `vbscript:`;
  - scheme-relative URLs, `https:/\evil`, `https:///nohost`, and URLs over 2048 chars.

  Only `https://` URLs with a host survive. Note: http is rejected too, which is stricter than "http(s)".
- **Provider garbage.** 21 malformed bodies × 3 content types × 7 providers raise only `VoiceError` subclasses (no KeyError/TypeError/AttributeError). Timeout, connect and protocol errors become `ProviderError`, and the response size cap works. `http://`, `file://` and host-less base URLs are refused at construction.
- **Model configurable.** ✅ `VoiceConfig.llm_model` and `llm_base_url`, plus `stt_model` and `tts_voice` for xAI.

## Endpoint check against current public docs (fetched 2026-11-17)

| Call | Code | Docs | Status |
|---|---|---|---|
| xAI STT | `POST https://api.x.ai/v1/stt`, multipart `model=grok-voice-transcribe-2.0`, `language`, `format=true`, `file` last | Same; response `{text, language, duration, words}` (docs.x.ai Speech to Text) | ✅ verified |
| xAI TTS | `POST https://api.x.ai/v1/tts` JSON `{text, voice_id:"eve", language}` → raw MP3 | Same; `language` required, `eve` default; JSON+base64 only with `with_timestamps` | ✅ verified |
| xAI chat | `POST https://api.x.ai/v1/chat/completions`, `model: grok-4.7`, `max_completion_tokens`, `tools`, `tool_choice:auto`, `parallel_tool_calls:false` | Fields exist. But Chat Completions is **legacy/deprecated**, and the grok-4.7 page lists "APIs: Responses API". Chat Completions drops reasoning between tool turns. `max_completion_tokens` caps visible tokens only; reasoning defaults to high | ⚠️ works per the legacy page; see N1 |
| OpenAI STT | `POST /v1/audio/transcriptions`, `model=gpt-transcribe`, `language=en`, `response_format=json` | `gpt-transcribe` is real and the recommended model, but its docs say **`languages` replaces `language` — "Don't send both"** | ❌ payload shape wrong for gpt-transcribe (N2) |
| OpenAI TTS | `POST /v1/audio/speech`, `gpt-4o-mini-tts`, voice `coral`, `mp3` | Valid, but **deprecated, shuts down 2027-01-06** (SE's comment is correct); the successor isn't usable on `/audio/speech` | ⚠️ fallback dies in ~7 weeks |
| Brave | `GET https://api.search.brave.com/res/v1/web/search`, `X-Subscription-Token`, `q/count/safesearch` | Matches the public API (not re-fetched) | ✅ |
| Tavily | `POST https://api.tavily.com/search`, Bearer, `query/max_results/include_answer/search_depth` | Same (docs.tavily.com) | ✅ verified |

Nothing was exercised against the real APIs: there are no keys on the box. A real-key smoke test on Zoorped's Windows PC is still required.

## Non-blocking notes

- **N1. Latency and timeouts.** grok-4.7 defaults to high reasoning. A non-streamed chat call can exceed the 30 s read timeout (`config.py:27`), and xAI's docs suggest much longer timeouts. There's also no overall deadline per `ask`: up to 3 LLM calls plus 3 searches, each with per-read timeouts, so a slow-drip server can hold a HUD thread. Fix: set a low reasoning effort, add a total wall-clock budget per call, and consider moving to `/v1/responses`.
- **N2. OpenAI fallback.**
  - Send `languages` instead of `language` for `gpt-transcribe` (`providers.py:263`).
  - The OpenAI STT and TTS models aren't configurable through `from_keyring` (`gateway.py:235,250`): `stt_model` is ignored.
  - `gpt-4o-mini-tts` is EOL 2027-01-06.
  - **Key-slot sharing.** xAI and OpenAI both use `stt-key`/`tts-key` (`providers.py:213,249,285,326`). Flipping `stt="openai"` without changing the stored key sends the xAI key to api.openai.com. Use per-provider slot names.
- **N3. Duration checks.**
  - `duration_s` accepts NaN, negative, -inf and `True` (`gateway.py:293`), and a NaN provider duration passes (`gateway.py:301`, `providers.py:234`). Require a finite value with `0 < d ≤ 60`.
  - For non-WAV clips (webm/opus is the browser default) with no `duration_s`, only the 10 MB cap applies before upload. That's many minutes of opus.
- **N4. Secrets in output.** If the model echoes a secret it saw (e.g. via HUD context), it comes back in `answer`/`speak_text` unscrubbed. I reproduced this with a fake LLM. Run `redact.scrub()` over `answer`, `speak_text` and source titles before returning.
- **N5. httpx logging.** httpx logs full request URLs at INFO. With Brave, that's `?q=<the user's question>`, so if the HUD ever logs at INFO, questions go to disk despite "nothing stored". Set `logging.getLogger("httpx").setLevel(logging.WARNING)` in `aai.voice`, or move Brave to POST/headers.
- **N6. TTS response check.** A `200 text/html` reply (e.g. a captive portal) is returned as "audio" (`providers.py:301-312`). Require `audio/*` or the JSON envelope.
- **N7. speak_text cleanup.** It strips a markdown link's URL but leaves `link(`, and stray `javascript:` text stays in the spoken text. Cosmetic.
- **N8. gitleaks.** `gitleaks git` on the commit and `gitleaks dir aai/voice` are clean. `tests/voice` has 2 `generic-api-key` hits, both fake fixtures (`tests/voice/test_redact.py:15`, `tests/voice/test_providers.py:22`). Add `# gitleaks:allow` or a `.gitleaksignore` so CI stays green.
- **N9. Privacy.** HUD `context` (≤4,000 chars) goes to xAI, and model-chosen queries go to Brave/Tavily. An injected page could steer the model to put context into a search query. That's low risk because only the search provider sees it, but keep balances and positions out of `context`.

## HUD-side wiring requirements (my side; recorded so I don't miss them)

1. Render `answer`, source titles and URLs with `textContent` only, never `innerHTML`. Sources come back raw and unescaped: I verified `https://e.example/"><img src=x onerror=…>` and `"><svg/onload=…` titles pass through verbatim.
2. Before setting `href`, re-parse each URL with `new URL()` and require `protocol === "https:"`. Open links with `rel="noopener noreferrer"`, and never autolink URLs inside `answer`.
3. Never pass the HUD token, keys, balances, positions or ledger data in `context`.
4. Enforce a ≤60 s push-to-talk timer in the client and always pass `duration_s`.
5. Read the token from the `X-AAI-Token` header server-side, and return a generic 401 that never echoes it.
6. Keep voice routes read-only (POST transcribe/ask/synthesize only). They must not import or call anything except `aai.voice`.

## Tests run

- `pytest tests/voice -q` (throwaway venv with deps) → **115 passed**
- `pytest -q -m "not network"` (worktree, venv with deps) → **457 passed, 1 deselected**
- `/workspace/aai/.venv` (no httpx/keyring), worktree → **342 passed, 1 deselected**; voice is not collected
- `mypy --strict aai/voice` → clean. `ruff check aai/voice tests/voice` → 1 I001 (`tests/voice/test_keys.py:1`)
- Reviewer adversarial suite `test_adv.py` → **142 passed**. Its notable printed findings feed B2, N3, N4, N6 and N7.
- Planted-bypass probe → 34/34 deny-list tests still pass with 6 bypasses present (B1)
- gitleaks 8.30.1: commit range and `aai/voice` clean; `tests/voice` has 2 fixture false positives

## Re-review ask

Send the new SHA with B1 and B2 fixed (plus any N items taken). I'll rerun the planted-bypass probe (it must now fail), the adversarial suite and the full test suite.

## Post-review note

While this review ran, master advanced from `1c62584` to `23c95b6`, committed at 6:31 PM CT by the self-improvement cycle. The two new commits are `89698fb` (the snapshot overdue alarm) and `23c95b6` (IMPROVEMENTS). They touch `aai/snapshots.py`, `aai/zoora.py`, `IMPROVEMENTS.md`, a new test and `tests/test_guard_audit_run_button.py`, and none of them touch `aai/voice` or `tests/voice`. The voice branch still adds exactly 19 files with no overlap. Rebase it onto the current master and rerun the full suite before the delta review.

My review never touched the main checkout.

---

# Re-review: `24b36d3634e28421fad1a397c7e590cf33d9069d` (2026-11-17, ~7:15 PM CT)

- Branch `zoora-voice-gateway`, parent `23c95b6` (= master head). `git diff --name-status master...24b36d3` shows 21 × `A`, all under `aai/voice/` and `tests/voice/`, with no existing file touched.
- Reviewed in worktree `/workspace/rev-voice2`, removed afterwards. The main checkout wasn't touched and the branch is unmerged.
- New artifacts in `zoora-voice-gateway-2026-11-17-artifacts/`:
  - `test_adv.py`, updated with 4 tests changed (below);
  - `test_adv2_24b36d3.py`, with real-TLS hostile servers, host-binding, key-leak and context tests (needs a self-signed `c.pem`/`k.pem` next to it, which aren't committed);
  - `scanner_probe2_24b36d3.py`, with 31 new bypass shapes.

## Verdict: NO-GO for HUD wiring — 2 blockers (one carried over in a new form, one new)

B2 and most N items are genuinely fixed, and my original 6 bypasses are now caught. But the new scanner still lets voice code reach loaded ledger code and `__import__` through module aliasing, and the 45 s budget doesn't bound a server that drips its response headers.

## Blockers

### B1′. The scanner's module-attribute allowlist only applies to a literal `module.attr`, and `getattr` is only checked when called by its own name
- **Where:** `tests/voice/scanner.py:146` (`base = node.value.id if isinstance(node.value, ast.Name)`), `tests/voice/scanner.py:151-163` (literal-only check fires only for `Call(func=Name('getattr'))`), and `aai/voice/allowlist.py:81,142`.
- **Probe result:** 17 of 31 new shapes pass the scanner. These were run in a real interpreter with `aai.voice` imported, as in the HUD process:
  - `getattr(logging, 'sys').modules.get('aai.ledger')` → **returns the loaded `aai.ledger` module** (PaperLedger, RiskEngine, Store…). Once wired, the HUD process has ledger/economy already loaded. The same works via `m = logging; m.sys…`, a default arg `def f(m=logging)`, `[logging][0]`, `cast(Any, logging)`, walrus, lambda and tuple-unpack aliases.
  - `g = getattr; g(logging, '__builtins__')['__import__']('subprocess')` → works. A class-attribute alias `class K: g = getattr` → `K.g(x, '__dict__')` also passes. Literal-only and dunder rules are skipped once `getattr` is aliased.
  - `getattr(keyring, 'core').load_keyring('aai.ledger.PaperLedger')` → **imports `aai.ledger` by string** (verified in a fresh interpreter: not loaded before, loaded after).
  - `getattr(logging, 'os').posix_spawn` → process spawn reachable. `os.remove`, `Path.replace` (file move/overwrite) and `keyring.get_keyring().set_password(...)` (overwrites the owner's keys) are also not banned.
  - `'{0.__init__.__globals__}'.format(x)` passes. It's read-only (string output), so it's a minor point.
- **Caught correctly:** `__subclasses__`/`__class__`/`__dict__` attribute access, `codecs`/`zipimport`/`functools`/`operator` imports, `__loader__`, and my 6 original bypasses (15 violations). The shipped package scans clean. The aliased `_Store` attribute (`w = (...).open` at the allowed site) passes, which is acceptable since it's the same site.
- **Fix:**
  - (a) An imported module name may only appear as `X.attr` with `X` as the direct `Attribute.value` (or as `isinstance` args). Any other Load of a module name is a violation: assignment, call argument, default, container, `cast`, walrus or return.
  - (b) `getattr`/`hasattr` may only appear as the direct `func` of a call, never as a bare Name value. Their first argument must not be an imported module name, or the `MODULE_ATTR_ALLOWLIST` should be applied to the literal.
  - (c) Add `sys`, `os`, `modules`, `core`, `load_keyring`, `set_password`, `delete_password`, `posix_spawn`, `posix_spawnp`, `execvp`, `execvpe`, `execle`, `spawnvp`, `spawnlp`, `remove`, `removedirs`, `makedirs` and `replace` to `BANNED_ATTRS`. For `replace`, allow `str.replace` call sites via the call-site list or by banning `Path(...).replace` specifically.
  - (d) Add each shape from `scanner_probe2_24b36d3.py` as a must-fail fixture.

### B3. Header slow-drip escapes the 45 s / 40 s deadline
- **Where:** `aai/voice/net.py:98-121`. `remaining()` is checked before the request and after each **body** chunk. httpx's per-read timeout (capped at the remaining budget) resets on every byte, so a server that sends response **headers** one byte at a time is never cut.
- **Reproduced on a real local TLS socket:** with `ask_deadline_s=3`, `ask()` was **still running after 20 s**. In the full suite it ran until my 600 s harness timeout; the h11 16 KB header limit × 0.4 s/byte ≈ 1.8 h.
- **What is bounded:**
  - stall after TLS: 3.01 s;
  - stall before TLS: 3.00 s;
  - body drip: 3.21 s, and **45.23 s with the default budget**;
  - search drip inside `ask`: 3.21 s;
  - `transcribe`/`synthesize` body drip at a 2 s call budget: 2.00 s each.
- **Fix:** add a watchdog that aborts the in-flight request at the deadline. For example, a `threading.Timer(left, …)` that closes that request's connection/response (or uses a dedicated per-call client and closes it), then raises `ProviderError("… exceeded its time limit")`. Add a header-drip test against a real socket like mine.
- **Severity:** availability only (a stuck HUD worker thread). There's no data or key exposure, and it needs a hostile or broken endpoint.

## Fixed and verified

| Item | Result |
|---|---|
| B1 (original 6 shapes) | ✅ all flagged (15 violations); shipped package clean |
| B2 key leak | ✅ ZWSP, smart quote, space, tab, DEL and >512-char keys → `KeyMissingError` naming only the slot; Transport wraps `ValueError/UnicodeError/TypeError` → `ProviderError` with a clean repr and traceback. Residual note: `from None` still keeps `e.__context__` (the raw `UnicodeEncodeError`, whose repr has the header). Python never prints it, and the key validation makes it unreachable from providers |
| Host-bound slots | ✅ 14 base URLs × 5 providers plus search. A bound key (`xai-key`, `openai-key`, `brave-key`, `tavily-key`) was **only ever sent to its own host**. Tried: case, a trailing dot, suffix domains, userinfo `api.x.ai@evil`, the backslash parser-differential `evil\@api.x.ai` (urllib and httpx agree; httpx swaps in Basic auth from userinfo, so no key is sent), `%40`, `:443`, IPv6 and punycode. Custom slots are refused for bound hosts. xAI STT/TTS refuse any non-x.ai host |
| N1 budget | ⚠️ Mostly fixed: `reasoning_effort: low`, 45 s ask / 40 s call budgets, request timeout capped to the remaining budget, body drip cut. ❌ Header drip is not cut (B3) |
| N2 OpenAI | ✅ `languages[]` (matches OpenAI docs for gpt-transcribe), models and voice configurable, per-provider slots |
| N3 durations | ✅ NaN, ±inf, 0, negative, `True`, `61` and bad provider durations all refused; non-WAV without `duration_s` refused before upload |
| N4 scrub | ✅ token and key echoes are scrubbed from answer, speak_text and titles |
| N5 logging | ✅ httpx/httpcore at WARNING; Brave now uses POST JSON (verified against the Brave API reference: `POST /res/v1/web/search`, body `q`) |
| N6 TTS | ✅ `text/html`, empty, `application/octet-stream` and `text/plain; audio/mpeg` content types are refused for both TTS providers |
| N7 speak_text | ✅ `"See this link or code"` |
| N8 gitleaks | ✅ clean (commit range, `aai/voice`, `tests/voice`) |
| N9 context | ⚠️ Refuses token/apiKey/Balance/positions/wallet keys, Bearer and `sk-` values, and the HUD token. **Accepts** `equity_usd`, `pnl`, `acct.cash` and `"my seed is …"` in values. It's keyword-based, so it stays a HUD-side rule: only send an allowlisted context shape |

## The 4 changed adversarial tests (behaviour confirmed safer before updating)
- `test_non_wav_long_clip_without_duration_is_sent` → `…_is_refused`: webm with no `duration_s` raises `InputRejectedError` and STT is never called.
- `test_store_off_by_default`: now passes `duration_s=1.0`; still no files written.
- `test_nan_provider_duration` → `test_bad_provider_duration_refused`: NaN, inf, -1, 0 and 61 from the provider are refused.
- `test_html_200_returned_as_audio` → `test_html_200_refused_as_audio`: 4 non-audio content types are refused by both TTS providers.

## Tests run (24b36d3)
- `pytest tests/voice` → **208 passed**
- Full suite with deps (`/tmp/voice-venv`) → **553 passed, 1 deselected**. Repo `.venv` (voice skipped) → **345 passed, 1 deselected**. Both match SE.
- `mypy --strict aai/voice` → clean.
- `ruff check` / `ruff format --check` → clean **only with `--line-length 120`**. With defaults: 1 I001 and 14 files to reformat. Add `[tool.ruff] line-length = 120` (plus isort settings) to pyproject so it's reproducible.
- gitleaks 8.30.1 → no leaks (commit range, `aai/voice`, `tests/voice`).
- Reviewer suites:
  - `test_adv.py` → **149 passed** (4 updated and expanded);
  - `test_adv2_24b36d3.py` → **98 passed**, plus the header-drip case, which hangs (B3);
  - `scanner_probe2_24b36d3.py` → 17 of 31 shapes pass the scanner (B1′).

---

# Round 3: `f23ebd962491137cfd19cebbab458a14c79c9478` (2026-11-17, ~7:30 PM CT)

- Branch `zoora-voice-gateway`, parent `23c95b6` (= master). `master...f23ebd9` shows 25 × `A`, all under `aai/voice/` and `tests/voice/`.
- Reviewed in worktree `/workspace/rev-voice3`, removed afterwards. The main checkout wasn't touched and the branch is unmerged.
- New artifacts:
  - `scanner_probe3_f23ebd9.py`: probe2 re-headed so `import-home` doesn't mask results, plus 42 new shapes;
  - `test_adv3_watchdog_f23ebd9.py`: real-TLS concurrency, leak and reuse tests (needs `test_adv2_24b36d3.py` as `test_adv2.py` and `c.pem`/`k.pem` beside it).

## Verdict: NO-GO for HUD wiring — 1 blocker, and it's a one-line fix

B3 is fixed properly, and B1′ is fixed for every alias, getattr and module-hop shape. One canonical Python escape is left: **frame objects**. Once it's banned, I'd accept the remaining passes as reasonable for a static tripwire (judgement below), and a delta check is enough; no full round needed.

## Blocker

### B1″. Frame walks reach `__import__`/`eval` with no dunder, module or getattr involved
- **Where:** `aai/voice/allowlist.py:84` (`BANNED_ATTRS`) and `:143` (`BANNED_ATTR_PATTERNS`) have no frame or code attributes, and `tests/voice/scanner.py` has no `visit_Subscript` rule for dunder string keys.
- **Passing shapes, verified at runtime on 3.13.5:**
  - a generator gives `_g().gi_frame.f_builtins['__import__']('subprocess')` → loads subprocess, and `…('aai.ledger', fromlist=['x'])` → loads the ledger;
  - `_g().gi_frame.f_globals['__builtins__']['eval']` works;
  - a coroutine gives `_c().cr_frame.f_builtins['eval']('6*7')` → `42`;
  - `tb.tb_frame.f_globals`, `gi_frame.f_back` and `gi_code.co_consts` also pass.
- **Fix:**
  - add `gi_frame`, `cr_frame`, `ag_frame`, `tb_frame`, `tb_next`, `f_globals`, `f_builtins`, `f_locals`, `f_back`, `f_code`, `gi_code`, `cr_code`, `ag_code`, `co_consts` and `with_traceback` to `BANNED_ATTRS` (or the pattern `^(gi|cr|ag|tb|f|co)_`);
  - add a `visit_Subscript` rule that refuses a string-constant key shaped `__x__`;
  - add these shapes as must-fail fixtures.

## Remaining scanner passes and why I accept them for a tripwire
| Shape | Why it's acceptable or should be noted |
|---|---|
| Class decorators, metaclass kw, three-arg `type(...)` without getattr, `help`, `print`, builtin `format(x, '')`, `'%(a)s' % d` | No attribute walk or import; plain language features |
| Functional `TypedDict('X', {'a': '<code string>'})`, dataclass field metadata strings | Only evaluated by `get_type_hints`, which is banned and can't be imported |
| `Path(...).copy()` / `.move()` | **Python 3.14+ only** (absent on 3.13). Note: add `copy`, `move`, `copy_into` and `move_into` to `GUARDED_ATTRS` in case the PC runs 3.14 |
| `t._client.get('http://169.254.169.254/…')` from any voice file | Bypasses `require_https`, the watchdog and the host-bound key checks (no key attached). Note: ban attribute access to `_client` outside `net.py`, or add `get`/`post`/`stream`/`send`/`request` on `_client` to the call-site list |
| `__class__`/`__subclasses__`/`__globals__`/`__traceback__`/`__getattribute__`/`__dict__`/`__setattr__` walks, `operator`/`functools`/`importlib`/`__spec__`, `typing.ForwardRef`, `dataclasses.make_dataclass`, `logging.Formatter(...).format`, `_dir` retargeting from another class, tuple-assign or `object.__setattr__` | ✅ all caught |
| probe2 (re-headed so `import-home` doesn't mask results) | ✅ all 13 caught on their own rules |

## B3 watchdog: verified on real sockets
- **Bounded within budget + 1.5 s.** My `test_adv2` hostile modes on a 3 s ask:
  - stall: 3.00 s;
  - TLS stall: 3.00 s;
  - **header drip: 3.00 s** (previously unbounded);
  - body drip: 3.00 s;
  - default 45 s budget with body drip: 45.01 s;
  - search drip inside `ask`: 3.00 s;
  - `transcribe`/`synthesize` at a 2 s budget: 2.00 s each;
  - no deadline: a hard `timeout_s` of 2.00 s.
- **Concurrency and wrong socket.**
  - Setup: one shared Transport, 24 threads, 12 header-drip requests on a 1.5 s budget and 12 good requests that answer after 2.5 s.
  - Every hostile request was aborted by 1.51 s.
  - **All 12 good requests succeeded**, the longest in 2.53 s.
  - So a watchdog never closes another request's socket.
- **Thread leaks.** After 200 sequential requests: **0 live Timer threads**, 0 errors, and the thread count returned to baseline. Aborts leave no Timer behind.
- **Reuse after abort.** Abort, success, abort, success on the same Transport all worked.
- **`__context__`.** The ProviderError is now raised outside the except blocks, so `__context__` is `None`. This also closes my earlier note.
- **Note (keep-alive clients).** A caller-supplied keep-alive client is **not** bounded on a reused connection: no connect trace fires, so the watchdog has no socket to kill. My reuse-then-drip test hung past 8 s on one of two runs. The default `Transport()` is keep-alive 0 (verified `_max_keepalive_connections == 0`), and `from_keyring()` builds it, so this is not reachable in the shipped wiring. Suggest `Transport` refuse a client with keep-alive > 0, or document it.
- **Note (DNS).** A hanging DNS lookup isn't killable by the socket watchdog: there's no socket yet, and `getaddrinfo` ignores timeouts. That's acceptable for a fixed set of well-known hosts.

## `cryptography` as a test dependency
`tests/voice/test_hostile_net.py:27-31` uses `pytest.importorskip("cryptography…")`. On Linux it's present indirectly (keyring → SecretStorage → cryptography), so the tests ran: 8 passed in a fresh venv with only `pytest` and the voice requirements. **On Windows keyring doesn't pull it in, so the B3 regression tests would silently skip on the owner's PC and in Windows CI.** Add a `tests/voice/requirements-test.txt` (pytest, cryptography) and make the hostile-net tests fail rather than skip when `AAI_VOICE_REQUIRE_NET_TESTS=1` / in CI. An alternative is a static self-signed test cert fixture, which removes the dependency entirely.

## Tests run (f23ebd9)
- `pytest tests/voice` → **274 passed**. `test_hostile_net.py` → 8 passed (also in a fresh venv).
- Full suite with deps → **619 passed, 1 deselected**. Repo `.venv` → **345 passed, 1 deselected**.
- `mypy --strict aai/voice` clean. `ruff check` clean, and `ruff format --check` reports 20 files already formatted (the scoped `ruff.toml` files work).
- gitleaks 8.30.1: commit range, `aai/voice` and `tests/voice` all clean.
- Reviewer suites:
  - `test_adv.py` + `test_adv2` → **248 passed**;
  - `test_adv3_watchdog_f23ebd9.py` → **6 passed** (the keep-alive case is a print-only note);
  - probe2 → 13/13 caught;
  - probe3 → frame-walk shapes pass (B1″); the other passes are accepted as above.

---

## Round 4 delta: d8865de (2026-11-17)

**Verdict: GO for HUD wiring** (HUD-side requirements from earlier rounds still apply). Branch left unmerged; reviewed in a throwaway worktree, removed afterwards.

Scope: `git diff f23ebd9 d8865de`, which changed allowlist.py, net.py, scanner.py, test_denylist.py, test_hostile_net.py, README, requirements-test.txt and the probe3 fixture. `master...HEAD` is still 27 added files, with no edits to existing files.

**B1″ (frame walks): closed.**
- probe3 now has 0 shapes that pass the scanner (round 3 had the frame-walk passes).
- `scan_package(aai/voice)` returns `[]`, so the shipped code is not broken by the new bans.
- `scanner_probe4_d8865de.py` adds 32 new shapes. These are all flagged:
  - `logging.sys._getframe`, `logging.currentframe`, `logging.sys.exc_info`;
  - `import inspect`, `from inspect import currentframe`, `import traceback`;
  - `e.__traceback__`, `getattr(e,'__traceback__')`, `r.exc_info[2].tb_frame`;
  - `gi_yieldfrom`, `cr_await`, `ag_await`, the genexpr `.gi_frame`;
  - `__reduce_ex__`, `__getstate__`, `__dict__`;
  - `d['__import__']`, `d.get('__builtins__')`, `getattr(x,'gi_'+'frame')`;
  - `threading.current_thread` and `settrace`, `async def`.
- These pass, and I judge them harmless:
  - `Logger.findCaller`, which returns only str, int, str and None (checked at runtime);
  - computed dunder subscript keys (`'__imp'+'ort__'`, `''.join`, `chr`, `bytes.decode`, `re.sub`). These need a dict that holds builtins or globals. Every route to one is banned (frames, `__dict__`, `__globals__`, vars/globals, the `__builtins__` literal), and getattr only takes literal identifiers. I'm noting them as defence in depth, not as blockers.
- Spot checks:
  - `Path.copy` and `move_into` → file-write;
  - `t._client` and `t._transport._pool` → private-attr outside net.py (allowed in net.py, by design);
  - builtin rebind, `metaclass=`, the `functools.lru_cache` decorator and `%`-format → all flagged.

**Keep-alive and watchdog: safe.**
- `Transport(client=...)` now refuses:
  - default-limits clients;
  - clients with `max_keepalive_connections=5`;
  - clients with `mounts=` or `proxy=`.
- It accepts keepalive-0 HTTPTransport clients and MockTransport.
- The default Transport pool has keepalive 0.
- The check reads httpx private attributes, but it fails closed: if httpx internals change, the attribute isn't found, `!= 0` is true and the client is refused.
- I updated my adversarial tests:
  - test_adv2 `client()` now uses `Limits(max_keepalive_connections=0)`;
  - test_adv3 `test_keepalive_client_reuse_is_not_bounded` is replaced by `test_keepalive_or_routed_client_refused` (4 cases, each expects ValueError) and `test_keepalive_zero_client_accepted_and_default_is_zero`.
- Results:
  - every deadline case ends at budget (3.00 s; call deadline 2.00 s);
  - with the hostile servers, max elapsed is 1.50 s and all requests abort; the good path is all OK;
  - no timers are left running and no threads leak after 200 requests or 5 aborts.

**Strict test deps: verified.** I blocked cryptography with a shim. test_hostile_net then gives 8 skips with no env set, and 8 errors (not skips) with `CI=1` or `AAI_VOICE_STRICT_TESTS=1`.

**Tests run:**

| Run | Result |
|---|---|
| voice-venv full suite | 705 passed (SE claimed 704; +1 is fine) |
| repo .venv | 346 passed |
| `CI=1 pytest tests/voice` | 359 passed |
| adversarial test_adv + test_adv2 + test_adv3 | 258 passed |
| mypy --strict aai/voice | clean |
| ruff check and format | clean |
| gitleaks (master..HEAD, aai/voice, tests/voice) | no leaks |

Artifacts: `test_adv2_d8865de.py`, `test_adv3_watchdog_d8865de.py`, `scanner_probe4_d8865de.py`.
