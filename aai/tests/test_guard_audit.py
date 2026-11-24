import sys
from aai import guard_audit


def test_guard_audit_pass_fail_missing(tmp_path):
    ok = tmp_path / "ok.py"; ok.write_text("print('all good')\n")
    bad = tmp_path / "bad.py"; bad.write_text("import sys\nprint('x'*5000)\nsys.exit(2)\n")
    r = guard_audit.run(str(ok), timeout=20, python=sys.executable)
    assert r["status"] == "pass" and r["ok"] and r["rc"] == 0 and "all good" in r["tail"]
    r = guard_audit.run(str(bad), timeout=20, python=sys.executable)
    assert r["status"] == "fail" and r["rc"] == 2 and len(r["tail"]) <= guard_audit.TAIL_CHARS
    r = guard_audit.run(str(tmp_path / "nope.py"), timeout=1, python=sys.executable)
    assert r["status"] == "missing" and not r["ok"]


def test_guard_audit_timeout_kills_children(tmp_path):
    slow = tmp_path / "slow.py"
    slow.write_text("import subprocess,sys,time\nsubprocess.Popen([sys.executable,'-c','import time; time.sleep(60)'])\nprint('started', flush=True)\ntime.sleep(60)\n")
    r = guard_audit.run(str(slow), timeout=1.5, python=sys.executable)
    assert r["status"] == "timed_out" and r["rc"] is None and r["elapsed_sec"] < 10 and "started" in r["tail"]


def test_guard_audit_child_env_strips_tokens(tmp_path, monkeypatch):
    """The audit child gets PATH/HOME/LANG only — no tokens, secrets, or LUMEN_* vars."""
    monkeypatch.setenv("LUMEN_TELEGRAM_BOT_TOKEN", "dummy-not-used")
    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", "dummy-not-used")
    monkeypatch.setenv("AAI_HUD_TOKEN", "dummy-not-used")
    monkeypatch.setenv("LUMEN_ORIGIN", "http://example.invalid")
    monkeypatch.setenv("CLOUD_AGENT_INJECTED_SECRET_NAMES", "LUMEN_TELEGRAM_BOT_TOKEN,TELEGRAM_BOT_TOKEN")
    monkeypatch.setenv("EXTRA_SHOULD_DROP", "1")
    env = guard_audit.child_env()
    assert "PATH" in env and "HOME" in env and "LANG" in env
    for k in env:
        assert k in guard_audit._AUDIT_ENV_ALLOW or k == "LANG"
        assert "TOKEN" not in k and "SECRET" not in k
        assert not k.startswith("LUMEN_")
    script = tmp_path / "envcheck.py"
    script.write_text(
        "import os, sys\n"
        "keys = sorted(os.environ)\n"
        "print('KEYS', ','.join(keys))\n"
        "bad = [k for k in keys if 'TOKEN' in k or 'SECRET' in k or k.startswith('LUMEN_') or k == 'EXTRA_SHOULD_DROP']\n"
        "sys.exit(1 if bad else 0)\n"
    )
    r = guard_audit.run(str(script), timeout=20, python=sys.executable)
    assert r["status"] == "pass" and r["rc"] == 0
    keys = r["tail"].split("KEYS ", 1)[1].strip().split(",")
    assert "PATH" in keys and "LUMEN_TELEGRAM_BOT_TOKEN" not in keys and "AAI_HUD_TOKEN" not in keys
