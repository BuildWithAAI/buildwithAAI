#!/usr/bin/env python3
"""Rerunnable agent-economy security audit. Read-only except writing reports/ in this repo.

Never prints secret values: hits are reported as path, line, key type and fingerprint (first 4 chars + length).
Seed-phrase / private-key hits report location only.  Exit code: 2 if any CRITICAL, 1 if HIGH, else 0.

Usage:  python3 /workspace/agent-guard/audit.py [--roots /workspace /home/box ...] [--json]
"""
from __future__ import annotations

import argparse
import json
import os
import re
import socket
import stat
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from agent_guard import audit_log, config, killswitch  # noqa: E402
from agent_guard.redact import fingerprint  # noqa: E402

DEFAULT_ROOTS = ["/workspace", "/home/box", "/tmp", "/etc", "/root", "/opt"]
SKIP_DIRS = {".venv", "venv", "node_modules", "__pycache__", ".git", "site-packages", "dist-packages", ".cache",
             ".mypy_cache", ".pytest_cache", "Cache", "Code Cache", "GPUCache", "Service Worker", "IndexedDB",
             "backups", "proc", "sys", "extensions", "managed-skills", "browser-profiles", "chromium", "chrome-profile",
             "plugin-skills", "google-chrome-headless", "google-chrome", "chromium-browser", "node-compile-cache",
             "ZxcvbnData", "hyphen-data", "CRX_INSTALL", "_metadata"}
SKIP_DIR_PREFIXES = ("scoped_dir", ".org.chromium", "puppeteer_dev_profile")
SKIP_PREFIXES = ("/opt/sand", "/workspace/agent-guard/agent_guard", "/workspace/agent-guard/tests",
                 "/workspace/agent-guard/reports", "/workspace/agent-guard/backups", "/proc", "/sys")
PLATFORM_PREFIXES = ("/home/box/sand-data", "/home/box/agent-data", "/tmp/exec-daemon")
TEXT_EXT = {".py", ".mq5", ".mq4", ".mqh", ".json", ".toml", ".yaml", ".yml", ".ini", ".cfg", ".conf", ".env",
            ".txt", ".md", ".sh", ".js", ".ts", ".csv", ".jsonl", ""}
MAX_BYTES = 2_000_000
MAX_LINE = 2000          # long minified/base64 lines made regexes crawl (Nov 9 hang)
SCAN_BUDGET_SEC = 240    # hard wall-clock budget for the secret scan; partial results are flagged
WORDLIST_HINT = set("abandon ability able about above absent absorb abstract absurd abuse access accident account "
                    "accuse achieve acid acoustic acquire across act action actor actress actual adapt add addict "
                    "zoo zone youth young wrong world word wolf witness wisdom wine wild wife".split())

KV_RE = re.compile(r"""(?ix)(?<![A-Za-z0-9_\-])(?P<key>[A-Za-z0-9_\-]{0,40}(?:api[_-]?key|api[_-]?secret|secret[_-]?key|secret|passphrase|
    password|passwd|access[_-]?token|auth[_-]?token|bearer|private[_-]?key|priv[_-]?key|mnemonic|seed[_-]?phrase|
    webhook[_-]?url|key[_-]?hex))["']?\s*[:=]\s*["']?(?P<val>[^\s"',}#();=<>]{8,})""")
PATTERNS = [
    ("pem_private_key", re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH |ENCRYPTED )?PRIVATE KEY-----"), "CRITICAL"),
    ("evm_private_key", re.compile(r"(?i)(?:priv|private|secret|key|pk)\w*\W{1,4}(0x)?[a-f0-9]{64}\b"), "CRITICAL"),
    ("solana_keypair_array", re.compile(r"\[(\s*\d{1,3}\s*,){63}\s*\d{1,3}\s*\]"), "CRITICAL"),
    ("base58_secret_labelled", re.compile(r"(?i)(?:secret|private|priv|keypair)\w*\W{1,4}[1-9A-HJ-NP-Za-km-z]{80,90}\b"),
     "CRITICAL"),
    ("discord_webhook", re.compile(r"https://(?:discord|discordapp)\.com/api/webhooks/\d+/[\w-]+"), "HIGH"),
    ("aws_access_key", re.compile(r"\bAKIA[0-9A-Z]{16}\b"), "HIGH"),
    ("github_token", re.compile(r"\bgh[pousr]_[A-Za-z0-9]{30,}\b"), "HIGH"),
    ("slack_token", re.compile(r"\bxox[baprs]-[A-Za-z0-9-]{10,}"), "HIGH"),
    ("telegram_bot_token", re.compile(r"\b\d{8,10}:AA[A-Za-z0-9_-]{30,}\b"), "HIGH"),
    ("rpc_url_with_key", re.compile(r"(?i)https?://[^\s\"']*(?:api[-_]?key|apikey|token)=[A-Za-z0-9-]{16,}"), "MEDIUM"),
]
PLACEHOLDER = re.compile(r"(?i)^(x+|\*+|changeme|your[_-].*|<.*>|\$\{.*\}|example|dummy|test.*|fake.*|none|null|"
                         r"redacted|env|os\.environ.*|getenv.*|settings\..*|self\..*|cfg\..*|str|bool|int|true|false)$")
PLATFORM_FILES = {"/home/box/agent-data/gateway.json", "/home/box/agent-data/host-secrets.json",
                  "/home/box/agent-data/source-map.json"}
TRADING_HINTS = {
    "private_endpoint": re.compile(r"(?i)(/v5/order/create|/v5/asset/withdraw|/api/v1/trade/order|/asset/transfer|"
                                   r"withdraw\(|create_order\(|place_order\(|order_send\(|private_post|privatePost)"),
    "signing": re.compile(r"(?i)\b(hmac\.new|sign_transaction|signTransaction|Keypair\.from|from_secret_key|"
                          r"eth_account|web3\.eth\.send|send_raw_transaction|solders\.keypair)"),
    "llm_prompt": re.compile(r"(?i)\b(openai|anthropic|chat\.completions|messages\.create|ollama|langchain|"
                             r"system_prompt|ChatCompletion)\b"),
    "agent_guard": re.compile(r"agent_guard|agent-guard"),
}
EXTERNAL_TEXT = re.compile(r"(?i)(pump\.fun|frontend-api|tweet|x_backfill|telegram|discord|raw_posts|inbox|status_line|"
                           r"metadata|token_name|\bname\b.*symbol)")


def iter_files(roots):
    for root in roots:
        if not os.path.exists(root):
            continue
        for dp, dns, fns in os.walk(root, followlinks=False):
            dns[:] = [d for d in dns if d not in SKIP_DIRS and not d.startswith(".venv")
                      and not d.startswith(SKIP_DIR_PREFIXES)]
            if dp.startswith(SKIP_PREFIXES):
                dns[:] = []
                continue
            for fn in fns:
                p = os.path.join(dp, fn)
                try:
                    st = os.lstat(p)
                except OSError:
                    continue
                if not stat.S_ISREG(st.st_mode) or st.st_size > MAX_BYTES:
                    continue
                ext = os.path.splitext(fn)[1].lower()
                if ext in TEXT_EXT or fn.startswith(".env") or fn in {"credentials", "config"} or fn.endswith("_history"):
                    yield p, st


def is_test(path):
    return "/tests/" in path or os.path.basename(path).startswith("test_")


def scan_secrets(roots, budget=SCAN_BUDGET_SEC):
    hits, perms = [], []
    t0 = time.time()
    for p, st in iter_files(roots):
        if time.time() - t0 > budget:
            hits.append({"severity": "MEDIUM", "path": p, "line": 0, "type": "scan_budget_exceeded", "fingerprint": None,
                         "note": f"secret scan stopped after {budget}s; results partial"})
            break
        try:
            text = open(p, encoding="utf-8", errors="ignore").read()
        except OSError:
            continue
        found = False
        for i, line in enumerate(text.splitlines(), 1):
            if len(line) > MAX_LINE:
                line = line[:MAX_LINE]
            for name, rx, sev in PATTERNS:
                m = rx.search(line)
                if not m:
                    continue
                if name == "base58_secret_labelled" and "signature" in line.lower():
                    continue
                loc_only = sev == "CRITICAL"
                if p.startswith(PLATFORM_PREFIXES):
                    sev = "INFO-platform"
                hits.append({"severity": "LOW" if is_test(p) else sev, "path": p, "line": i, "type": name,
                             "fingerprint": None if loc_only else fingerprint(m.group(0)),
                             "note": "location only (key material never read out)" if loc_only else ""})
                found = True
            m = KV_RE.search(line)
            if m and not PLACEHOLDER.match(m.group("val")) and not m.group("val").startswith(("os.", "{", "$", "(")):
                val = m.group("val")
                if re.fullmatch(r"[A-Za-z_][A-Za-z0-9_.\[\]()]*", val) and not re.search(r"\d", val):
                    continue  # identifier / variable, not a literal
                sev = "LOW" if is_test(p) else ("INFO-platform" if p in PLATFORM_FILES or p.startswith(PLATFORM_PREFIXES)
                                                 else "HIGH")
                loc_only = re.search(r"(?i)priv|mnemonic|seed|hex", m.group("key")) is not None
                hits.append({"severity": sev, "path": p, "line": i, "type": f"kv:{m.group('key').lower()}",
                             "fingerprint": None if loc_only else fingerprint(val),
                             "note": "location only" if loc_only else ""})
                found = True
            words = re.findall(r"\b[a-z]{3,8}\b", line)
            if len(words) in (12, 15, 18, 21, 24) and len(words) == len(line.split()) and \
                    sum(w in WORDLIST_HINT for w in words) >= 3:
                hits.append({"severity": "CRITICAL", "path": p, "line": i, "type": "possible_seed_phrase",
                             "fingerprint": None, "note": "location only - verify by hand, do not paste anywhere"})
                found = True
        if found and (st.st_mode & 0o077) and not p.startswith(PLATFORM_PREFIXES) and not is_test(p) and \
                any(h["path"] == p and h["severity"] in ("CRITICAL", "HIGH") for h in hits):
            perms.append({"path": p, "mode": oct(st.st_mode & 0o777), "fix": "chmod 600"})
    return hits, perms


def env_names():
    """Secret-looking env var NAMES per process (values never read into output)."""
    rx = re.compile(r"(?i)(key|secret|token|pass|seed|mnemonic|private|webhook)")
    out = []
    for pid in filter(str.isdigit, os.listdir("/proc")):
        try:
            raw = open(f"/proc/{pid}/environ", "rb").read()
            cmd = open(f"/proc/{pid}/cmdline", "rb").read().replace(b"\0", b" ").decode(errors="ignore")[:120]
        except OSError:
            continue
        names = sorted({kv.split(b"=", 1)[0].decode(errors="ignore") for kv in raw.split(b"\0") if b"=" in kv})
        sec = [n for n in names if rx.search(n)]
        if sec:
            out.append({"pid": int(pid), "cmd": cmd, "secret_like_env_names": sec})
    return out


def _socket_owners():
    own = {}
    for pid in filter(str.isdigit, os.listdir("/proc")):
        try:
            fds = os.listdir(f"/proc/{pid}/fd")
            cmd = open(f"/proc/{pid}/cmdline", "rb").read().replace(b"\0", b" ").decode(errors="ignore")[:100]
        except OSError:
            continue
        for fd in fds:
            try:
                t = os.readlink(f"/proc/{pid}/fd/{fd}")
            except OSError:
                continue
            if t.startswith("socket:["):
                own[t[8:-1]] = cmd.strip()
    return own


def listening_ports():
    res = []
    owners = _socket_owners()
    for fn, fam in (("/proc/net/tcp", "v4"), ("/proc/net/tcp6", "v6")):
        try:
            rows = open(fn).read().splitlines()[1:]
        except OSError:
            continue
        for r in rows:
            parts = r.split()
            if parts[3] != "0A":
                continue
            addr, port = parts[1].split(":")
            port = int(port, 16)
            if fam == "v4":
                ip = socket.inet_ntop(socket.AF_INET, bytes.fromhex(addr)[::-1])
            else:
                b = bytes.fromhex(addr)
                ip = socket.inet_ntop(socket.AF_INET6, b"".join(b[i:i + 4][::-1] for i in range(0, 16, 4)))
            loop = ip.startswith("127.") or ip == "::1"
            owner = owners.get(parts[9], "")
            agent_owned = "/workspace/" in owner
            if port == 2375 and not loop:
                sev, note = "HIGH", "Docker Engine API without TLS/auth = root-equivalent; platform-owned"
            elif not loop and agent_owned:
                sev, note = "MEDIUM", "agent service bound to all interfaces"
            elif not loop:
                sev, note = "INFO-platform", "platform sandbox service (not visible to this uid)" if not owner else \
                    "platform sandbox service"
            else:
                sev, note = "INFO", ""
            note = (note + f" [{owner[:60]}]") if owner else note
            res.append({"addr": ip, "port": port, "public_bind": not loop, "severity": sev, "note": note})
    uniq = {(r["addr"], r["port"]): r for r in res}
    return sorted(uniq.values(), key=lambda r: r["port"])


def hud_token_check():
    out = []
    for pid in filter(str.isdigit, os.listdir("/proc")):
        try:
            cmd = open(f"/proc/{pid}/cmdline", "rb").read().replace(b"\0", b" ").decode(errors="ignore")
            if " hud" not in cmd or "aai" not in cmd:
                continue
            names = {kv.split(b"=", 1)[0] for kv in open(f"/proc/{pid}/environ", "rb").read().split(b"\0")}
        except OSError:
            continue
        out.append({"pid": int(pid), "cmd": cmd.strip()[:120], "AAI_HUD_TOKEN_set": b"AAI_HUD_TOKEN" in names})
    return out


def trading_inventory(roots):
    inv = []
    for root in roots:
        if not os.path.isdir(root):
            continue
        for p, _ in iter_files([root]):
            if not p.endswith((".py", ".mq5", ".mq4", ".mqh", ".js", ".ts")) or "/agent-guard/" in p:
                continue
            try:
                text = open(p, encoding="utf-8", errors="ignore").read()
            except OSError:
                continue
            tags = {k: bool(rx.search(text)) for k, rx in TRADING_HINTS.items()}
            if is_test(p):
                continue
            if tags["private_endpoint"] or tags["signing"] or tags["llm_prompt"]:
                inv.append({"path": p, **tags,
                            "severity": "HIGH" if (tags["private_endpoint"] or tags["signing"]) and not tags["agent_guard"]
                            else "INFO"})
    return inv


def external_text_feeds(roots):
    feeds = []
    for root in roots:
        for p, _ in iter_files([root]):
            if not p.endswith(".py") or is_test(p) or "/agent-guard/" in p:
                continue
            try:
                text = open(p, encoding="utf-8", errors="ignore").read()
            except OSError:
                continue
            if EXTERNAL_TEXT.search(text) and re.search(r"(?i)(requests\.get|httpx|urlopen|json\.load|read_text|open\()", text):
                feeds.append({"path": p, "sanitized_with_agent_guard": "agent_guard" in text})
    return feeds


def misc_checks():
    out = {}
    out["dotenv_files"] = [p for p, _ in iter_files(["/workspace", "/home/box"])
                           if os.path.basename(p).startswith(".env")][:50]
    out["shell_history"] = [str(p) for p in Path("/home/box").glob(".*history") if p.is_file()]
    out["crontabs"] = [str(p) for p in Path("/var/spool/cron").glob("**/*") if p.is_file()] if \
        os.path.isdir("/var/spool/cron") else []
    out["user_systemd_units"] = [str(p) for p in Path("/home/box/.config/systemd/user").glob("*")] if \
        os.path.isdir("/home/box/.config/systemd/user") else []
    gits = []
    for g in Path("/workspace").glob("*/.git"):
        try:
            remotes = subprocess.run(["git", "-C", str(g.parent), "remote", "-v"], capture_output=True, text=True,
                                     timeout=10).stdout.split()
            n = subprocess.run(["git", "-C", str(g.parent), "log", "--all", "-p", "-G",
                                r"(api_?secret|private_?key|mnemonic|BEGIN .*PRIVATE KEY|AKIA[0-9A-Z]{16})"],
                               capture_output=True, text=True, timeout=60).stdout.count("\ncommit ")
            gits.append({"repo": str(g.parent), "remotes": len(remotes) // 3, "commits_touching_secret_patterns": n})
        except Exception as exc:  # noqa: BLE001
            gits.append({"repo": str(g.parent), "error": type(exc).__name__})
    out["git"] = gits
    return out


def guard_status():
    st = {"killswitch": killswitch.status(), "audit_log": audit_log.verify()}
    try:
        cfg = config.load()
        st["config"] = {"ok": True, "agents": sorted(cfg["agents"]),
                        "money_movement_allowed_destinations": len(cfg.get("money_movement", {})
                                                                   .get("allowed_destinations", []))}
    except Exception as exc:  # noqa: BLE001
        st["config"] = {"ok": False, "error": str(exc)}
    st["state_perms"] = {str(p): oct(p.stat().st_mode & 0o777) for p in (HERE / "state").glob("*") if p.is_file()}
    return st


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--roots", nargs="*", default=DEFAULT_ROOTS)
    ap.add_argument("--json", action="store_true", help="print full JSON to stdout")
    ap.add_argument("--budget", type=int, default=SCAN_BUDGET_SEC, help="secret-scan time budget in seconds")
    a = ap.parse_args(argv)
    t0 = time.time()
    secrets, perms = scan_secrets(a.roots, a.budget)
    rep = {
        "generated_at": time.strftime("%Y-%m-%d %H:%M:%S %Z"),
        "roots": a.roots,
        "secret_hits": secrets,
        "loose_permissions_on_secret_files": perms,
        "process_secret_env_names": env_names(),
        "listening_ports": listening_ports(),
        "aai_hud": hud_token_check(),
        "trading_code": trading_inventory(["/workspace"]),
        "external_text_feeds": external_text_feeds(["/workspace"]),
        "misc": misc_checks(),
        "agent_guard": guard_status(),
    }
    sev = [h["severity"] for h in secrets] + [p["severity"] for p in rep["listening_ports"]] + \
          [t["severity"] for t in rep["trading_code"]] + (["MEDIUM"] if any(not h["AAI_HUD_TOKEN_set"]
                                                                            for h in rep["aai_hud"]) else []) + \
          (["HIGH"] * len(perms))
    rep["summary"] = {s: sev.count(s) for s in ("CRITICAL", "HIGH", "MEDIUM", "LOW")}
    rep["elapsed_sec"] = round(time.time() - t0, 1)
    out = HERE / "reports"
    out.mkdir(exist_ok=True)
    ts = time.strftime("%Y%m%dT%H%M%S")
    jp = out / f"audit_{ts}.json"
    fd = os.open(jp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as f:
        json.dump(rep, f, indent=1, default=str)
    md = [f"# agent-guard audit {rep['generated_at']}", "", f"Summary: {rep['summary']}", "",
          f"Kill switch: {'ENGAGED' if rep['agent_guard']['killswitch']['engaged'] else 'off'}; "
          f"audit log ok={rep['agent_guard']['audit_log']['ok']}; config ok={rep['agent_guard']['config']['ok']}", "",
          "## Secret hits (redacted)"]
    md += [f"- {h['severity']} {h['type']} {h['path']}:{h['line']} {h['fingerprint'] or ''} {h['note']}"
           for h in secrets if h["severity"] != "LOW"] or ["- none outside tests"]
    md += ["", "## Public listeners"] + [f"- {p['severity']} {p['addr']}:{p['port']} {p['note']}"
                                          for p in rep["listening_ports"] if p["public_bind"]]
    md += ["", "## AAI HUD"] + [f"- pid {h['pid']} AAI_HUD_TOKEN set={h['AAI_HUD_TOKEN_set']}" for h in rep["aai_hud"]]
    md += ["", "## Code with order/signing/LLM paths"] + [
        f"- {t['severity']} {t['path']} private={t['private_endpoint']} signing={t['signing']} "
        f"llm={t['llm_prompt']} agent_guard={t['agent_guard']}" for t in rep["trading_code"]]
    md += ["", "## External-text feed points"] + [
        f"- {f['path']} sanitized={f['sanitized_with_agent_guard']}" for f in rep["external_text_feeds"]]
    md += ["", f"Full JSON: {jp}"]
    (out / "latest.md").write_text("\n".join(md) + "\n")
    os.chmod(out / "latest.md", 0o600)
    audit_log.append("audit_run", "security", {"summary": rep["summary"], "report": str(jp)}, outcome="ok")
    print(json.dumps(rep, indent=1, default=str) if a.json else "\n".join(md))
    return 2 if rep["summary"]["CRITICAL"] else (1 if rep["summary"]["HIGH"] else 0)


if __name__ == "__main__":
    sys.exit(main())
