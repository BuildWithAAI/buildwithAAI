#!/usr/bin/env python3
"""Read-only zoora.ai security monitor. Never prints secret values. Never deploys or changes DNS/Fly/GitHub."""
from __future__ import annotations

import csv
import hashlib
import io
import json
import os
import re
import shutil
import subprocess
import ssl
import sys
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

TZ = ZoneInfo("America/Chicago")
MONITOR = Path("/workspace/agent-guard/monitor/zoora")
DNSTWIST_VENV = MONITOR / "venv"
DNSTWIST_BIN_PATH = DNSTWIST_VENV / "bin" / "dnstwist"
TOOLS = Path("/tmp/zsec-tools")
GITLEAKS = TOOLS / "gitleaks"
CLONE = Path("/tmp/zoora-watch")
REPO_URL = "https://github.com/BuildWithAAI/buildwithAAI.git"
REPO_SLUG = "BuildWithAAI/buildwithAAI"
FLY_APP = "lumen-tidepool.fly.dev"
GH_PAGES_A = {"185.199.108.153", "185.199.109.153", "185.199.110.153", "185.199.111.153"}
WWW_CNAME_EXPECTED = "buildwithaai.github.io."
DNS_NAMES = ["zoora.ai", "www.zoora.ai", "_dmarc.zoora.ai", "world.zoora.ai"]
INFO_NAMES = [FLY_APP]
DNS_TYPES = ["A", "AAAA", "CNAME", "MX", "TXT", "CAA", "NS", "DS"]
EXPECTED_ISSUER = "let's encrypt"
TLS_WARN_DAYS = 21
PLACEHOLDER_SECRETS = {"REDACTED", "XXXXXXXX", "CHANGEME", "PLACEHOLDER", "YOUR_API_KEY", "YOUR-API-KEY"}
HEADER_NAMES = [
    "content-security-policy",
    "strict-transport-security",
    "x-frame-options",
    "x-content-type-options",
    "referrer-policy",
    "permissions-policy",
]
CLOSED_PATHS = ["/admin", "/admin/login", "/admin/ledger", "/.env"]
UA = "zoora-monitor/1.0 (+read-only; zoora.ai security monitor)"
GITLEAKS_VERSION = "8.30.1"
CTX = ssl.create_default_context()
RESULT_PATH = Path("/tmp/zoora-monitor-result.json")
LOG_PATH = Path("/tmp/zoora-monitor-internal.log")
TYPE_NUM = {"A": 1, "NS": 2, "CNAME": 5, "MX": 15, "TXT": 16, "AAAA": 28, "DS": 43, "CAA": 257}


def now_chicago() -> datetime:
    return datetime.now(TZ)


def iso(dt: datetime | None = None) -> str:
    return (dt or now_chicago()).isoformat()


def is_morning(dt: datetime) -> bool:
    return dt.hour < 13


def log(msg: str) -> None:
    with LOG_PATH.open("a", encoding="utf-8") as f:
        f.write(f"{now_chicago().strftime('%H:%M:%S')} {msg}\n")


def read_json(path: Path, default: Any = None) -> Any:
    if not path.exists():
        return default
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception as e:
        log(f"warn: failed to read {path}: {e}")
        return default


def write_json(path: Path, data: Any) -> None:
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(data, indent=2, default=str) + "\n", encoding="utf-8")
    tmp.replace(path)


def http_get(url: str, timeout: int = 45, headers: dict[str, str] | None = None, retries: int = 4) -> bytes:
    hdrs = {"User-Agent": UA, "Accept": "*/*"}
    if headers:
        hdrs.update(headers)
    last_err: Exception | None = None
    for i in range(retries):
        try:
            req = urllib.request.Request(url, headers=hdrs)
            with urllib.request.urlopen(req, timeout=timeout, context=CTX) as resp:
                return resp.read()
        except Exception as e:
            last_err = e
            log(f"http_get retry {i+1}/{retries} {url} -> {type(e).__name__}: {e}")
            time.sleep(1.5 * (i + 1))
            if i == 1:
                hdrs["User-Agent"] = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    raise RuntimeError(f"GET failed {url}: {last_err}")


def run(cmd: list[str] | str, timeout: int = 120, cwd: str | None = None, env: dict | None = None) -> subprocess.CompletedProcess:
    e = os.environ.copy()
    e["GIT_TERMINAL_PROMPT"] = "0"
    e["GIT_ASKPASS"] = "echo"
    e["GCM_INTERACTIVE"] = "never"
    if env:
        e.update(env)
    try:
        return subprocess.run(
            cmd, cwd=cwd, env=e, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            timeout=timeout, shell=isinstance(cmd, str),
        )
    except FileNotFoundError as exc:
        name = exc.filename or (cmd[0] if isinstance(cmd, list) else str(cmd))
        return subprocess.CompletedProcess(cmd, 127, stdout="", stderr=f"No such file or directory: {name}")


def _strip_txt(val: str) -> str:
    v = val.strip()
    if len(v) >= 2 and v[0] == '"' and v[-1] == '"':
        v = v[1:-1].replace('\\"', '"')
    return v


def _answers_of_type(answers: list, typ: str, qname: str) -> list[str]:
    want = TYPE_NUM[typ]
    out = []
    qn = qname.rstrip(".").lower()
    for a in answers:
        if a.get("type") != want:
            continue
        # For CNAME, only the name itself (not target chain aliases of other types)
        if typ == "CNAME":
            name = str(a.get("name") or "").rstrip(".").lower()
            if name and name != qn:
                continue
        data = a.get("data")
        if data is None:
            continue
        if typ == "TXT":
            data = _strip_txt(str(data))
        out.append(str(data))
    return sorted(set(out))


def doh_query(name: str, typ: str) -> dict[str, Any]:
    url = f"https://dns.google/resolve?name={name}&type={typ}"
    try:
        data = json.loads(http_get(url, timeout=20, retries=3).decode())
        answers = data.get("Answer") or []
        authority = data.get("Authority") or []
        return {
            "Status": data.get("Status"),
            "Answer": _answers_of_type(answers, typ, name),
            "Comment": data.get("Comment"),
            "Authority": [a.get("data") for a in authority if a.get("data")],
        }
    except Exception as e:
        try:
            url2 = f"https://cloudflare-dns.com/dns-query?name={name}&type={typ}"
            data = json.loads(http_get(url2, timeout=20, headers={"Accept": "application/dns-json"}, retries=2).decode())
            answers = data.get("Answer") or []
            return {
                "Status": data.get("Status"),
                "Answer": _answers_of_type(answers, typ, name),
                "Comment": "cloudflare-dns",
                "Authority": [],
            }
        except Exception as e2:
            log(f"doh failed {name} {typ}: {e} / {e2}")
            return {"Status": None, "Answer": [], "error": f"{type(e).__name__}/{type(e2).__name__}", "Authority": [], "Comment": None}


def collect_dns() -> dict[str, Any]:
    queries: dict[str, Any] = {}
    for n in DNS_NAMES + INFO_NAMES:
        queries[n] = {}
        for t in DNS_TYPES:
            queries[n][t] = doh_query(n, t)
            time.sleep(0.05)
    return {"collected_at": iso(), "queries": queries}


def normalize_dns(queries: dict[str, Any]) -> dict[str, Any]:
    norm: dict[str, Any] = {}
    for n, types in queries.items():
        typemap: dict[str, list[str]] = {}
        cname = list((types.get("CNAME") or {}).get("Answer") or [])
        all_nx = all((types.get(t) or {}).get("Status") == 3 for t in DNS_TYPES)
        if all_nx:
            norm[n] = {"nxdomain": True, "types": {t: [] for t in DNS_TYPES}}
            continue
        if cname and n != "zoora.ai":
            typemap["CNAME"] = sorted(set(cname))
            norm[n] = {"nxdomain": False, "types": typemap}
            continue
        for t in DNS_TYPES:
            typemap[t] = sorted(set((types.get(t) or {}).get("Answer") or []))
        norm[n] = {"nxdomain": False, "types": typemap}
    return norm


def describe_dns_diff(d: dict) -> str:
    if d.get("change") == "nxdomain":
        return f"{d['name']} NXDOMAIN changed {d.get('from')} -> {d.get('to')}"
    return f"{d['name']} {d.get('type')} changed from {d.get('from')} to {d.get('to')}"


def dns_diffs(current_norm: dict, baseline_norm: dict) -> list[dict]:
    diffs = []
    names = list(dict.fromkeys(list(baseline_norm.keys()) + list(current_norm.keys())))
    for n in names:
        cur = current_norm.get(n) or {"nxdomain": True, "types": {}}
        base = baseline_norm.get(n) or {"nxdomain": True, "types": {}}
        if cur.get("nxdomain") != base.get("nxdomain"):
            diffs.append({"name": n, "change": "nxdomain", "from": base.get("nxdomain"), "to": cur.get("nxdomain")})
        base_types = base.get("types") or {}
        cur_types = cur.get("types") or {}
        if list(base_types.keys()) == ["CNAME"] or (base_types.get("CNAME") and str(n).startswith("www.")):
            if set(cur_types.get("CNAME") or []) != set(base_types.get("CNAME") or []):
                diffs.append({"name": n, "type": "CNAME", "from": base_types.get("CNAME") or [], "to": cur_types.get("CNAME") or []})
            continue
        for t in sorted(set(base_types) | set(cur_types)):
            a = sorted(set(base_types.get(t) or []))
            b = sorted(set(cur_types.get(t) or []))
            if a != b:
                diffs.append({"name": n, "type": t, "from": a, "to": b})
    return diffs


def points_to_github_pages(norm: dict) -> bool:
    apex = (norm.get("zoora.ai") or {}).get("types") or {}
    www = (norm.get("www.zoora.ai") or {}).get("types") or {}
    a = set(apex.get("A") or [])
    cname = []
    for c in www.get("CNAME") or []:
        cname.append(c if c.endswith(".") else c + ".")
    apex_is_gh = bool(a) and a.issubset(GH_PAGES_A)
    www_is_gh = WWW_CNAME_EXPECTED in cname or any(c.rstrip(".").endswith("github.io") for c in cname)
    if not cname:
        www_a = set(www.get("A") or [])
        www_is_gh = bool(www_a) and www_a.issubset(GH_PAGES_A)
    return bool(apex_is_gh or www_is_gh)


def points_to_fly(norm: dict, queries: dict) -> bool:
    def recs(name: str) -> list[str]:
        types = (norm.get(name) or {}).get("types") or {}
        out: list[str] = []
        for t in ("A", "AAAA", "CNAME"):
            out.extend(types.get(t) or [])
        return out
    hay = " ".join(recs("zoora.ai") + recs("www.zoora.ai")).lower()
    if "fly.dev" in hay or "fly.io" in hay or "flydns" in hay:
        return True
    fly_q = queries.get(FLY_APP) or {}
    fly_a = set((fly_q.get("A") or {}).get("Answer") or [])
    fly_aaaa = set((fly_q.get("AAAA") or {}).get("Answer") or [])
    apex_a = set(((norm.get("zoora.ai") or {}).get("types") or {}).get("A") or [])
    apex_aaaa = set(((norm.get("zoora.ai") or {}).get("types") or {}).get("AAAA") or [])
    if fly_a and apex_a and apex_a & fly_a:
        return True
    if fly_aaaa and apex_aaaa and apex_aaaa & fly_aaaa:
        return True
    return False


def fly_app_resolves(queries: dict) -> bool:
    q = queries.get(FLY_APP) or {}
    return bool((q.get("A") or {}).get("Answer") or (q.get("AAAA") or {}).get("Answer"))


def collect_certs() -> dict[str, Any] | None:
    urls = [
        "https://crt.sh/?q=%25.zoora.ai&output=json",
        "https://crt.sh/?q=zoora.ai&output=json",
    ]
    for url in urls:
        try:
            raw = http_get(url, timeout=60, retries=4, headers={"Accept": "application/json"})
            text = raw.decode("utf-8", "replace").strip()
            if not text.startswith("[") and not text.startswith("{"):
                log(f"crt.sh non-json from {url}: {text[:80]!r}")
                continue
            certs = json.loads(text)
            if not isinstance(certs, list):
                continue
            uniq: dict[Any, dict] = {}
            for c in certs:
                cid = c.get("id")
                uniq[cid] = {
                    "id": cid,
                    "logged_at": c.get("entry_timestamp") or c.get("logged_at"),
                    "not_before": c.get("not_before"),
                    "not_after": c.get("not_after"),
                    "name_value": c.get("name_value"),
                    "issuer_name": c.get("issuer_name"),
                    "common_name": c.get("common_name"),
                    "serial_number": c.get("serial_number"),
                }
            return {"collected_at": iso(), "count": len(uniq), "certs": list(uniq.values())}
        except Exception as e:
            log(f"crt.sh failed {url}: {e}")
    return None


def issuer_unexpected(issuer: str | None) -> bool:
    if not issuer:
        return True
    return EXPECTED_ISSUER not in issuer.lower()

def curl_head(url: str, timeout: int = 15) -> tuple:
    cmd = ["curl", "-sSI", "-m", str(timeout), "--compressed", "-D", "-", "-o", "/dev/null", "-w", "%{http_code}", url]
    try:
        p = run(cmd, timeout=timeout + 5)
        body = p.stdout or ""
        lines = body.splitlines()
        code = None
        if lines and lines[-1].isdigit():
            code = int(lines[-1])
            hdr = "\n".join(lines[:-1])
        else:
            hdr = body
        return code, hdr, (p.stderr or "").strip()
    except Exception as e:
        return None, "", str(e)


def curl_body(url: str, timeout: int = 15) -> tuple:
    cmd = ["curl", "-sS", "-m", str(timeout), "-w", "\n%{http_code}", url]
    try:
        p = run(cmd, timeout=timeout + 5)
        out = p.stdout or ""
        if "\n" in out:
            body, code_s = out.rsplit("\n", 1)
            code = int(code_s) if code_s.isdigit() else None
        else:
            body, code = out, None
        return code, body, (p.stderr or "").strip()
    except Exception as e:
        return None, "", str(e)


def curl_code(url: str, timeout: int = 15):
    cmd = ["curl", "-sS", "-o", "/dev/null", "-m", str(timeout), "-w", "%{http_code}", url]
    try:
        p = run(cmd, timeout=timeout + 5)
        s = (p.stdout or "").strip()
        return int(s) if s.isdigit() else None
    except Exception:
        return None


def parse_headers(hdr_text: str) -> dict[str, str]:
    found: dict[str, str] = {}
    blocks = re.split(r"\r?\n\r?\n", hdr_text.strip())
    last = blocks[-1] if blocks else hdr_text
    if not last.strip() and len(blocks) >= 2:
        last = blocks[-2]
    for line in last.splitlines():
        if ":" not in line:
            continue
        k, v = line.split(":", 1)
        found[k.strip().lower()] = v.strip()
    return found


def header_issues(host: str, headers: dict[str, str]) -> list[dict]:
    issues = []
    csp = headers.get("content-security-policy", "")
    xfo = headers.get("x-frame-options", "")
    fa = ""
    if csp:
        m = re.search(r"frame-ancestors\s+([^;]+)", csp, re.I)
        if m:
            fa = m.group(1).strip()
    for k in HEADER_NAMES:
        if k == "x-frame-options":
            if not xfo and not fa:
                issues.append({"host": host, "header": k, "issue": "missing (no X-Frame-Options and no CSP frame-ancestors)"})
            continue
        if k not in headers:
            issues.append({"host": host, "header": k, "issue": "missing"})
            continue
        if k == "x-content-type-options" and "nosniff" not in headers[k].lower():
            issues.append({"host": host, "header": k, "issue": f"expected nosniff, got {headers[k][:80]}"})
    return issues


def tls_probe(host: str) -> dict[str, Any]:
    cmd = f"echo | openssl s_client -servername {host} -connect {host}:443 2>/dev/null | openssl x509 -noout -enddate -issuer -subject -serial"
    try:
        p = run(cmd, timeout=25)
        text = p.stdout or ""
        enddate = issuer = subject = serial = None
        for line in text.splitlines():
            if line.startswith("notAfter="):
                enddate = line.split("=", 1)[1].strip()
            elif line.startswith("issuer="):
                issuer = line.split("=", 1)[1].strip()
            elif line.startswith("subject="):
                subject = line.split("=", 1)[1].strip()
            elif line.startswith("serial="):
                serial = line.split("=", 1)[1].strip()
        days = not_after_iso = None
        if enddate:
            dt = None
            for fmt in ("%b %d %H:%M:%S %Y %Z", "%b %d %H:%M:%S %Y GMT"):
                try:
                    dt = datetime.strptime(enddate, fmt).replace(tzinfo=timezone.utc)
                    break
                except Exception:
                    pass
            if dt:
                not_after_iso = dt.isoformat()
                days = (dt - datetime.now(timezone.utc)).total_seconds() / 86400.0
        return {"host": host, "ok": bool(enddate), "not_after": enddate, "not_after_iso": not_after_iso, "days_left": days, "issuer": issuer, "subject": subject, "serial": serial, "raw_error": (p.stderr or "")[:200] if not enddate else ""}
    except Exception as e:
        return {"host": host, "ok": False, "error": str(e)}


def chrome_csp(url: str) -> dict[str, Any]:
    cmd = [
        "timeout", "40", "google-chrome", "--headless=new", "--no-sandbox", "--disable-gpu",
        "--enable-logging=stderr", "--log-level=0", "--virtual-time-budget=5000", "--dump-dom", url,
    ]
    try:
        p = run(cmd, timeout=50)
        err = (p.stderr or "") + "\n" + (p.stdout or "")
        lines = [ln for ln in err.splitlines() if re.search(r"Content Security Policy", ln, re.I)]
        sample = [re.sub(r"https?://\S+", "[url]", ln)[:200] for ln in lines[:8]]
        return {"url": url, "violations": len(lines), "sample": sample, "exit": p.returncode}
    except Exception as e:
        return {"url": url, "violations": None, "error": str(e)}


def ensure_gitleaks():
    if GITLEAKS.exists() and os.access(GITLEAKS, os.X_OK):
        p = run([str(GITLEAKS), "version"], timeout=15)
        log("gitleaks present: " + (p.stdout or p.stderr or "").strip())
        return (p.stdout or p.stderr or "").strip() or "present"
    TOOLS.mkdir(parents=True, exist_ok=True)
    url = f"https://github.com/gitleaks/gitleaks/releases/download/v{GITLEAKS_VERSION}/gitleaks_{GITLEAKS_VERSION}_linux_x64.tar.gz"
    tar = Path("/tmp/gitleaks.tgz")
    try:
        tar.write_bytes(http_get(url, timeout=60, retries=3))
        p = run(["tar", "-tzf", str(tar)], timeout=15)
        names = (p.stdout or "").splitlines()
        run(["tar", "-xzf", str(tar), "-C", str(TOOLS)], timeout=30)
        cand = TOOLS / "gitleaks"
        if not cand.exists():
            for n in names:
                if n.endswith("gitleaks") or n == "gitleaks":
                    src = TOOLS / n
                    if src.exists():
                        shutil.copy(src, cand)
        if cand.exists():
            cand.chmod(0o755)
            p = run([str(cand), "version"], timeout=15)
            return (p.stdout or p.stderr or "").strip() or "installed"
    except Exception as e:
        log(f"gitleaks install failed: {e}")
    return None


def ensure_clone() -> bool:
    if CLONE.exists() and (CLONE / ".git").exists():
        p = run(["git", "-C", str(CLONE), "remote", "get-url", "origin"], timeout=15)
        url = (p.stdout or "").strip()
        if "buildwithAAI" not in url and "BuildWithAAI" not in url:
            shutil.rmtree(CLONE, ignore_errors=True)
        else:
            p = run(["git", "-C", str(CLONE), "fetch", "--all", "--prune", "--tags", "--force"], timeout=180)
            if p.returncode == 0:
                log("git fetch ok")
                return True
            log("git fetch failed: " + (p.stderr or "")[:300])
            shutil.rmtree(CLONE, ignore_errors=True)
    CLONE.parent.mkdir(parents=True, exist_ok=True)
    p = run(["git", "clone", REPO_URL, str(CLONE)], timeout=300)
    if p.returncode != 0:
        log("git clone failed: " + (p.stderr or "")[:400])
        return False
    return True


def list_remote_refs() -> list:
    p = run(["git", "-C", str(CLONE), "for-each-ref", "--format=%(objectname) %(refname:short)", "refs/remotes/origin"], timeout=30)
    rows = []
    for line in (p.stdout or "").splitlines():
        line = line.strip()
        if not line or " " not in line:
            continue
        sha, ref = line.split(" ", 1)
        ref = re.sub(r"^origin/", "", ref)
        if ref == "HEAD":
            continue
        rows.append((sha, ref))
    rows.sort(key=lambda x: x[1])
    return rows


def default_branch() -> str:
    p = run(["git", "-C", str(CLONE), "symbolic-ref", "refs/remotes/origin/HEAD"], timeout=15)
    s = (p.stdout or "").strip()
    if s.startswith("refs/remotes/origin/"):
        return s.rsplit("/", 1)[-1]
    return "main"


def lumen_pr_branch(prev_branch):
    refs = {ref for _, ref in list_remote_refs()}
    if prev_branch and prev_branch in refs:
        return prev_branch
    try:
        raw = http_get(f"https://api.github.com/repos/{REPO_SLUG}/pulls?state=open&per_page=100", timeout=30, retries=2)
        prs = json.loads(raw.decode())
        if isinstance(prs, list):
            scored = []
            for pr in prs:
                title = (pr.get("title") or "") + " " + (pr.get("head") or {}).get("ref", "")
                t = title.lower()
                score = sum(1 for kw in ("lumen", "zora", "zoora", "world", "jellyfish") if kw in t)
                if score:
                    scored.append((score, (pr.get("head") or {}).get("ref")))
            scored.sort(reverse=True)
            if scored and scored[0][1] in refs:
                return scored[0][1]
    except Exception as e:
        log(f"github pr list failed: {e}")
    for cand in refs:
        if "lumen-jellyfish" in cand:
            return cand
    return prev_branch


def gitleaks_scan(since_iso: str) -> dict[str, Any]:
    p = run(["git", "-C", str(CLONE), "rev-list", "--all", f"--since={since_iso}"], timeout=60)
    commits = [c for c in (p.stdout or "").splitlines() if re.fullmatch(r"[0-9a-f]{40}", c)]
    report = Path("/tmp/zoora-gitleaks-report.json")
    if report.exists():
        report.unlink()
    if not commits:
        return {"collected_at": iso(), "since": since_iso, "commits_in_rev_list": 0, "commits_scanned_by_gitleaks": 0, "findings": 0, "real_secrets": 0, "false_positives": 0, "report_empty": True, "items": [], "ok": True}
    p = run([str(GITLEAKS), "git", f"--log-opts=--all --since={since_iso}", "--redact", "-r", str(report), str(CLONE)], timeout=300)
    items = []
    if report.exists():
        try:
            txt = report.read_text(encoding="utf-8").strip()
            if txt:
                data = json.loads(txt)
                if isinstance(data, list):
                    items = data
                elif isinstance(data, dict) and "findings" in data:
                    items = data["findings"]
        except Exception as e:
            log(f"gitleaks report parse: {e}")
            return {"ok": False, "error": "report-parse-failed", "since": since_iso, "commits_in_rev_list": len(commits)}
    safe = []
    for it in items:
        if not isinstance(it, dict):
            continue
        safe.append({
            "rule": it.get("RuleID") or it.get("rule") or it.get("Description"),
            "file": it.get("File") or it.get("file"),
            "line": it.get("StartLine") or it.get("line"),
            "commit": (it.get("Commit") or it.get("commit") or "")[:40],
            "fingerprint": it.get("Fingerprint") or it.get("fingerprint"),
            "author": it.get("Author") or it.get("author"),
            "date": it.get("Date") or it.get("date"),
            "redacted": True,
            "placeholder": (str(it.get("Secret") or "").strip().strip("`'\"<>[]{}*").upper() in PLACEHOLDER_SECRETS),
        })
    return {"collected_at": iso(), "since": since_iso, "commits_in_rev_list": len(commits), "commits_scanned_by_gitleaks": len(commits), "findings": len(safe), "items": safe, "gitleaks_exit": p.returncode, "ok": True}


def classify_findings(items: list, known_fps: list):
    known = {fp.get("fingerprint") for fp in known_fps if fp.get("fingerprint")}
    real, fps = [], []
    for it in items:
        fp = it.get("fingerprint")
        path = (it.get("file") or "").lower()
        if fp in known:
            it["classification"] = "known_false_positive"
            fps.append(it)
            continue
        testish = bool(re.search(r"(^|/)(tests?|__tests__|testdata|fixtures?|proof)/", path) or path.endswith((".test.ts", ".test.tsx", ".test.js", ".spec.ts", ".spec.js", "injections.ts")))
        if testish and (it.get("rule") or "").lower() in {"generic-api-key", "generic"}:
            it["classification"] = "false_positive_synthetic_test_key_heuristic"
            it["reason"] = "Test file generic-api-key hit; treated as synthetic unless proven otherwise. Secret not printed."
            fps.append(it)
            continue
        if it.get("placeholder"):
            it["classification"] = "false_positive_placeholder"
            it["reason"] = "Matched value is a redaction/placeholder marker, not a credential. Secret not printed."
            fps.append(it)
            continue
        it["classification"] = "unreviewed_potential_secret"
        real.append(it)
    return real, fps

def ensure_dnstwist():
    for binp in (str(DNSTWIST_BIN_PATH), "dnstwist"):
        p = run([binp, "--version"], timeout=15)
        if p.returncode == 0:
            return (p.stdout or p.stderr or "").strip()
    py = sys.executable
    if not (DNSTWIST_VENV / "bin" / "python").exists():
        p = run([py, "-m", "venv", str(DNSTWIST_VENV)], timeout=120)
        if p.returncode != 0:
            log("dnstwist venv failed: " + (p.stderr or "")[:300])
            return None
    pip = str(DNSTWIST_VENV / "bin" / "pip")
    p = run([pip, "install", "dnstwist"], timeout=180)
    if p.returncode != 0:
        log("pip dnstwist failed: " + (p.stderr or "")[:300])
        return None
    p = run([str(DNSTWIST_BIN_PATH), "--version"], timeout=15)
    if p.returncode == 0:
        return (p.stdout or p.stderr or "").strip()
    return "installed" if DNSTWIST_BIN_PATH.exists() else None


def dnstwist_bin() -> str:
    if DNSTWIST_BIN_PATH.exists():
        return str(DNSTWIST_BIN_PATH)
    p = run(["which", "dnstwist"], timeout=10)
    s = (p.stdout or "").strip()
    if s:
        return s
    cand = str(Path.home() / ".local/bin/dnstwist")
    return cand if Path(cand).exists() else "dnstwist"


def collect_lookalikes():
    binp = dnstwist_bin()
    p = run([binp, "--registered", "--format", "csv", "-t", "8", "zoora.ai"], timeout=600)
    text = p.stdout or ""
    if p.returncode != 0 and not text.strip():
        log("dnstwist failed: " + (p.stderr or "")[:400])
        return None
    Path("/tmp/zoora-dnstwist.csv").write_text(text, encoding="utf-8")
    rows = []
    try:
        reader = csv.DictReader(io.StringIO(text))
        for row in reader:
            r = {(k or "").strip().lower().replace("_", "-"): (v or "").strip() for k, v in row.items()}
            domain = r.get("domain-name") or r.get("domain") or ""
            if not domain or domain.rstrip(".") == "zoora.ai":
                continue
            dns_a = r.get("dns-a") or r.get("a") or ""
            dns_aaaa = r.get("dns-aaaa") or ""
            dns_mx = r.get("dns-mx") or r.get("mx") or ""
            resolves = bool((dns_a and dns_a not in {"-", "!ServFail"}) or (dns_aaaa and dns_aaaa not in {"-", "!ServFail"}))
            has_mx = bool(dns_mx and dns_mx not in {"-", "!ServFail"})
            if not (resolves or has_mx):
                continue
            rows.append({
                "domain": domain.lower().rstrip("."),
                "fuzzer": r.get("fuzzer") or r.get("type") or "",
                "dns_a": dns_a, "dns_aaaa": dns_aaaa, "dns_mx": dns_mx,
                "resolves": resolves, "has_mx": has_mx,
            })
    except Exception as e:
        log(f"dnstwist parse: {e}")
        return None
    return {"collected_at": iso(), "count": len(rows), "domains": rows, "ok": True}


def npm_audit_lock(branch: str) -> dict[str, Any]:
    wt = Path("/tmp/zoora-audit-" + re.sub(r"[^A-Za-z0-9._-]", "_", branch)[:60])
    if wt.exists():
        run(["git", "-C", str(CLONE), "worktree", "remove", "--force", str(wt)], timeout=30)
        shutil.rmtree(wt, ignore_errors=True)
    ref = f"origin/{branch}"
    p = run(["git", "-C", str(CLONE), "worktree", "add", "--detach", str(wt), ref], timeout=60)
    if p.returncode != 0:
        return {"branch": branch, "ok": False, "error": (p.stderr or "")[:200]}
    lumen = wt / "projects/lumen"
    if not (lumen / "package-lock.json").exists():
        run(["git", "-C", str(CLONE), "worktree", "remove", "--force", str(wt)], timeout=30)
        return {"branch": branch, "ok": False, "error": "no projects/lumen/package-lock.json"}
    p = run(["npm", "audit", "--package-lock-only", "--omit=dev", "--json"], timeout=180, cwd=str(lumen))
    try:
        data = json.loads(p.stdout or "{}")
    except Exception as e:
        run(["git", "-C", str(CLONE), "worktree", "remove", "--force", str(wt)], timeout=30)
        return {"branch": branch, "ok": False, "error": f"audit-json: {e}"}
    high = []
    vulns = data.get("vulnerabilities") or {}
    for name, info in vulns.items() if isinstance(vulns, dict) else []:
        via = info.get("via") or []
        severity = (info.get("severity") or "").lower()
        ids = []
        if isinstance(via, list):
            for v in via:
                if isinstance(v, dict):
                    sev = (v.get("severity") or severity).lower()
                    if sev in {"high", "critical"}:
                        ids.append({"id": str(v.get("url") or v.get("source") or v.get("name") or ""), "title": v.get("title") or "", "severity": sev, "package": name, "range": info.get("range") or v.get("range") or ""})
        if not ids and severity in {"high", "critical"}:
            ids.append({"id": str(info.get("url") or name), "title": name, "severity": severity, "package": name, "range": info.get("range") or ""})
        high.extend(ids)
    seen, uniq = set(), []
    for h in high:
        key = (h.get("id"), h.get("package"), h.get("severity"))
        if key in seen:
            continue
        seen.add(key)
        uniq.append(h)
    run(["git", "-C", str(CLONE), "worktree", "remove", "--force", str(wt)], timeout=30)
    shutil.rmtree(wt, ignore_errors=True)
    return {"branch": branch, "ok": True, "high_critical": uniq, "count": len(uniq)}


def load_alerted() -> list:
    path = MONITOR / "alerted_log.md"
    if not path.exists():
        return []
    text = path.read_text(encoding="utf-8")
    return [{"key": m.group(1).strip(), "line": m.group(2).strip()} for m in re.finditer(r"^<!-- key: (.+?) -->\n- (.+)$", text, re.M)]


def append_alerts(new_alerts: list, when: datetime) -> None:
    path = MONITOR / "alerted_log.md"
    if not path.exists():
        path.write_text("# zoora.ai monitor — alert log\n\n", encoding="utf-8")
    with path.open("a", encoding="utf-8") as f:
        for a in new_alerts:
            f.write(f"<!-- key: {a['key']} -->\n")
            f.write(f"- {when.strftime('%Y-%m-%d %-I:%M %p')} America/Chicago — {a['summary']}\n")


def known_open_status(norm: dict) -> dict[str, bool]:
    dmarc = norm.get("_dmarc.zoora.ai") or {}
    apex = (norm.get("zoora.ai") or {}).get("types") or {}
    return {
        "missing_dmarc": bool(dmarc.get("nxdomain") or not (dmarc.get("types") or {}).get("TXT")),
        "missing_caa": not bool(apex.get("CAA")),
        "missing_dnssec": not bool(apex.get("DS")),
    }


def dns_alert_for_diff(d: dict, kos: dict) -> dict | None:
    name, typ = d.get("name"), d.get("type")
    if name == FLY_APP:
        return None
    key_hash = hashlib.sha1(json.dumps(d, sort_keys=True).encode()).hexdigest()[:12]
    if name == "_dmarc.zoora.ai":
        if kos["missing_dmarc"] and not d.get("to"):
            return None
        return {"key": "dmarc-changed:" + key_hash, "kind": "dns_change", "summary": "DMARC record for zoora.ai changed: " + describe_dns_diff(d), "what": describe_dns_diff(d), "action": "Confirm the DMARC change was intended (known open item from the Nov 10 report).", "notify_user": True}
    if name == "zoora.ai" and typ == "CAA":
        if kos["missing_caa"] and not d.get("to"):
            return None
        return {"key": "caa-changed:" + key_hash, "kind": "dns_change", "summary": "CAA records for zoora.ai changed: " + describe_dns_diff(d), "what": describe_dns_diff(d), "action": "Confirm the CAA change was intended (known open item from the Nov 10 report).", "notify_user": True}
    if name == "zoora.ai" and typ == "DS":
        if kos["missing_dnssec"] and not d.get("to"):
            return None
        return {"key": "dnssec-changed:" + key_hash, "kind": "dns_change", "summary": "DNSSEC DS records for zoora.ai changed: " + describe_dns_diff(d), "what": describe_dns_diff(d), "action": "Confirm the DNSSEC change was intended (known open item from the Nov 10 report).", "notify_user": True}
    kind = "ns_change" if typ == "NS" else "dns_change"
    return {"key": "dns:" + str(name) + ":" + str(typ) + ":" + key_hash, "kind": kind, "summary": "Unexpected DNS change: " + describe_dns_diff(d), "what": describe_dns_diff(d), "action": "Confirm this DNS change was intended. If not, revert the records at the registrar (Namecheap) and check who can edit DNS.", "notify_user": True}

def main() -> int:
    LOG_PATH.write_text("", encoding="utf-8")
    MONITOR.mkdir(parents=True, exist_ok=True)
    now = now_chicago()
    morning = is_morning(now)
    slot = "morning" if morning else "evening"
    log(f"start slot={slot} {iso(now)}")

    state = read_json(MONITOR / "state.json", default={}) or {}
    dns_baseline = read_json(MONITOR / "dns_baseline.json", default={}) or {}
    certs_baseline = read_json(MONITOR / "certs_baseline.json", default={}) or {}
    gl_baseline = read_json(MONITOR / "gitleaks_baseline.json", default={}) or {}
    lookalike_baseline = read_json(MONITOR / "lookalikes_baseline.json", default=None)
    npm_baseline = read_json(MONITOR / "npm_audit_baseline.json", default=None)
    existing_keys = {e["key"] for e in load_alerted()}

    known_cert_ids = set()
    for c in (certs_baseline.get("certs") or []):
        if c.get("id") is not None:
            known_cert_ids.add(c["id"])
    for c in (read_json(MONITOR / "certs_current.json", default={}) or {}).get("certs") or []:
        if c.get("id") is not None:
            known_cert_ids.add(c["id"])
    for i in ((state.get("certs") or {}).get("ids") or []):
        known_cert_ids.add(i)

    known_fps = list(gl_baseline.get("known_false_positives") or [])
    since = ((state.get("gitleaks") or {}).get("next_since")) or state.get("last_run_at") or "2026-11-17T22:52:56+00:00"
    overlay = read_json(Path("/tmp/zoora-monitor-state-overlay.json"), default=None) or {}
    ov_since = overlay.get("gitleaks_next_since")
    if ov_since and str(ov_since) > str(since):
        since = ov_since
    since_s = str(since)
    for i in overlay.get("known_cert_ids") or []:
        known_cert_ids.add(i)

    alerts: list[dict] = []
    skipped: list[str] = []
    failures: list[str] = []
    notes: list[str] = []
    notify_se = False

    dns_current = collect_dns()
    write_json(MONITOR / "dns_current.json", dns_current)
    queries = dns_current["queries"]
    norm_all = normalize_dns(queries)
    norm_zone = {k: v for k, v in norm_all.items() if k != FLY_APP}
    base_norm = dns_baseline.get("normalized") or {}
    diffs = dns_diffs(norm_zone, {k: v for k, v in base_norm.items()})
    fly_ok = fly_app_resolves(queries)
    on_gh = points_to_github_pages(norm_zone)
    on_fly = points_to_fly(norm_zone, queries)
    cutover_prev = bool(state.get("cutover_seen"))
    apex_nx = bool((norm_zone.get("zoora.ai") or {}).get("nxdomain"))
    left_github = (not on_gh) and (not apex_nx)

    if on_fly and not cutover_prev:
        cutover_date = now.strftime("%Y-%m-%d")
        notes.append(f"Cutover detected on {cutover_date} America/Chicago: zoora.ai now points to Fly.")
        alerts.append({
            "key": f"cutover:{cutover_date}", "kind": "cutover",
            "summary": f"zoora.ai cutover to Fly observed on {cutover_date} (America/Chicago). New DNS records were saved as the baseline. Uptime, header, and CSP checks will run from this run on.",
            "what": "Apex or www DNS now points at Fly, not GitHub Pages.",
            "action": "Confirm the cutover was intended. Review the new DNS records, then watch the next monitor run for /healthz, security headers, closed routes, and CSP.",
            "notify_user": True,
        })
        write_json(MONITOR / "dns_baseline.json", {
            "established_at": iso(now),
            "source": "cutover detected; previous GitHub Pages baseline replaced",
            "cutover_seen": True, "cutover_date": cutover_date,
            "normalized": norm_zone,
            "informational": {FLY_APP: norm_all.get(FLY_APP)},
            "raw_file": "dns_current.json",
        })
        cutover_prev = True
        diffs = []
    elif left_github and not on_fly and not cutover_prev:
        cutover_date = now.strftime("%Y-%m-%d")
        alerts.append({
            "key": f"dns-left-github-pages:{cutover_date}", "kind": "dns_change",
            "summary": f"zoora.ai DNS left GitHub Pages on {cutover_date} (America/Chicago) but does not clearly point at Fly. Records were not treated as a Fly cutover.",
            "what": describe_dns_diff(diffs[0]) if diffs else "Apex/www no longer match the GitHub Pages baseline.",
            "action": "Confirm where the domain should point. If this was the Fly cutover, say so and the next run can treat it as cut over once Fly records are visible.",
            "notify_user": True,
        })
    else:
        kos = known_open_status(norm_zone)
        for d in diffs:
            a = dns_alert_for_diff(d, kos)
            if a:
                alerts.append(a)

    if not on_fly and not fly_ok:
        notes.append("Pre-cutover posture: lumen-tidepool.fly.dev is NXDOMAIN; zoora.ai still on GitHub Pages." if on_gh else "lumen-tidepool.fly.dev is NXDOMAIN.")

    certs_current = collect_certs()
    if certs_current is None:
        failures.append("Certificate transparency (crt.sh) could not be fetched after retries. Existing cert baseline was left unchanged.")
    else:
        write_json(MONITOR / "certs_current.json", certs_current)
        new_certs = [c for c in certs_current["certs"] if c.get("id") not in known_cert_ids]
        unexpected = [c for c in certs_current["certs"] if issuer_unexpected(c.get("issuer_name"))]
        for c in new_certs:
            names = (c.get("name_value") or c.get("common_name") or "").replace("\n", ", ")
            issuer = c.get("issuer_name") or "unknown issuer"
            alerts.append({
                "key": f"cert-new:{c.get('id')}", "kind": "new_cert",
                "summary": f"New certificate logged for {names} (crt.sh id {c.get('id')}, not_after {c.get('not_after')}, issuer {issuer}).",
                "what": f"New CT entry id={c.get('id')} cn={c.get('common_name')} names={names} not_before={c.get('not_before')} not_after={c.get('not_after')} issuer={issuer} serial={c.get('serial_number') or ''}.",
                "action": "Confirm this certificate is one you expect (Let's Encrypt / GitHub Pages or Fly). If the issuer or names look wrong, treat it as possible domain misuse.",
                "notify_user": True,
            })
        for c in unexpected:
            names = (c.get("name_value") or c.get("common_name") or "").replace("\n", ", ")
            issuer = c.get("issuer_name") or "unknown"
            alerts.append({
                "key": f"cert-issuer:{c.get('id')}:{issuer}", "kind": "unexpected_issuer",
                "summary": f"Certificate for {names} has an unexpected issuer: {issuer} (expected Let's Encrypt).",
                "what": f"crt.sh id={c.get('id')} issuer={issuer} names={names} not_after={c.get('not_after')}.",
                "action": "Confirm who issued this cert. An unexpected issuer can mean a mis-issuance or someone requesting certificates for zoora.ai.",
                "notify_user": True,
            })

    site: dict[str, Any] = {}
    if not on_fly:
        skipped.extend([
            "uptime /healthz (pre-cutover: zoora.ai does not point to Fly)",
            "security headers and closed-route probes (pre-cutover)",
            "headless Chrome CSP checks of / and /world (pre-cutover)",
        ])
    else:
        code, body, err = curl_body("https://zoora.ai/healthz")
        ok = code == 200 and bool(re.search(r'"ok"\s*:\s*true', body or ""))
        site["healthz"] = {"code": code, "ok": bool(ok), "error": err}
        if not ok:
            alerts.append({
                "key": f"downtime:healthz:{now.strftime('%Y-%m-%d')}", "kind": "downtime",
                "summary": f"https://zoora.ai/healthz failed (HTTP {code}).",
                "what": f"healthz HTTP {code}; body does not show ok:true. {err}".strip(),
                "action": "Check the Fly app (lumen-tidepool) status, recent deploys, and whether DNS still points at Fly. This is a downtime signal, not a request to change production from the monitor.",
                "notify_user": True,
            })
        for host in ("zoora.ai", "www.zoora.ai"):
            c, hdr, e = curl_head(f"https://{host}/")
            headers = parse_headers(hdr)
            issues = header_issues(host, headers) if hdr else [{"host": host, "header": "*", "issue": f"no headers (HTTP {c}) {e}"}]
            site.setdefault("headers", {})[host] = {"code": c, "present": sorted(headers), "issues": issues}
            for iss in issues:
                alerts.append({
                    "key": f"header:{host}:{iss.get('header')}:{iss.get('issue')}", "kind": "header_regression",
                    "summary": f"Security header issue on {host}: {iss.get('header')} {iss.get('issue')}.",
                    "what": iss,
                    "action": "Fix the header in the Next.js / Fly edge config. If this needs a code change, Software Engineer should patch the app headers.",
                    "notify_user": True, "notify_se": True,
                })
                notify_se = True
        for path in CLOSED_PATHS:
            c = curl_code(f"https://zoora.ai{path}")
            site.setdefault("closed", {})[path] = c
            if c != 404:
                alerts.append({
                    "key": f"closed:{path}:{c}", "kind": "admin_reachable",
                    "summary": f"{path} returned HTTP {c} at the public edge (expected 404).",
                    "what": f"https://zoora.ai{path} -> {c}",
                    "action": "Confirm the route is not public. If a code or edge-config fix is needed, Software Engineer should restore the 404 at the public edge.",
                    "notify_user": True, "notify_se": True,
                })
                notify_se = True
        for path in ("/", "/world"):
            r = chrome_csp(f"https://zoora.ai{path}")
            site.setdefault("csp", {})[path] = r
            if r.get("violations") is None:
                failures.append(f"Headless Chrome CSP check failed for {path}: {r.get('error')}")
            elif r["violations"] > 0:
                alerts.append({
                    "key": f"csp:{path}:{r['violations']}", "kind": "csp_violation",
                    "summary": f"Headless Chrome reported {r['violations']} Content Security Policy console violation(s) on {path}.",
                    "what": {"path": path, "count": r["violations"], "sample": r.get("sample")},
                    "action": "Inspect the CSP (including the known nonce issue from the Nov 10 report only if its state changed). Software Engineer should fix any new or worsened CSP violations.",
                    "notify_user": True, "notify_se": True,
                })
                notify_se = True

    tls: list = []
    lookalikes = None
    npm = None
    if not morning:
        skipped.extend([
            "TLS expiry/issuer via openssl (morning-only)",
            "dnstwist lookalikes (morning-only)",
            "npm audit of projects/lumen (morning-only)",
        ])
    else:
        for host in ("zoora.ai", "www.zoora.ai"):
            t = tls_probe(host)
            tls.append(t)
            if not t.get("ok"):
                failures.append(f"TLS probe failed for {host}: {t.get('error') or t.get('raw_error')}")
                continue
            days = t.get("days_left")
            issuer = t.get("issuer") or ""
            if days is not None and days < TLS_WARN_DAYS:
                alerts.append({
                    "key": f"tls-expiry:{host}:{t.get('not_after')}", "kind": "tls_expiry",
                    "summary": f"TLS certificate for {host} expires in {int(days)} days ({t.get('not_after')}).",
                    "what": t,
                    "action": "Confirm auto-renewal is working (GitHub Pages or Fly / Let's Encrypt). If this will not renew on its own, renew it before it expires.",
                    "notify_user": True,
                })
            if issuer and issuer_unexpected(issuer):
                alerts.append({
                    "key": f"tls-issuer:{host}:{issuer}", "kind": "unexpected_issuer",
                    "summary": f"Live TLS issuer for {host} is unexpected: {issuer} (expected Let's Encrypt).",
                    "what": t,
                    "action": "Confirm the live certificate issuer. An unexpected issuer is a serious warning.",
                    "notify_user": True,
                })
        if ensure_dnstwist() is None:
            failures.append("dnstwist is not installed and pip install failed; lookalike check skipped.")
        else:
            lookalikes = collect_lookalikes()
            if lookalikes is None:
                failures.append("dnstwist lookalike scan failed; baseline left unchanged.")
            else:
                write_json(MONITOR / "lookalikes_current.json", lookalikes)
                if lookalike_baseline is None:
                    write_json(MONITOR / "lookalikes_baseline.json", {"established_at": iso(now), "domains": lookalikes["domains"]})
                    notes.append(f"Lookalike baseline established ({lookalikes['count']} registered domains that resolve or have MX). No alerts on this first set.")
                    lookalike_baseline = {"domains": lookalikes["domains"]}
                else:
                    known_d = {d.get("domain") for d in (lookalike_baseline.get("domains") or []) if d.get("domain")}
                    new = [d for d in lookalikes["domains"] if d.get("domain") not in known_d]
                    for d in new:
                        alerts.append({
                            "key": f"lookalike:{d['domain']}", "kind": "lookalike",
                            "summary": f"New lookalike domain {d['domain']} ({d.get('fuzzer')}) resolves or has MX.",
                            "what": d,
                            "action": "Check whether this domain is yours. If not, review it for phishing (web content and MX) and consider a takedown or registrar complaint if it impersonates Zoora.",
                            "notify_user": True,
                        })
                    if new:
                        merged = list(lookalike_baseline.get("domains") or []) + new
                        write_json(MONITOR / "lookalikes_baseline.json", {"established_at": lookalike_baseline.get("established_at") or iso(now), "updated_at": iso(now), "domains": merged})
    repo_info: dict[str, Any] = {}
    gl_current: dict[str, Any] = {}
    gver = ensure_gitleaks()
    if not gver:
        failures.append("gitleaks binary missing and reinstall failed; secret scan skipped and the commit cursor was not advanced.")
    elif not ensure_clone():
        failures.append("Public clone/fetch of BuildWithAAI/buildwithAAI failed; gitleaks (and morning npm audit) skipped; commit cursor not advanced.")
    else:
        refs = list_remote_refs()
        refs_text = "".join(f"{sha} {ref}\n" for sha, ref in refs)
        refs_hash = hashlib.sha256(refs_text.encode()).hexdigest()
        prev_refs = {}
        prev_path = MONITOR / "repo_refs_baseline.txt"
        if prev_path.exists():
            for line in prev_path.read_text(encoding="utf-8").splitlines():
                if " " in line:
                    sha, ref = line.split(" ", 1)
                    prev_refs[ref] = sha
        cur_refs = {ref: sha for sha, ref in refs}
        new_branches = {r: cur_refs[r] for r in cur_refs if r not in prev_refs}
        moved = {r: {"from": prev_refs[r], "to": cur_refs[r]} for r in cur_refs if r in prev_refs and prev_refs[r] != cur_refs[r]}
        gone = {r: prev_refs[r] for r in prev_refs if r not in cur_refs}
        def_b = default_branch()
        pr_b = lumen_pr_branch((state.get("repo") or {}).get("pr_branch") or "cursor/lumen-jellyfish-9263")
        repo_info = {
            "main": cur_refs.get(def_b) or cur_refs.get("main"),
            "default_branch": def_b,
            "pr_branch": pr_b,
            "pr_head": cur_refs.get(pr_b) if pr_b else None,
            "new_branches": new_branches,
            "moved_branches": moved,
            "gone_branches": gone,
            "refs_hash": refs_hash,
        }
        gl_current = gitleaks_scan(since_s)
        if not gl_current.get("ok"):
            failures.append(f"gitleaks scan failed ({gl_current.get('error')}); commit cursor not advanced.")
            gl_current["next_since"] = since_s
        else:
            real, fps = classify_findings(gl_current.get("items") or [], known_fps)
            gl_current["real_secrets"] = len(real)
            gl_current["false_positives"] = len(fps)
            gl_current["report_empty"] = gl_current.get("findings", 0) == 0
            if fps:
                existing_fp = {x.get("fingerprint") for x in known_fps}
                added = 0
                for it in fps:
                    if it.get("fingerprint") and it["fingerprint"] not in existing_fp:
                        known_fps.append({
                            "fingerprint": it["fingerprint"], "rule": it.get("rule"), "file": it.get("file"),
                            "line": it.get("line"), "commit": it.get("commit"),
                            "classification": it.get("classification"),
                            "reason": it.get("reason") or "classified on a later monitor run",
                        })
                        added += 1
                if added:
                    write_json(MONITOR / "gitleaks_baseline.json", {
                        **gl_baseline, "updated_at": iso(now),
                        "known_false_positives": known_fps,
                        "real_secrets": gl_baseline.get("real_secrets") or [],
                    })
            for it in real:
                fp = it.get("fingerprint") or f"{it.get('commit')}:{it.get('file')}:{it.get('rule')}:{it.get('line')}"
                alerts.append({
                    "key": f"gitleaks:{fp}", "kind": "gitleaks_secret",
                    "summary": f"gitleaks found a potential secret in the public repo ({it.get('rule')} in {it.get('file')} at commit {(it.get('commit') or '')[:12]}). The secret value is not shown.",
                    "what": {k: it.get(k) for k in ("rule", "file", "line", "commit", "fingerprint", "classification") if it.get(k) is not None},
                    "action": "Treat this as a leaked secret until proven otherwise: rotate the credential, confirm it was redacted from git history or is only a test placeholder, and have Software Engineer remove it from the public repo if it is real.",
                    "notify_user": True, "notify_se": True,
                })
                notify_se = True
            gl_current["next_since"] = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
            write_json(MONITOR / "gitleaks_current.json", {
                "collected_at": gl_current["collected_at"], "since": gl_current["since"],
                "commits_in_rev_list": gl_current["commits_in_rev_list"],
                "commits_scanned_by_gitleaks": gl_current["commits_scanned_by_gitleaks"],
                "findings": gl_current["findings"], "real_secrets": gl_current["real_secrets"],
                "false_positives": gl_current["false_positives"], "report_empty": gl_current["report_empty"],
                "items": gl_current.get("items") or [], "next_since": gl_current["next_since"],
            })
            prev_path.write_text(refs_text, encoding="utf-8")

        if morning:
            branches = [def_b]
            if pr_b and pr_b != def_b:
                branches.append(pr_b)
            npm_results = [npm_audit_lock(b) for b in branches]
            npm = {"collected_at": iso(now), "results": npm_results}
            write_json(MONITOR / "npm_audit_current.json", npm)
            known_ids = set()
            if npm_baseline and isinstance(npm_baseline, dict):
                for r in npm_baseline.get("results") or []:
                    for h in r.get("high_critical") or []:
                        known_ids.add(f"{h.get('id')}|{h.get('package')}|{h.get('severity')}")
            if npm_baseline is None:
                write_json(MONITOR / "npm_audit_baseline.json", npm)
                notes.append("npm audit baseline established for production deps in projects/lumen. Existing high/critical issues (if any) were recorded and will only alert if new ones appear.")
            else:
                new_v = []
                for r in npm_results:
                    if not r.get("ok"):
                        failures.append(f"npm audit failed on {r.get('branch')}: {r.get('error')}")
                        continue
                    for h in r.get("high_critical") or []:
                        kid = f"{h.get('id')}|{h.get('package')}|{h.get('severity')}"
                        if kid not in known_ids:
                            new_v.append({**h, "branch": r.get("branch")})
                for h in new_v:
                    alerts.append({
                        "key": f"npm:{h.get('id')}:{h.get('package')}:{h.get('branch')}", "kind": "npm_vuln",
                        "summary": f"New {h.get('severity')} production dependency issue in projects/lumen on {h.get('branch')}: {h.get('package')} ({h.get('title') or h.get('id')}).",
                        "what": h,
                        "action": "Have Software Engineer review and update or patch the production dependency on that branch.",
                        "notify_user": True, "notify_se": True,
                    })
                    notify_se = True
                if new_v:
                    write_json(MONITOR / "npm_audit_baseline.json", npm)

    emit = [a for a in alerts if a["key"] not in existing_keys]
    for a in alerts:
        if a["key"] in existing_keys:
            log(f"suppress already-alerted {a['key']}")
    if emit:
        append_alerts(emit, now)

    certs_state = {}
    if certs_current:
        certs_state = {
            "ids": [c.get("id") for c in certs_current["certs"]],
            "serials": sorted({c.get("serial_number") for c in certs_current["certs"] if c.get("serial_number")}),
            "issuers": sorted({c.get("issuer_name") for c in certs_current["certs"] if c.get("issuer_name")}),
            "names": sorted({(c.get("common_name") or c.get("name_value") or "") for c in certs_current["certs"]}),
            "count": certs_current.get("count"),
            "new_vs_known": "none" if not any(c.get("id") not in known_cert_ids for c in certs_current["certs"]) else "new present",
            "unexpected_issuer": [c.get("id") for c in certs_current["certs"] if issuer_unexpected(c.get("issuer_name"))],
        }

    new_state = {
        "last_run_at": iso(now), "last_run_slot": slot, "routine": "zoora.ai security monitor",
        "cutover_seen": bool(on_fly) or cutover_prev,
        "cutover_date": (state.get("cutover_date") or (now.strftime("%Y-%m-%d") if on_fly and not state.get("cutover_seen") else None)),
        "points_to_fly": on_fly, "fly_app_resolves": fly_ok,
        "dns_unchanged_vs_prelaunch_report": not diffs, "dns_diffs": diffs,
        "certs": certs_state,
        "gitleaks": {
            "commits_scanned": gl_current.get("commits_scanned_by_gitleaks"),
            "commits_in_window": gl_current.get("commits_in_rev_list"),
            "since": gl_current.get("since") or since_s,
            "findings": gl_current.get("findings"),
            "real_secrets": gl_current.get("real_secrets"),
            "false_positives": gl_current.get("false_positives"),
            "next_since": gl_current.get("next_since") or since_s,
            "ok": gl_current.get("ok"),
        },
        "repo": repo_info, "skipped": skipped, "failures": failures,
        "alerts": [{"key": a["key"], "kind": a["kind"], "summary": a["summary"]} for a in emit],
    }
    write_json(MONITOR / "state.json", new_state)

    gh_note = (
        "Not seen. Apex still GitHub Pages, www CNAME expected buildwithaai.github.io., "
        + FLY_APP + (" resolves" if fly_ok else " NXDOMAIN")
        + ". Pre-launch posture unchanged vs the Nov 10 report."
    )
    lines = [
        f"# zoora.ai monitor run — {now.strftime('%Y-%m-%d %-I:%M %p')} America/Chicago",
        "", f"Slot: {slot} (9:00 AM / 5:00 PM America/Chicago schedule).", "",
        "## Cutover",
        ("Seen. zoora.ai points to Fly. cutover_date=" + str(new_state.get("cutover_date")) + ".") if on_fly else gh_note,
        "", "## Checks",
        f"- DNS: {'unchanged vs baseline' if not diffs else 'DIFFS: ' + '; '.join(describe_dns_diff(d) for d in diffs)}.",
        f"- Known open items still open: {', '.join(k for k,v in known_open_status(norm_zone).items() if v) or 'none'}.",
    ]
    if certs_current:
        lines.append(f"- Certificate transparency (crt.sh): {certs_current['count']} unique entries. new_vs_known={certs_state.get('new_vs_known')}. issuers={certs_state.get('issuers')}.")
    else:
        lines.append("- Certificate transparency: FETCH FAILED.")
    if gl_current.get("ok"):
        lines.append(f"- gitleaks since {gl_current.get('since')}: {gl_current.get('commits_in_rev_list')} commits in window, {gl_current.get('findings')} findings, {gl_current.get('real_secrets')} potential real, {gl_current.get('false_positives')} false positives.")
    else:
        lines.append("- gitleaks: not completed; cursor not advanced.")
    if repo_info:
        lines.append(f"- Repo: default {repo_info.get('default_branch')}={str(repo_info.get('main') or '')[:12]} PR {repo_info.get('pr_branch')}={str(repo_info.get('pr_head') or '')[:12]}. new_branches={list((repo_info.get('new_branches') or {}).keys())}.")
    for s in skipped:
        lines.append(f"- Skipped: {s}.")
    for t in tls:
        lines.append(f"- TLS {t.get('host')}: notAfter={t.get('not_after')} days_left={t.get('days_left')} issuer={t.get('issuer')}.")
    if lookalikes and lookalikes.get("ok"):
        lines.append(f"- Lookalikes: {lookalikes['count']} registered that resolve or have MX.")
    if npm:
        for r in npm.get("results") or []:
            if r.get("ok"):
                lines.append(f"- npm audit {r.get('branch')}: {r.get('count')} high/critical production issues.")
            else:
                lines.append(f"- npm audit {r.get('branch')}: failed ({r.get('error')}).")
    lines += ["", "## Failures"]
    if failures:
        lines.extend(f"- {f}" for f in failures)
    else:
        lines.append("None.")
    lines += ["", "## Alerts"]
    if emit:
        lines.extend(f"- {a['summary']}" for a in emit)
    else:
        lines.append("None.")
    written = "dns_current.json, state.json, last_run.md"
    if certs_current:
        written += ", certs_current.json"
    if gl_current.get("ok"):
        written += ", gitleaks_current.json, repo_refs_baseline.txt"
    lines += ["", "## State written", written]
    (MONITOR / "last_run.md").write_text("\n".join(lines) + "\n", encoding="utf-8")

    result = {
        "ok": not failures, "slot": slot, "run_at": iso(now),
        "cutover": on_fly, "cutover_date": new_state.get("cutover_date"),
        "dns_diffs": diffs, "alerts": emit, "failures": failures, "notes": notes,
        "notify_user": bool(emit or failures),
        "notify_se": any(a.get("notify_se") for a in emit) or notify_se,
        "state": new_state,
    }
    write_json(RESULT_PATH, result)

    if not emit and not failures:
        return 0
    print("zoora.ai security monitor — findings to report")
    print(f"Run: {now.strftime('%Y-%m-%d %-I:%M %p')} America/Chicago ({slot} slot).")
    if on_fly:
        print("Site is on Fly.")
    else:
        print("Still pre-cutover (zoora.ai on GitHub Pages; Fly app not in public DNS). Uptime/headers/CSP were skipped as planned.")
    if emit:
        print("\nAlerts:")
        for a in emit:
            print(f"- {a['summary']}")
            if a.get("action"):
                print(f"  What to do: {a['action']}")
    if failures:
        print("\nCheck failures (monitor could not complete a check):")
        for f in failures:
            print(f"- {f}")
    if any(a.get("notify_se") for a in emit):
        print("\nAlso tell the Software Engineer agent in Grok Bot about the finding(s) that need a code or dependency fix (header/CSP/closed-route/gitleaks/npm). Do not mention this monitor's internals.")
    print("\nSpeak to Zoorped in plain words. Do not print secret values. Do not deploy, merge, push, or change DNS, Fly, or GitHub settings.")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as e:
        err = f"{type(e).__name__}: {e}"
        try:
            LOG_PATH.open("a").write(err + "\n")
        except Exception:
            pass
        write_json(RESULT_PATH, {"ok": False, "failures": [err], "alerts": [], "notify_user": True, "notify_se": False})
        print("zoora.ai security monitor — findings to report")
        print("The monitor run failed before it finished:")
        print(f"- {err}")
        print("Existing cursors were only advanced for checks that completed successfully.")
        sys.exit(0)

