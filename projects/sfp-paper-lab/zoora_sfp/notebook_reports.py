"""Portable notebook history and complete latest study, with no network assets."""

import base64
import binascii
from html import escape
from pathlib import Path

from .data import ResearchError, canonical, decode, digest, exact, require
from .notebook import PROTOCOL, dataset_value, notebook_status, replay_events, sha
from .reports import NOTEBOOK_FILES, OUTPUT_LIMIT
from .study_reports import community, render_study

EXPORT_PROTOCOL = "ZOORA_SFP_NOTEBOOK_EVIDENCE_V1"


def snapshot(state):
    return {"protocol": PROTOCOL, "events": state["events"],
            "artifacts_base64": [base64.b64encode(raw).decode("ascii") for raw in state["artifacts"]]}


def restore(value, expected_head=None, rerun=False):
    exact(value, {"protocol", "events", "artifacts_base64"})
    require(value["protocol"] == PROTOCOL and isinstance(value["artifacts_base64"], list),
            "INVALID_NOTEBOOK_SNAPSHOT")
    try:
        artifacts = [base64.b64decode(raw, validate=True) for raw in value["artifacts_base64"]]
        return replay_events(value["events"], artifacts, expected_head, rerun)
    except (KeyError, TypeError, ValueError, IndexError, binascii.Error) as exc:
        if isinstance(exc, ResearchError):
            raise
        raise ResearchError("INVALID_NOTEBOOK_SNAPSHOT") from exc


def history_rows(state):
    return [{"event": e["event_seq"], "recorded_ms": e["recorded_ms"],
             "run_id": e["report"]["run_id"], "dataset_sha256": e["report"]["dataset_sha256"],
             "trials": len(e["report"]["trials"]),
             "complete_folds": sum(f["test_coverage"]["status"] == "COMPLETE" for f in e["report"]["folds"]),
             "failed_screens": sum(s["numeric_screen"] == "FAIL" for s in e["report"]["summary"]),
             "passing_research_screens": sum(s["numeric_screen"] != "FAIL" for s in e["report"]["summary"])}
            for e in state["evaluations"]]


def notebook_community(state):
    status = notebook_status(state)
    rows = ["| Recorded evaluation | Trials | Complete folds | Failed screens | Passing research screens |",
            "| --- | --- | --- | --- | --- |"]
    rows.extend(f"| Event {r['event']} | {r['trials']} | {r['complete_folds']} | "
                f"{r['failed_screens']} | {r['passing_research_screens']} |" for r in history_rows(state))
    text = ["# BuildWithAAI research notebook update", "",
            (f"Recorded {status['events']} events, {status['csv_captures']} appended CSV captures and "
            f"{status['evaluations']} evaluations in this notebook. All recorded evaluations appear below."), "",
            (f"Price classification: **{status['classification']}**. Source verification: **UNAVAILABLE**. "
            "This is local research history; neither its timestamps nor unseen data are independently attested."), "",
            (f"Evaluation bars already present at notebook opening: "
            f"**{status['evaluation_bars_already_present_at_open']}**. Reconstructed close-plus-delay "
            "availability is not proof that prices were received in real time."), "", *rows, "",
            ("Different evaluations and folds reuse data and reset simulated accounts. Their profits must not "
            "be added together as project income. The history covers this notebook only; other experiments "
            "can exist. A separately retained head checkpoint is needed to detect a rolled-back copy."), "",
            "Head checkpoint: `" + status["head_sha256"] + "`.", "",
            "[Audit history](audit.html) · [Latest complete study](study.html)", "", "---", ""]
    return "\n".join(text).encode() + community(state["evaluations"][-1]["report"])


def audit_dashboard(state):
    status = notebook_status(state)
    evaluations = "".join(
        f"<tr><td>{r['event']}</td><td>{r['trials']}</td><td>{r['complete_folds']}</td>"
        f"<td>{r['failed_screens']}</td><td>{r['passing_research_screens']}</td>"
        f"<td><code>{r['run_id'][:16]}</code></td></tr>" for r in history_rows(state))
    receipts = "".join(
        f"<tr><td>{c['event_seq']}</td><td>{c['added_bars']}</td><td>{c['overlap_bars']}</td>"
        f"<td>{len(c['coverage_gaps'])}</td><td>{c['unfinished_rows_excluded']}</td>"
        f"<td><code>{c['raw_csv_sha256'][:16]}</code></td></tr>" for c in state["captures"])
    events = "".join(f"<tr><td>{e['seq']}</td><td>{escape(e['kind'])}</td>"
                     f"<td>{e['recorded_ms']}</td><td><code>{e['event_sha256'][:16]}</code></td></tr>"
                     for e in state["events"])
    return f"""<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<title>BuildWithAAI · Research notebook</title><style>
*{{box-sizing:border-box}}body{{margin:0;background:#0c1116;color:#e3eaf0;font:16px/1.6 system-ui,sans-serif}}
main{{max-width:1100px;margin:auto;padding:30px 18px}}h1{{font-size:clamp(26px,5vw,42px);line-height:1.2}}
h2{{font-size:21px;margin-top:34px}}a{{color:#69e4cc}}p{{max-width:82ch}}.label{{color:#69e4cc;letter-spacing:.12em;font-size:12px}}
.notice{{border-left:3px solid #ecbb64;background:#191c20;padding:15px 18px}}.cards{{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}}
.card{{border:1px solid #303b44;border-radius:10px;padding:18px}}.card strong{{display:block;font-size:30px;color:#69e4cc}}
.scroll{{overflow-x:auto}}table{{width:100%;border-collapse:collapse;font-size:14px;white-space:nowrap}}td,th{{padding:12px;text-align:left;border-bottom:1px solid #303b44}}
code{{overflow-wrap:anywhere;white-space:normal;font-size:12px}}.muted{{color:#a5b4c0}}@media(max-width:560px){{.cards{{grid-template-columns:1fr}}main{{padding:22px 15px}}}}
</style></head><body><main><p class="label">BUILDWITHAAI / BT-007</p><h1>Research with a recorded history.</h1>
<p class="notice" id="readiness"><strong>Research only · funded trading blocked.</strong><br>
Classification: {escape(status['classification'])}. Source verification unavailable. Funds moved: 0. Tokens purchased: 0. Tokens burned: 0.</p>
<div class="cards"><div class="card"><strong>{status['csv_captures']}</strong>CSV captures</div>
<div class="card"><strong>{status['evaluations']}</strong>Recorded evaluations</div>
<div class="card"><strong>{status['bars']}</strong>Hourly bars</div></div>
<p><a href="study.html">Open the latest study →</a> &nbsp; <a href="COMMUNITY_UPDATE.md">Community update</a></p>
<h2>What this history establishes</h2><p>The local notebook retains its frozen plan, original input bytes and every recorded evaluation.
Revised old prices and historical backfills are rejected. Gaps remain visible. All activity uses simulated accounts.</p>
<p class="notice"><strong>Local records are not independent witnesses.</strong><br>
{status['evaluation_bars_already_present_at_open']} evaluation bars were already present at opening.
Historical availability is reconstructed from close plus delay. Appended data is not certified unseen or received live.
This notebook does not register experiments performed elsewhere.</p>
<h2>Every recorded evaluation</h2><p class="muted">Swipe tables on a small screen. A passing research screen does not authorize trading.</p>
<div class="scroll"><table id="evaluations"><thead><tr><th>Event</th><th>Trials</th><th>Complete folds</th><th>Failed screens</th><th>Passing research screens</th><th>Run</th></tr></thead><tbody>{evaluations}</tbody></table></div>
<h2>Data receipts</h2><div class="scroll"><table id="receipts"><thead><tr><th>Event</th><th>New bars</th><th>Overlap</th><th>Gaps</th><th>Unfinished excluded</th><th>Raw CSV hash</th></tr></thead><tbody>{receipts}</tbody></table></div>
<h2>Event chain</h2><p class="muted">Times below are local host Unix milliseconds.</p><div class="scroll"><table id="events"><thead><tr><th>Event</th><th>Action</th><th>Local time</th><th>Event hash</th></tr></thead><tbody>{events}</tbody></table></div>
<h2>Retain this checkpoint separately</h2><p><code id="checkpoint">{status['head_sha256']}</code></p>
<p>Hash checks detect inconsistent edits. Someone with file access can rewrite a whole notebook or remove its last records.
Verify against a separately retained expected head to detect that rollback. These records do not attest host integrity, source truth or profitability.</p>
<p class="muted">The JSON bundle includes raw source bytes and previous reports. Repeated studies and reset fold accounts are not cumulative treasury income.</p>
</main></body></html>""".encode()


def render_notebook(state):
    require(notebook_status(state)["evaluation_status"] == "CURRENT", "LATEST_DATA_NOT_EVALUATED")
    report = state["evaluations"][-1]["report"]
    payloads = render_study(report, state["plan"])
    payloads.pop("manifest.json")
    payloads.update({"notebook.json": canonical(snapshot(state)) + b"\n",
                     "dataset.json": canonical(dataset_value(state["dataset"])) + b"\n",
                     "audit.html": audit_dashboard(state), "COMMUNITY_UPDATE.md": notebook_community(state)})
    require(sum(len(raw) for raw in payloads.values()) <= OUTPUT_LIMIT, "OUTPUT_SIZE_LIMIT")
    manifest = {"protocol": EXPORT_PROTOCOL, "run_id": report["run_id"],
                "head_sha256": state["head_sha256"], "audit_scope": "INTERNAL_CONSISTENCY_NOT_ATTESTATION",
                "members": {name: {"sha256": sha(raw), "bytes": len(raw)}
                            for name, raw in sorted(payloads.items())}}
    manifest["manifest_sha256"] = digest(manifest)
    payloads["manifest.json"] = canonical(manifest) + b"\n"
    return payloads


def verify_notebook_export(folder, expected_head=None, rerun=False):
    folder = Path(folder)
    require(folder.is_dir() and not folder.is_symlink(), "INVALID_EVIDENCE_DIRECTORY")
    require({p.name for p in folder.iterdir()} == NOTEBOOK_FILES | {"manifest.json"},
            "UNEXPECTED_EVIDENCE_MEMBERS")
    paths = [folder / name for name in NOTEBOOK_FILES | {"manifest.json"}]
    require(all(p.is_file() and not p.is_symlink() for p in paths) and
            sum(p.stat().st_size for p in paths) <= OUTPUT_LIMIT + 8192, "INVALID_EVIDENCE_FILE")
    try:
        manifest = decode((folder / "manifest.json").read_bytes())
        require(isinstance(manifest, dict), "INVALID_MANIFEST")
        supplied = manifest.pop("manifest_sha256")
        require(supplied == digest(manifest) and manifest["protocol"] == EXPORT_PROTOCOL and
                set(manifest["members"]) == NOTEBOOK_FILES and manifest["audit_scope"] ==
                "INTERNAL_CONSISTENCY_NOT_ATTESTATION", "INVALID_MANIFEST")
        for name, expected in manifest["members"].items():
            raw = (folder / name).read_bytes()
            require(expected == {"sha256": sha(raw), "bytes": len(raw)}, "EVIDENCE_HASH_MISMATCH")
        state = restore(decode((folder / "notebook.json").read_bytes(), OUTPUT_LIMIT), expected_head, rerun)
        require(notebook_status(state)["evaluation_status"] == "CURRENT", "LATEST_DATA_NOT_EVALUATED")
        require(manifest["head_sha256"] == state["head_sha256"] and
                manifest["run_id"] == state["evaluations"][-1]["report"]["run_id"], "NOTEBOOK_MANIFEST_MISMATCH")
        for name, expected in [("plan.json", state["plan"]), ("dataset.json", dataset_value(state["dataset"])),
                                ("study.json", state["evaluations"][-1]["report"])]:
            require(decode((folder / name).read_bytes(), OUTPUT_LIMIT) == expected, "NOTEBOOK_EXPORT_MISMATCH")
    except (KeyError, TypeError, ValueError, IndexError) as exc:
        if isinstance(exc, ResearchError):
            raise
        raise ResearchError("INVALID_NOTEBOOK_EVIDENCE") from exc
    return {"protocol": EXPORT_PROTOCOL, "head_sha256": state["head_sha256"],
            "members_verified": len(NOTEBOOK_FILES), "evaluations_verified": len(state["evaluations"]),
            "full_evaluation_replay": rerun, "scope": manifest["audit_scope"]}
