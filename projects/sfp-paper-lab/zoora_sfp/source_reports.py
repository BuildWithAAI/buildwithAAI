"""Portable raw-provider observations, data quality and an honest receipt boundary."""

from html import escape
from pathlib import Path

from .data import MAX_BYTES, ResearchError, canonical, decode, digest, require
from .provider import parse_capture, sha
from .reports import SOURCE_FILES, publish

SOURCE_PROTOCOL = "ZOORA_SFP_SOURCE_EVIDENCE_V1"


def notes(source):
    q = source["quality"]
    return ("# BuildWithAAI — SOL/USD data receipt\n\n"
            f"Classification: **{q['classification']}**. Transport: **{q['transport']}**.\n\n"
            f"Retained {q['bars']} completed hourly observations from the declared Kraken spot SOL/USD market. "
            f"Recorded gaps: {len(q['coverage_gaps'])}. Local data screen: {q['local_data_screen']}. "
            f"The provider's final uncommitted row was excluded; other not-yet-available rows excluded: "
            f"{q['other_not_yet_available_rows_excluded']}.\n\n"
            "The capture binds the exact pair/OHLC responses and their request receipts. Local verification "
            "reconstructs the CSV/dataset and quality report; it does not independently witness TLS, clock "
            "integrity, provider truth or an unseen experiment. File imports have no witnessed transport.\n\n"
            "This is SOL against USD on Kraken spot, not AAI or a Pump.fun pool. It has no AAI mint identity "
            "or executable quote history. Availability is reconstructed at hourly close plus the declared delay. "
            "Costs and execution remain simulation assumptions. Historical study outcomes are retrospective.\n\n"
            "The documentation states a 720-entry limit; current public observations can contain 721 rows "
            "including the uncommitted final row. That single-row compatibility case is bounded and recorded "
            "as a provider-contract warning. The recent endpoint cannot supply "
            "the default three-fold study window. The engine does not silently shrink a frozen study. "
            "Choose and disclose a separate research plan explicitly, or supply longer suitable history.\n\n"
            "Source format references: [Kraken OHLC](https://docs.kraken.com/api-reference/market-data/get-ohlc-data), "
            "[market identity](https://docs.kraken.com/api-reference/market-data/get-tradable-asset-pairs). "
            "The adapter uses assetVersion=1 to require the explicit SOL/USD display identity.\n\n"
            f"Capture checksum: {q['capture_sha256']}.\n\n"
            "Funds transferred: 0. Tokens purchased: 0. Tokens burned: 0. Funded readiness remains blocked.\n").encode()


def source_dashboard(source):
    q = source["quality"]
    flags = " · ".join(q["flags"]) if q["flags"] else "No local gap, staleness or market-status flags"
    requests = "".join(f"<tr><td>{escape(r['kind'])}</td><td>{r['status']}</td>"
                       f"<td>{r['body_bytes']}</td><td>{r['started_ms']}</td>"
                       f"<td><code>{r['body_sha256'][:16]}</code></td></tr>"
                       for r in source["capture"]["requests"])
    return f"""<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<title>BuildWithAAI · Source receipt</title><style>
*{{box-sizing:border-box}}body{{margin:0;background:#0c1116;color:#e3eaf0;font:16px/1.6 system-ui,sans-serif}}
main{{max-width:1050px;margin:auto;padding:32px 18px}}h1{{font-size:clamp(27px,5vw,43px);line-height:1.2}}
h2{{font-size:22px;margin-top:32px}}.label,a{{color:#69e4cc}}a{{text-underline-offset:3px}}p{{max-width:80ch}}
.notice{{background:#191c20;border-left:3px solid #ecbb64;padding:15px 18px}}.cards{{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}}
.card{{border:1px solid #303b44;border-radius:10px;padding:18px}}.card strong{{display:block;color:#69e4cc;font-size:30px}}
code{{overflow-wrap:anywhere;font-size:12px}}.scroll{{overflow-x:auto}}table{{width:100%;border-collapse:collapse;white-space:nowrap;font-size:14px}}
td,th{{padding:12px;text-align:left;border-bottom:1px solid #303b44}}.muted{{color:#a5b4c0}}@media(max-width:560px){{.cards{{grid-template-columns:1fr}}}}
</style></head><body><main><p class="label">BUILDWITHAAI / BT-008</p><h1>Know the data before the result.</h1>
<p class="notice" id="boundary"><strong>Research data · funded trading blocked.</strong><br>
Classification: {escape(q['classification'])}. Provider-reported observations remain independently unverified.</p>
<div class="cards"><div class="card"><strong>{q['bars']}</strong>Completed hourly bars</div>
<div class="card"><strong>{len(q['coverage_gaps'])}</strong>Recorded gaps</div>
<div class="card"><strong>{q['uncommitted_final_rows_excluded']}</strong>Uncommitted row excluded</div></div>
<h2>Local data screen</h2><p id="screen"><strong>{escape(q['local_data_screen'])}</strong><br>{escape(flags)}</p>
<p>A local data-screen pass checks this import's geometry and declared timing. It does not establish source truth, executable quotes, realistic costs, unseen data or strategy profitability.</p>
<h2>Market identity</h2><p><strong>SOL / USD · Kraken spot</strong><br>This is not an AAI token or a Pump.fun pool.
The declared pair key, base, quote and spot asset classes are checked against the retained response.</p>
<h2>What was retained</h2><p id="transport"><code>{escape(q['transport'])}</code></p>
<div class="scroll"><table id="requests"><thead><tr><th>Response</th><th>Status</th><th>Bytes</th><th>Request time</th><th>Body hash</th></tr></thead><tbody>{requests}</tbody></table></div>
<p class="muted">Swipe tables on a small screen. Times are local host milliseconds for HTTPS capture, or supplied assertions for file import. Saved receipts do not independently witness transport.</p>
<h2>Provider contract</h2><p id="contract">{escape(' · '.join(q['provider_contract_warnings']) or 'No observed row-cap discrepancy')}</p>
<h2>Study coverage</h2><p>The documentation states a 720-entry limit. Observed 721-row responses are bounded as 720 completed rows plus the uncommitted final row and flagged above. The default three-fold study needs longer history.
No frozen plan is automatically shortened to fit this sample. A smaller retrospective research plan must be declared explicitly.</p>
<p>Availability is reconstructed at close plus delay. All prices are provider reports, and all fills/costs remain synthetic scenarios. These observations do not establish an independently untouched test.</p>
<h2>Inspect the records</h2><p><a href="SOURCE_NOTES.md">Source notes</a> · <a href="quality.json">Quality record</a> · <a href="history.csv">Hourly CSV</a></p>
<p><code>{q['capture_sha256']}</code></p><p class="muted">Funds moved: 0. Tokens purchased: 0. Tokens burned: 0. No price floor or economic allocation is established.</p>
</main></body></html>""".encode()


def render_source(raw):
    source = parse_capture(raw)
    payloads = {"capture.json": raw, "pair-response.json": source["pair_raw"],
                "ohlc-response.json": source["ohlc_raw"], "dataset.json": source["dataset_raw"],
                "history.csv": source["csv_raw"], "quality.json": canonical(source["quality"]) + b"\n",
                "SOURCE_NOTES.md": notes(source), "source.html": source_dashboard(source)}
    manifest = {"protocol": SOURCE_PROTOCOL, "capture_sha256": source["capture"]["capture_sha256"],
                "scope": "INTERNAL_SOURCE_MAPPING_NOT_EXTERNAL_ATTESTATION",
                "members": {name: {"sha256": sha(body), "bytes": len(body)}
                            for name, body in sorted(payloads.items())}}
    manifest["manifest_sha256"] = digest(manifest)
    payloads["manifest.json"] = canonical(manifest) + b"\n"
    return payloads


def verify_source(folder):
    folder = Path(folder)
    require(folder.is_dir() and not folder.is_symlink(), "INVALID_EVIDENCE_DIRECTORY")
    require({p.name for p in folder.iterdir()} == SOURCE_FILES | {"manifest.json"}, "UNEXPECTED_EVIDENCE_MEMBERS")
    paths = [folder / name for name in SOURCE_FILES | {"manifest.json"}]
    require(all(p.is_file() and not p.is_symlink() for p in paths) and
            sum(p.stat().st_size for p in paths) <= MAX_BYTES, "INVALID_SOURCE_EVIDENCE_FILE")
    try:
        manifest = decode((folder / "manifest.json").read_bytes())
        require(isinstance(manifest, dict), "INVALID_MANIFEST")
        supplied = manifest.pop("manifest_sha256")
        require(supplied == digest(manifest) and manifest["protocol"] == SOURCE_PROTOCOL and
                set(manifest["members"]) == SOURCE_FILES and manifest["scope"] ==
                "INTERNAL_SOURCE_MAPPING_NOT_EXTERNAL_ATTESTATION", "INVALID_MANIFEST")
        for name, expected in manifest["members"].items():
            body = (folder / name).read_bytes()
            require(expected == {"sha256": sha(body), "bytes": len(body)}, "EVIDENCE_HASH_MISMATCH")
        source = parse_capture((folder / "capture.json").read_bytes())
        require(manifest["capture_sha256"] == source["capture"]["capture_sha256"], "SOURCE_CAPTURE_ID_MISMATCH")
        for name, expected in [("pair-response.json", source["pair_raw"]),
                                ("ohlc-response.json", source["ohlc_raw"]), ("history.csv", source["csv_raw"])]:
            require((folder / name).read_bytes() == expected, "RAW_SOURCE_MAPPING_MISMATCH")
        for name, expected in [("dataset.json", decode(source["dataset_raw"])), ("quality.json", source["quality"])]:
            require(canonical(decode((folder / name).read_bytes())) == canonical(expected),
                    "DERIVED_SOURCE_MAPPING_MISMATCH")
    except (KeyError, TypeError, ValueError, IndexError) as exc:
        if isinstance(exc, ResearchError):
            raise
        raise ResearchError("INVALID_SOURCE_EVIDENCE") from exc
    return source


def save_source(folder, raw):
    publish(folder, render_source(raw))
    source = parse_capture(raw)
    return {"status": "SAVED_UNVERIFIED_SOURCE_OBSERVATIONS", "members": 9,
            "capture_sha256": source["capture"]["capture_sha256"], "quality": source["quality"]}
