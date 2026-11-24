# Zoora voice

A standalone push-to-talk voice gateway for the Zoora HUD: **speech-to-text → LLM (web search only) → text-to-speech**.
It is called *Zoora voice* everywhere. It has its own original personality and is not styled after any existing
assistant or character.

The HUD (owned by Head of Systems: `aai/hud.py`, `aai/zoora.py`, `aai/static/zoora/*`) wires the orb, pop-up
screens, sounds and routing on top of this package. This package changes none of those files.

## Interface (pure Python)

```python
from aai import hud  # HoS wires this in hud.py
from aai.voice import VoiceGateway, constant_time_verifier

voice = VoiceGateway.from_keyring(
    token_verifier=constant_time_verifier(hud.hud_token),  # AAI_HUD_TOKEN, compared with hmac.compare_digest
    stt="xai",
    tts="xai",
    search="brave",  # or stt/tts="openai", search="tavily" / None
)

# duration_s is required for non-WAV clips (webm/opus/mp3) and must be a finite number in (0, 60].
text = voice.transcribe(audio_bytes, hud_token=tok, mime="audio/webm", duration_s=3.2)  # -> str
result = voice.ask(text, {"screen": "eagle-eye"}, hud_token=tok)
#        -> {"answer": str, "sources": [{"title": str, "url": str}], "speak_text": str}
audio = voice.synthesize(result["speak_text"], hud_token=tok)  # -> bytes (MP3)
```

Module-level shortcuts `aai.voice.transcribe / ask / synthesize` work after `aai.voice.set_default_gateway(voice)`.

* `hud_token` is keyword-only and required on every call. The verifier is injected at construction and must return
  exactly `True`. Any exception, a wrong token, an empty token, or a token over 512 characters raises
  `UnauthorizedError` before a provider is touched. `constant_time_verifier` **fails closed when the HUD has no
  token set**, unlike the HUD's open mode, so voice never runs unauthenticated.
* Errors are all subclasses of `VoiceError`: `UnauthorizedError`, `KeyMissingError`, `KeyringBackendError`,
  `InputRejectedError`, `InsecureURLError`, `ProviderError`. Error messages never contain keys, tokens, audio or
  provider response bodies.
* Custom providers can be passed straight to `VoiceGateway(llm=..., stt=..., tts=..., search=...)`. They implement
  the small protocols in `providers.py` (`ChatLLM`, `STTProvider`, `TTSProvider`, `SearchProvider`).

## Providers and endpoints (checked against the official docs on 2026-11-17)

| Role | Default | Endpoint | Docs |
|---|---|---|---|
| LLM | xAI `grok-4.7`, `reasoning_effort: "low"` | `POST https://api.x.ai/v1/chat/completions` (OpenAI-compatible, function calling) | <https://docs.x.ai/developers/rest-api-reference/inference/chat-completions>, <https://docs.x.ai/developers/tools/function-calling>, <https://docs.x.ai/developers/models> |
| STT | xAI `grok-voice-transcribe-2.0` | `POST https://api.x.ai/v1/stt` (multipart; `file` last) | <https://docs.x.ai/developers/model-capabilities/audio/speech-to-text>, <https://docs.x.ai/developers/rest-api-reference/inference/speech-to-text> |
| TTS | xAI voice `eve` | `POST https://api.x.ai/v1/tts` (`{text, voice_id, language}` → `audio/*` bytes; the JSON `{audio: base64, content_type}` envelope is also handled) | <https://docs.x.ai/developers/model-capabilities/audio/text-to-speech>, <https://docs.x.ai/developers/rest-api-reference/inference/voice> |
| STT (alt) | OpenAI `gpt-transcribe` (`VoiceConfig.openai_stt_model`) | `POST {base}/audio/transcriptions`; sends `languages[]` (not `language`) for gpt-transcribe, `language` for other models | <https://developers.openai.com/api/reference/resources/audio/subresources/transcriptions/methods/create> |
| TTS (alt) | OpenAI `gpt-4o-mini-tts` (`openai_tts_model`, `openai_tts_voice`) | `POST {base}/audio/speech` | <https://developers.openai.com/api/docs/guides/text-to-speech> (OpenAI shuts `gpt-4o-mini-tts` down on 2027-01-06: <https://developers.openai.com/api/docs/deprecations>) |
| Search | Brave | `POST https://api.search.brave.com/res/v1/web/search` (JSON `{q, count, safesearch}`, `X-Subscription-Token`; POST keeps the question out of URLs) | <https://api-dashboard.search.brave.com/api-reference/web/search/post>, <https://api-dashboard.search.brave.com/documentation/guides/authentication> |
| Search (alt) | Tavily | `POST https://api.tavily.com/search` (Bearer, `include_answer`) | <https://docs.tavily.com/documentation/api-reference/endpoint/search> |

grok-4.7 defaults to high reasoning, so chat requests send `reasoning_effort: "low"` to keep spoken answers quick
(`VoiceConfig.llm_reasoning_effort`; `None` omits it). xAI marks Chat Completions as legacy in favour of the
Responses API, but it is still documented and supported. It was kept because it is OpenAI-compatible, so any
compatible base URL works (`VoiceConfig(llm_base_url=...)`). OpenAI is never a silent fallback: it's used only when
`stt="openai"` / `tts="openai"` is chosen explicitly. ElevenLabs is not built in; add it by implementing
`TTSProvider`.

## Windows setup (PowerShell, on Zoorped's PC)

```powershell
cd C:\path\to\aai
py -m pip install -r aai\voice\requirements.txt     # httpx, keyring (Credential Manager backend)

# Each command prompts for the secret with hidden input. Nothing lands in shell history, env vars or files.
# Slots are per provider and bound to that provider's host, so a key can never be sent to another provider.
py -m keyring set zoora-voice xai-key       # xAI API key: LLM, speech-to-text and text-to-speech
py -m keyring set zoora-voice brave-key     # Brave Search API key (search="brave", the default)

# Only if you choose them:
#   py -m keyring set zoora-voice tavily-key   # search="tavily"
#   py -m keyring set zoora-voice openai-key   # stt="openai" / tts="openai"; only ever sent to api.openai.com
#   py -m keyring set zoora-voice llm-key      # a custom OpenAI-compatible LLM host (not api.x.ai / api.openai.com)

py -c "import keyring; print(type(keyring.get_keyring()).__module__)"   # expect keyring.backends.Windows
```

The entries appear in **Credential Manager → Windows Credentials** as `zoora-voice`. To rotate a key, run the same
`set` command again. To remove one, run `py -m keyring del zoora-voice <name>`. Keys are read from the keyring on each
call, so a rotated key takes effect immediately. Paste keys as plain text: a key containing a non-ASCII character
(a zero-width space or smart quote copied from a web page), a space or a control character is refused.

## Safety rules

1. **Keys come only from the OS keyring** (service `zoora-voice`). There is no env var fallback, no file fallback
   and no default. Slots are host-bound: `xai-key` → `api.x.ai` only, `openai-key` → `api.openai.com` only,
   `brave-key` → `api.search.brave.com`, `tavily-key` → `api.tavily.com`, and `llm-key`/`stt-key`/`tts-key` → a
   custom OpenAI-compatible host that is none of those. A missing or empty key, a key that isn't printable ASCII,
   a keyring error, or a slot/host mismatch raises `KeyMissingError` before any network call, and the message names
   only the slot. Voice also refuses to read keys unless every active keyring backend is an OS store (Windows
   Credential Manager, macOS Keychain, SecretService/libsecret, KWallet). Plaintext or file backends
   (`keyrings.alt`) and the `fail`/`null` backends are refused.
2. **Keys never reach logs or errors.** Every key read and every accepted HUD token is registered with a scrub
   filter on the `aai.voice` logger. Bearer, `X-Subscription-Token` and `xai-`/`sk-`/`tvly-`/`BSA` shapes are
   redacted even if never registered. Provider errors carry only the provider name and HTTP status, never the body.
   Any `ValueError`/`UnicodeError`/`TypeError` while building a request (a header encoding error's repr would
   contain the key) becomes a plain `ProviderError` with no chained exception. `answer`, `speak_text`, source
   titles and transcripts are scrubbed before they're returned, and a web-search query containing a secret is
   refused. The `httpx`/`httpcore` loggers are held at WARNING so request URLs never reach a log.
3. **Hard deny-list.** Voice can never reach trade, spend, transfer, signer, ledger-write or world-edit code:
   * `allowlist.py` is the policy. Imports are allowlisted by exact module (`urllib.parse` yes, `urllib.request`
     no; `logging` yes, `logging.config` no), plus `httpx`, `keyring` and `aai.voice` itself. No other `aai.*`
     package, no import aliases, and only listed names may be pulled with `from X import` (no
     `typing.get_type_hints`). `X.attr` on each allowed module is limited to the attributes voice actually uses
     (so no `keyring.core.load_keyring("<dotted path>")`, no `io.open`). A module name may only appear as
     `module.attr`: assigning, passing, returning, casting or containing a module is refused, because any alias
     escapes the attribute allowlist. `httpx` may only be imported in `net.py` and `keyring` only in `keys.py`.
   * Banned everywhere: `__builtins__`, `__import__`, `builtins`, `globals`, `vars`, `locals`, `eval`, `exec`,
     `compile`, `open`, `setattr`/`delattr`, non-allowlisted dunder attributes (`__subclasses__`, `__globals__`...),
     `urlopen`, `dictConfig`, `fileConfig`, `listen`, `get_type_hints`, `import_module`, module hops (`.sys`, `.os`,
     `.modules`, `.core`, `load_keyring`), keyring writes (`set_password`, `delete_password`), `mro`, `format` and
     `format_map`, nested f-string format specs, process spawning (`posix_spawn*`, `exec*`, `spawn*`, `system`...),
     file logging, string annotations, and file reads, deletes, moves and renames (`remove`, `removedirs`,
     `makedirs`, `rename`, `unlink`...), frame and code walks (any attribute starting `gi_`, `cr_`, `ag_`, `tb_`,
     `f_` or `co_`, plus `tb_next` and `with_traceback`), subscripts and string literals naming a dunder
     (`d['__builtins__']`), the functional `TypedDict(...)` form, `%` string formatting, re-binding a builtin to
     another name (`p = print`), `print`/`help`/`format`/`memoryview`, `async def`, metaclasses and class keywords,
     and any decorator other than `dataclass`, `contextmanager`, `classmethod`, `staticmethod` and `property`.
     `Transport._client` (and httpx's private `_transport`/`_pool`/`_mounts`) may only be touched in `net.py`. `getattr`/`hasattr` may only be called directly (never aliased), never on a
     module, and only with a plain, non-banned identifier literal. File writes and moves (`open`, `write_text`,
     `write_bytes`, `mkdir`, `replace`, and Python 3.14's `copy`, `move`, `copy_into`, `move_into`) are allowed only as direct calls at the listed call sites: the opt-in
     `_Store` (whose `_dir` can only be set in `__init__`), `wave.open` on an in-memory buffer, and `str.replace`
     in `redact.scrub`.
   * `tests/voice/scanner.py` enforces the policy with `ast`, and `tests/voice/test_denylist.py` runs it on every
     voice module. The planted-violation tests use Head of Systems' bypass probe as a fixture and prove the scan
     fails on each of its six bypasses (alone, without their imports, and planted into a copy of the package), plus
     about 37 other bypass shapes. All 31 shapes of the second probe (`fixtures/hos_scanner_probe2_24b36d3.py.txt`)
     are must-fail tests too, counted only on each shape's own lines, and so are all 54 shapes of the third probe
     (`fixtures/hos_scanner_probe3_f23ebd9.py.txt`). `allowlist.py` must stay pure literal data (a test enforces
     it), since it is the one file allowed to spell out dunder names.
   * A runtime test imports `aai.voice` in a fresh interpreter and asserts no other `aai.*` module and nothing
     matching `trade|spend|transfer|signer|ledger|wallet|world|chunk|economy|payment` is loaded. Inside the HUD
     process those modules are already loaded, so the static scan is the tripwire that matters there. A second
     runtime test walks every voice module's globals (and its classes' attributes): a module object may only sit
     under its own import name, `httpx` only in `net` and `keyring` only in `keys`, and no builtin such as
     `getattr` may be re-bound under another name. A third compiles every voice module and checks the bytecode
     names of every function for frame/code/traceback attributes and banned names, and that no module or class
     holds a frame, generator, coroutine, traceback or code object.
   * The LLM is offered exactly one tool, `web_search`. Any other tool name it asks for is refused, and nothing runs.
4. **No always-on mic.** The package never opens a microphone and imports no audio-capture library. It only accepts
   audio bytes the HUD passes in after push-to-talk.
5. **Nothing stored by default.** `VoiceConfig.store_transcripts` and `store_audio` are both `False`. Turning one on
   requires an explicit `store_dir`. Transcripts and audio have separate switches.
6. **Limits and time budgets.** Audio input is capped at 10 MB and 60 s. Every duration (the HUD's `duration_s`,
   the WAV header and the one the STT provider reports) must be a finite number in (0, 60]; NaN, infinity, zero,
   negatives and booleans are refused, and non-WAV clips must come with `duration_s`. Each `ask()` has an overall
   45 s wall-clock budget (`ask_deadline_s`) covering every LLM and search call inside it, and
   `transcribe`/`synthesize` have 40 s (`call_deadline_s`). Each request's timeout is capped to what's left of the
   budget, and a watchdog shuts down the request's own socket at the deadline, so a server that drips headers
   or stalls the TLS handshake can't outlive the budget either (without a `deadline()` block, `timeout_s` is the
   per-request cap). A caller-supplied `httpx.Client` must be built with
   `httpx.Limits(max_keepalive_connections=0)` (or be an `httpx.MockTransport` test client), because a reused
   keep-alive connection would escape the watchdog; anything else is refused with `ValueError`. Other caps: question 2,000 characters, HUD context 4,000, answer
   1,500, `speak_text` 600, TTS input 1,000, at most 2 tool rounds and 3 searches per `ask`, at most 8 sources,
   responses 20 MB, 5 s to connect.
7. **HUD context privacy.** `context` is sent to the LLM provider, so `ask()` refuses context whose keys look like
   credentials or money state (`token`, `secret`, `api_key`, `balance`, `position`, `wallet`, `ledger`, `seed`...)
   or whose values contain a known secret. Keep balances, positions and ledger data out of it.
8. **Untrusted text.** Transcripts, HUD context and web results are wrapped in `<untrusted>` fences that input
   cannot close. The system prompt tells the model they are data, not instructions. Since voice has no action tools,
   injected text has nothing to trigger. `speak_text` drops URLs, markdown link targets and `javascript:`/`data:`
   text.
9. **HTTPS only, audio only.** Every provider URL and every returned source URL must be `https://`. Redirects are
   not followed, and `trust_env=False` means proxy env vars and `.netrc` credentials are never used. TTS replies
   must be `audio/*` (or xAI's JSON envelope with an `audio/*` content type), so a captive-portal HTML page is never
   returned as audio.

## Tests

```powershell
py -m pip install -r tests\voice\requirements-test.txt
$env:AAI_VOICE_STRICT_TESTS = "1"
py -m pytest tests\voice -q
```

They use fake providers and `httpx.MockTransport`, with no network and no keys, except `test_hostile_net.py`,
which runs a hostile TLS server on 127.0.0.1 with a throwaway certificate made by `cryptography`. Without
`cryptography` those tests skip, unless `CI` or `AAI_VOICE_STRICT_TESTS` is set, in which case they fail. If
`httpx`/`keyring` aren't installed, `tests/voice` isn't collected, so the rest of the repo's suite still runs.
