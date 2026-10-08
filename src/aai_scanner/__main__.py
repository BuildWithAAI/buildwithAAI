"""Run the scanner, explicitly authorized bot, backups, or live smoke checks."""
import argparse
import json
import sys
from pathlib import Path
from .config import Config
from .market import WRAPPED_SOL
from .service import Scanner
from .storage import Store
from .web import Application


def main():
    parser = argparse.ArgumentParser(description="AAI read-only Solana scanner")
    actions = parser.add_subparsers(dest="action", required=True)
    actions.add_parser("serve")
    actions.add_parser("telegram")
    actions.add_parser("telegram-check")
    backup = actions.add_parser("backup")
    backup.add_argument("destination")
    smoke = actions.add_parser("smoke")
    smoke.add_argument("--mint", default=WRAPPED_SOL)
    smoke.add_argument("--output")
    smoke.add_argument("--require-holders", action="store_true")
    smoke.add_argument("--require-activity", action="store_true")
    args = parser.parse_args()
    config = Config.from_env()
    store = Store(config.database)
    scanner = Scanner(config, store)
    try:
        if args.action == "serve":
            try:
                from waitress import serve
            except ImportError:
                raise ValueError("Install requirements-scanner.txt before serving") from None
            print(f"AAI scanner at {config.public_url}; signing and execution disabled", flush=True)
            serve(Application(config, store, scanner), host=config.host, port=config.port,
                  threads=8, connection_limit=64, backlog=64, channel_timeout=30,
                  max_request_body_size=4096, max_request_header_size=16384,
                  expose_tracebacks=False, clear_untrusted_proxy_headers=True)
        elif args.action == "backup":
            store.backup(args.destination)
            print("Backup created and integrity checked")
        elif args.action in ("telegram", "telegram-check"):
            from .telegram import TelegramBot
            bot = TelegramBot(scanner, store, config.public_url)
            if args.action == "telegram-check":
                print(json.dumps(bot.check()))
            else:
                bot.run()
        else:
            report = scanner.scan(args.mint, refresh=True)
            evidence = {
                "verification_type": "LIVE_READ_ONLY_SMOKE", "available_at": report["available_at"],
                "mint": args.mint, "network_evidence": report["network_evidence"],
                "mint_status": report["mint_info"]["status"],
                "token_program": report["mint_info"].get("token_program"),
                "slot": report["mint_info"].get("slot"),
                "market_price_usd": report["market"]["price_usd"],
                "market_price_sol": report["market"]["price_sol"],
                "holder_status": report["holders"]["status"],
                "activity_status": report["activity"]["status"],
                "limitations": report["limitations"],
                "coverage": report["coverage"],
                "rpc_providers": scanner.rpc.diagnostics(),
                "mint_receipt": report["mint_info"]["evidence"],
                "holder_receipt": report["holders"].get("source"),
                "activity_receipt": report["activity"].get("source"),
            }
            passed = (evidence["mint_status"] == "AVAILABLE"
                      and evidence["market_price_usd"]["status"] == "AVAILABLE"
                      and evidence["market_price_sol"]["status"] == "AVAILABLE"
                      and evidence["network_evidence"] is not None)
            passed = passed and (not args.require_holders or evidence["holder_status"] == "AVAILABLE")
            passed = passed and (not args.require_activity or evidence["activity_status"] == "AVAILABLE")
            evidence["required_optional_sources"] = [key for key, required in (("holders", args.require_holders),
                                                                             ("activity", args.require_activity)) if required]
            evidence["status"] = "PASSED" if passed else "FAILED"
            output = json.dumps(evidence, indent=2, allow_nan=False)
            if args.output:
                target = Path(args.output)
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text(output + "\n", encoding="utf-8")
            print(output)
            return 0 if passed else 1
    finally:
        store.close()
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (ValueError, RuntimeError):
        print("Scanner command failed. Check configuration, provider availability and setup instructions.", file=sys.stderr)
        sys.exit(1)
