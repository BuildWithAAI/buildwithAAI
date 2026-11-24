import json

import pytest

from billy.ingest import PostStore, XLiveSourceStub, run_ingest
from billy.ingest.sources import XApiPayloadSource, normalise_record
from billy.ingest.store import load_state

OUTLOOK = "BTC Daily Technical Outlook:\n$BTC closed bullish. Holding above $80,000 will offer a long."


def _x_obj(i, text=OUTLOOK, ts="2026-10-01T00:00:00.000Z"):
    return {"id": str(i), "created_at": ts, "text": text, "author_id": "1"}


def test_normalise_both_formats():
    a = normalise_record({"id": "5", "date": "2026-10-31T02:14:21.000Z", "text": "x", "url": "u"}, "h", "s")
    b = normalise_record(_x_obj(6), "cryptoWZRD_", "s")
    assert a.id == "5" and b.url == "https://x.com/cryptoWZRD_/status/6"
    assert b.created_at.tzinfo is not None


def test_x_payload_wrapped_text_and_retweets(tmp_path):
    payload = {"data": [_x_obj(1), _x_obj(2, text="RT @someone: hi")], "meta": {"next_token": "t"}}
    p = tmp_path / "p.txt"
    p.write_text("Tool result header\n" + json.dumps(payload) + "\ntrailer")
    ids = [x.id for x in XApiPayloadSource(p, "cryptoWZRD_").iter_posts()]
    assert ids == ["1"]


def test_incremental_ingest_dedup_and_state(settings):
    seed = settings.paths.root / "seed.jsonl"
    seed.write_text(json.dumps({"id": "10", "date": "2026-09-01T00:00:00Z", "text": OUTLOOK,
                                "url": "https://x.com/cryptoWZRD_/status/10"}) + "\n")
    settings.paths.seed_posts = [seed]
    inbox = settings.paths.inbox_dir
    inbox.mkdir(parents=True)
    (inbox / "a.json").write_text(json.dumps({"data": [_x_obj(10), _x_obj(11, ts="2026-10-02T00:00:00Z")]}))
    r1 = run_ingest(settings)
    assert (r1.added, r1.total, r1.newest_id) == (2, 2, "11")
    assert (inbox / "processed" / "a.json").exists()
    st = load_state(settings.paths.state_file)
    assert st["last_post_id"] == "11" and "since_id" in st["how_to_fetch_next"]
    # same file dropped again -> skipped by hash; new file -> only new post added
    (inbox / "a.json").write_text((inbox / "processed" / "a.json").read_text())
    (inbox / "b.jsonl").write_text(json.dumps(_x_obj(12, ts="2026-10-03T00:00:00Z")) + "\n")
    r2 = run_ingest(settings)
    assert r2.added == 1 and r2.files_skipped == ["a.json"] and r2.total == 3
    assert [p.id for p in PostStore(settings.paths.posts_store).sorted()] == ["12", "11", "10"]


def test_bad_file_does_not_crash(settings):
    settings.paths.inbox_dir.mkdir(parents=True)
    (settings.paths.inbox_dir / "bad.json").write_text("not json at all")
    r = run_ingest(settings)
    assert r.added == 0


def test_live_source_stub_refuses():
    with pytest.raises(NotImplementedError):
        list(XLiveSourceStub().iter_posts())
