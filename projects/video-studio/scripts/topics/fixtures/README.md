# Topic-finder fixtures

The YouTube Data API was not reachable with a key while this tool was built (no key yet, and live runs wait for the
owner's go-ahead; see `../README.md`). The tests and `--fixtures` runs therefore answer from a stand-in API
(`topiclib/fake_api.py`) over this folder.

| File | What it is | Recorded or synthetic |
| --- | --- | --- |
| `api/db.json` | 22 channels and 475 videos: uploads histories plus 23 designed candidates. Each candidate's `scenario` field names the behaviour it tests (per-format baseline, floor, lifetime estimate, view-count epoch, attack tutorial, own channel, Spanish and Portuguese ideas, duplicates of backlog ideas, and so on). | **Synthetic.** Built by `tools/build_fixtures.py` from a fixed seed. Every channel title ends in "(synthetic)". Ids are SHA-256 derived. The only real id is the owner's own channel (`UCjNibXSaZqeXSD36V6dyIVQ`), there to prove that the tool skips it. |
| `api/errors/forbidden-no-key-recorded-2026-11-24.json` | Google's answer to a search request without a key, from this session on 2026-11-24 (HTTP 403, `PERMISSION_DENIED`, ErrorInfo `ACCESS_DENIED`). | **Recorded** (contains no key and no personal data). |
| `api/errors/*.json` (the others) | Error envelopes for quotaExceeded, keyInvalid, accessNotConfigured, backendError, rateLimitExceeded and playlistNotFound. | **Synthetic**, shaped after the errors reference page (updated 2026-11-18) and Google's error envelope. |

The fake answers in the shapes of discovery document rev 20261123: counts are strings, player sizes appear only
when maxHeight is sent, hidden subscriber counts are omitted, and `fields` selectors are applied. It also rejects
what the API documents as errors (unknown parameters, maxResults out of range, more than 50 ids, maxResults with
id on videos.list, bad relevanceLanguage, unknown playlists).

Real API responses are API Data: they may not be kept longer than 30 days (Developer Policies III.E.4), so recorded
live responses must never be committed here.

Rebuild after changing the builder: `python3 scripts/topics/tools/build_fixtures.py`. The tests check that the
committed database matches the builder (`--check`).
