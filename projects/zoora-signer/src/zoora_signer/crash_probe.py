"""Crash probe for the restart acceptance test. It holds a lock until killed."""

from __future__ import annotations

import argparse
import time
from pathlib import Path

from zoora_signer.db import connect, init_db


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--db", required=True)
    parser.add_argument("--mode", choices=("hold-reserve", "hold-confirm"), required=True)
    parser.add_argument("--ready", required=True)
    parser.add_argument("--intent", default="crash-intent")
    args = parser.parse_args(argv)
    init_db(args.db, "helius")
    conn = connect(args.db)
    conn.execute("BEGIN IMMEDIATE")
    mint = "4wTV1YmiEkRvAtNtsSGPtUrqRYQMe5SKy2uB4Jjaxnjf"
    if args.mode == "hold-reserve":
        conn.execute(
            """
            INSERT INTO reservations (
              intent_id, side, mint, stake_cents, status, ct_day, created_ms, reached_signing
            ) VALUES (?, 'buy', ?, 200, 'reserved', '2026-11-17', 0, 0)
            """,
            (args.intent, mint),
        )
        Path(args.ready).write_text("ready", encoding="utf-8")
        while True:
            time.sleep(3600)
    conn.execute(
        """
        INSERT INTO reservations (
          intent_id, side, mint, stake_cents, status, ct_day, created_ms,
          reached_signing, signature
        ) VALUES (?, 'buy', ?, 200, 'signing', '2026-11-17', 0, 1, 'pending')
        """,
        (args.intent, mint),
    )
    conn.execute("COMMIT")
    Path(args.ready).write_text("ready", encoding="utf-8")
    while True:
        time.sleep(3600)


if __name__ == "__main__":
    raise SystemExit(main())
