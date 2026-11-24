import copy
import datetime as dt
import json
import os
import shutil
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
TOPICS = os.path.dirname(HERE)
STUDIO = os.path.dirname(os.path.dirname(TOPICS))
FIXTURES = os.path.join(TOPICS, "fixtures", "api")
ERRORS = os.path.join(FIXTURES, "errors")
CONFIG = os.path.join(TOPICS, "config.json")
QUOTA = os.path.join(TOPICS, "quota.json")
TAXONOMY = os.path.join(TOPICS, "taxonomy.json")
NOW = dt.datetime(2026, 11, 24, 12, 0, 0, tzinfo=dt.timezone.utc)
RUN_DATE = dt.date(2026, 11, 24)
FORMATS = {"zoora-ai": ["pov-story", "explainer"], "zoora-security": ["explainer", "scam-of-the-week"]}
SECURITY_EVERGREEN = ["drainers", "address-poisoning", "phishing", "key-management", "bridge-security", "oracle-manipulation", "rug-pulls", "social-engineering", "fake-job-malware", "ai-security"]
FAKE_KEY = "fake-test-key-not-real-0001"

if TOPICS not in sys.path:
    sys.path.insert(0, TOPICS)


def load_json(path):
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def db():
    return load_json(os.path.join(FIXTURES, "db.json"))


def error_body(name):
    return load_json(os.path.join(ERRORS, name + ".json"))


def config():
    return load_json(CONFIG)


def taxonomy():
    from topiclib import classify
    return classify.Taxonomy.load(TAXONOMY, FORMATS, set(SECURITY_EVERGREEN))


def by_scenario(scenario_prefix):
    for v in db()["videos"]:
        if v.get("scenario", "").startswith(scenario_prefix):
            return v
    raise KeyError(scenario_prefix)


def fixture_video(key_prefix):
    """The fixture candidate whose scenario text starts with the given words."""
    return by_scenario(key_prefix)


def idea(id_, title, fmt, evergreen, priority, fact_tags=(), angle=None):
    """A complete, valid backlog idea for test backlogs."""
    return {
        "id": id_, "slug": id_, "title": title, "format": fmt, "status": "idea", "priority": priority, "week": None, "role": None,
        "angle": angle or f"A test idea about {evergreen}: what it argues, and how it ends on one defensive check.",
        "evergreenTopic": evergreen, "relatedTopics": [], "factTags": list(fact_tags), "research": None,
        "facts": [{"need": "A test fact", "factId": None, "status": "research needed"}],
        "risks": ["Test risk."], "languages": {"master": "en", "dubs": ["es", "pt-br"]}, "shortIdeas": [], "notes": None,
    }


TEST_BACKLOGS = {
    "zoora-security": {
        "version": 1, "channel": "zoora-security", "updated": "2026-11-24", "status": "test", "rules": ["Test rule."],
        "ideas": [
            idea("explainer-wallet-drainers", "How wallet drainers work, and how to spot one", "explainer", "drainers", 1, ["drainers", "phishing", "approvals"]),
            idea("explainer-key-management", "Keys, multisigs and why one leaked key can empty a vault", "explainer", "key-management", 6, ["key-management", "multisig"]),
            idea("explainer-fake-job-malware", "Fake job interviews that install malware", "explainer", "fake-job-malware", 9, ["fake-jobs", "malware"]),
            idea("explainer-phishing", "Crypto phishing: the signs that never change", "explainer", "phishing", 4, ["phishing"]),
            idea("sotw-deepfake-livestream", "Scam of the Week: the deepfake giveaway livestream", "scam-of-the-week", "ai-security", 2, ["deepfakes", "giveaway-scams"]),
            idea("sotw-voice-clone", "Scam of the Week: a cloned voice asks for money", "scam-of-the-week", "ai-security", 4, ["voice-cloning", "deepfakes"]),
            idea("sotw-fake-airdrop", "Scam of the Week: the free airdrop that wants a signature", "scam-of-the-week", "drainers", 6, ["airdrop-scams", "drainers"]),
        ],
    },
    "zoora-ai": {
        "version": 1, "channel": "zoora-ai", "updated": "2026-11-24", "status": "test", "rules": ["Test rule."],
        "ideas": [
            idea("pov-address-poisoning", "POV: You copy the address from your history and pay a stranger", "pov-story", "address-poisoning", 9, ["address-poisoning"]),
            idea("pov-friends-memecoin", "POV: You buy your friend's memecoin on day one", "pov-story", "rug-pulls", 12, ["memecoins", "rug-pulls", "pump-fun", "token-survival"]),
            idea("ai-agent-hedge-fund", "POV: You created an autonomous AI trading agent hedge fund", "pov-story", "ai-trading-agents", 2, ["ai-agents", "ai-hedge-funds"]),
        ],
    },
}


class Studio:
    """A temporary video-studio root with content/<channel>/backlog.json and channel.json, so tests never depend on
    other workflows' (possibly uncommitted) files."""

    def __init__(self, backlogs=None, with_channel_json=True):
        self.root = tempfile.mkdtemp(prefix="topics-studio-")
        for channel, data in (backlogs if backlogs is not None else TEST_BACKLOGS).items():
            folder = os.path.join(self.root, "content", channel)
            os.makedirs(folder, exist_ok=True)
            with open(os.path.join(folder, "backlog.json"), "w", encoding="utf-8") as fh:
                json.dump(copy.deepcopy(data), fh, indent=2)
        if with_channel_json:
            folder = os.path.join(self.root, "content", "zoora-security")
            os.makedirs(folder, exist_ok=True)
            evergreen = {k: {"title": f"Planned explainer on {k}", "url": None, "status": "planned"} for k in SECURITY_EVERGREEN}
            with open(os.path.join(folder, "channel.json"), "w", encoding="utf-8") as fh:
                json.dump({"channel": "zoora-security", "evergreen": evergreen}, fh)
        self.out = os.path.join(self.root, "out", "topics")

    def cleanup(self):
        shutil.rmtree(self.root, ignore_errors=True)


def run_fixtures(studio, **overrides):
    """One fixture run into the temp studio. Returns (doc, written paths)."""
    from topiclib import pipeline
    opts = {
        "mode": "fixtures", "studio": studio.root, "out_dir": studio.out, "now": NOW, "run_date": RUN_DATE,
        "fixtures_dir": FIXTURES, "max_units": 2000, "max_searches": 30, "cache_dir": None, "ledger_path": None,
        "sleep": lambda s: None,
    }
    opts.update(overrides)
    return pipeline.run_find(opts)


class RecordingTransport:
    """Wraps a transport and records calls (and can raise scripted errors first)."""

    def __init__(self, inner, script=None):
        self.inner = inner
        self.script = list(script or [])
        self.calls = []

    def get(self, method, params):
        self.calls.append((method, dict(params)))
        if self.script:
            item = self.script[0]
            if item.get("method") in (None, method):
                self.script.pop(0)
                raise item["error"]
        return self.inner.get(method, params)
