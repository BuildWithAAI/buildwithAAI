"""Markdown + HTML research report with equity / drawdown PNGs."""

from __future__ import annotations

import html
import json
import math
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import pandas as pd  # noqa: E402


def plot_equity(is_eq: pd.Series, oos_eq: pd.Series, title: str, path: Path) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    fig, (ax1, ax2) = plt.subplots(2, 1, figsize=(11, 6), sharex=True, gridspec_kw={"height_ratios": [3, 1.3]})
    for eq, label, color in ((is_eq, "in-sample", "#9aa5b1"), (oos_eq, "out-of-sample", "#1f6feb")):
        if eq is None or eq.empty:
            continue
        ax1.plot(eq.index, eq.values, color=color, lw=1.2, label=label)
        dd = eq / eq.cummax() - 1
        ax2.fill_between(dd.index, dd.values * 100, 0, color=color, alpha=0.5)
    if oos_eq is not None and not oos_eq.empty:
        ax1.axvline(oos_eq.index[0], color="k", ls="--", lw=0.8)
    ax1.set_ylabel("equity (USDT)")
    ax1.set_title(title + "  (each segment starts at initial equity)", fontsize=10)
    ax1.legend(loc="upper left", fontsize=8)
    ax1.grid(alpha=0.3)
    ax2.set_ylabel("drawdown %")
    ax2.grid(alpha=0.3)
    fig.tight_layout()
    fig.savefig(path, dpi=110)
    plt.close(fig)
    return path


def plot_sweep_hist(df: pd.DataFrame, title: str, path: Path) -> Path:
    fig, ax = plt.subplots(figsize=(7, 3.2))
    for col, color, label in (("is_expectancy_r", "#9aa5b1", "IS"), ("oos_expectancy_r", "#1f6feb", "OOS")):
        vals = df[col].dropna()
        if len(vals):
            ax.hist(vals, bins=20, alpha=0.6, color=color, label=label)
    ax.axvline(0, color="k", lw=0.8)
    ax.set_title(title, fontsize=9)
    ax.set_xlabel("expectancy (R) across parameter grid")
    ax.legend(fontsize=8)
    fig.tight_layout()
    path.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(path, dpi=110)
    plt.close(fig)
    return path


def _fmt(v, kind: str = "") -> str:
    if v is None or (isinstance(v, float) and (math.isnan(v))):
        return "–"
    if isinstance(v, float) and math.isinf(v):
        return "inf"
    if kind == "pct":
        return f"{v * 100:.2f}%"
    if kind == "f2":
        return f"{v:.2f}"
    if kind == "f3":
        return f"{v:.3f}"
    return str(v)


TABLE_COLS = [("trades", ""), ("net_return", "pct"), ("sharpe", "f2"), ("sortino", "f2"), ("max_drawdown", "pct"),
              ("win_rate", "pct"), ("profit_factor", "f2"), ("expectancy_r", "f3"), ("exposure", "pct"),
              ("total_fees", "f2"), ("total_funding", "f3")]


def metrics_table(rows: list[dict], label_keys: list[str]) -> str:
    head = "| " + " | ".join(label_keys + [c for c, _ in TABLE_COLS]) + " |"
    sep = "|" + "---|" * (len(label_keys) + len(TABLE_COLS))
    lines = [head, sep]
    for r in rows:
        m = r["metrics"]
        lines.append("| " + " | ".join([str(r[k]) for k in label_keys] + [_fmt(m.get(c), k) for c, k in TABLE_COLS])
                     + " |")
    return "\n".join(lines)


def md_to_html(md: str, title: str) -> str:
    """Tiny markdown->HTML (headings, tables, images, paragraphs, lists, code) to avoid extra deps."""
    out, in_table, in_list, in_code = [], False, False, False
    for line in md.splitlines():
        if line.startswith("```"):
            out.append("</pre>" if in_code else "<pre>")
            in_code = not in_code
            continue
        if in_code:
            out.append(html.escape(line))
            continue
        if line.startswith("|"):
            cells = [c.strip() for c in line.strip("|").split("|")]
            if set("".join(cells)) <= set("-: "):
                continue
            if not in_table:
                out.append("<table>")
                in_table = True
                out.append("<tr>" + "".join(f"<th>{html.escape(c)}</th>" for c in cells) + "</tr>")
            else:
                out.append("<tr>" + "".join(f"<td>{html.escape(c)}</td>" for c in cells) + "</tr>")
            continue
        if in_table:
            out.append("</table>")
            in_table = False
        if line.startswith("- "):
            if not in_list:
                out.append("<ul>")
                in_list = True
            out.append(f"<li>{html.escape(line[2:])}</li>")
            continue
        if in_list:
            out.append("</ul>")
            in_list = False
        if line.startswith("!["):
            alt, src = line[2:].split("](", 1)
            out.append(f'<img alt="{html.escape(alt)}" src="{html.escape(src.rstrip(")"))}" style="max-width:100%">')
        elif line.startswith("#"):
            n = len(line) - len(line.lstrip("#"))
            out.append(f"<h{n}>{html.escape(line[n:].strip())}</h{n}>")
        elif line.strip():
            out.append(f"<p>{html.escape(line)}</p>")
    if in_table:
        out.append("</table>")
    style = ("body{font-family:system-ui,sans-serif;max-width:1200px;margin:2em auto;padding:0 1em;color:#222}"
             "table{border-collapse:collapse;font-size:12px;margin:1em 0}td,th{border:1px solid #ccc;padding:3px 6px;"
             "text-align:right}th{background:#f3f4f6}pre{background:#f6f8fa;padding:1em;overflow:auto}")
    return f"<!doctype html><html><head><meta charset='utf-8'><title>{html.escape(title)}</title>" \
           f"<style>{style}</style></head><body>{''.join(out)}</body></html>"


def write_json(obj, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, indent=2, default=str))
