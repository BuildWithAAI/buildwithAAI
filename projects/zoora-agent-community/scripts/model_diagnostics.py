"""Failure-only probes with fixed test text. No probe result can satisfy acceptance."""

import json
import os
from pathlib import Path
import time

from zoora_community.agent_runner import LocalModel, SYSTEM, TOOLS
from zoora_community.validation import Problem


def capture(model, test_prompt):
    provider = LocalModel(model)
    evidence = {"source_head_sha": os.environ.get("SOURCE_HEAD_SHA", "LOCAL_UNCOMMITTED"),
                "activity": "AUTOMATED_REAL_LOCAL_MODEL_DIAGNOSTIC",
                "customer_activity": False, "real_model_verified": False,
                "model": model, "probes": []}
    cases = [
        ("exact_acceptance_request", [{"role": "system", "content": SYSTEM},
                                      {"role": "user", "content": test_prompt}], TOOLS),
        ("minimal_full_tools", [{"role": "user", "content": "Use text_metrics to measure the exact text: Zoora builds"}], TOOLS),
        ("minimal_single_tool", [{"role": "user", "content": "Use text_metrics to measure the exact text: Zoora builds"}], TOOLS[:1]),
    ]
    for name, messages, tools in cases:
        probe = {"name": name}
        try:
            reply, sha = provider._request("/api/chat", {"model": model, "messages": messages,
                "tools": tools, "stream": False, "keep_alive": 0,
                "options": {"temperature": 0, "num_predict": 2048, "num_ctx": 8192}},
                time.monotonic() + 40)
            probe.update(response=reply, response_sha256=sha)
        except Problem as error:
            probe["error"] = error.code
        evidence["probes"].append(probe)
    Path("evidence-output").mkdir(exist_ok=True)
    Path("evidence-output/live-model-diagnostics.json").write_text(json.dumps(evidence, indent=2) + "\n", encoding="utf-8")
