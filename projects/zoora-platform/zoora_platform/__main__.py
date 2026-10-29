"""Single-origin server and durable worker supervisor.

Existing community state is upgraded only through its audited backup migration.
Credentials are not rotated, reissued or written to the web directory on boot.
"""
import argparse
from contextlib import closing
import json
import os
from pathlib import Path
import signal
import sqlite3
import time

from zoora_community.store import SCHEMA_VERSION, Store
from zoora_community.wsgi_server import WSGIServer

from .application import Platform
from .ledger import Ledger
from .providers import ModelProvider
from .registry import Registry


def prepare_community(state, owner):
    if not state.exists():
        return Store.initialize(state, owner)
    database = state / "community.sqlite3"
    with closing(sqlite3.connect(database.as_uri() + "?mode=ro", uri=True, autocommit=True)) as db:
        version = db.execute("PRAGMA user_version").fetchone()[0]
    if version != SCHEMA_VERSION:
        backup = state.parent / ("community-schema-" + str(version) + "-" + str(time.time_ns()) + ".sqlite3")
        Store.migrate(state, backup)
    store = Store(state)
    store.audit()
    return store


def main():
    parser = argparse.ArgumentParser(description="Zoora unified platform")
    parser.add_argument("--data", default=os.environ.get("ZOORA_PLATFORM_DATA", "/data"))
    parser.add_argument("--port", type=int, default=8765)
    args = parser.parse_args()
    os.umask(0o077)
    root = Path(args.data).absolute()
    root.mkdir(mode=0o700, parents=True, exist_ok=True)
    if root.is_symlink():
        raise ValueError("unsafe platform state")
    # A mounted volume starts as root; adjust its top directory only.
    if os.name == "posix" and os.geteuid() == 0 and os.environ.get("RAILWAY_VOLUME_MOUNT_PATH") == str(root):
        if not os.path.ismount(root):
            raise ValueError("persistent mount required")
        os.chown(root, 10001, 10001)
        os.chmod(root, 0o700)
        os.setgroups([])
        os.setgid(10001)
        os.setuid(10001)
    if os.name == "posix" and root.stat().st_mode & 0o077:
        raise ValueError("platform directory must be private")
    community = prepare_community(root / "community", root / "owner.credential.json")
    ledger = Ledger(root / "platform.sqlite3")
    server = WSGIServer(community, args.port)
    registry = Registry(community, ModelProvider(), root)
    app = Platform(community, ledger, registry, server.application.runtime.assets["/"][0])
    server.application.extension = app.route
    app.start()

    def stop(_signum, _frame):
        raise KeyboardInterrupt

    signal.signal(signal.SIGTERM, stop)
    print(json.dumps({"event": "ZOORA_PLATFORM_READY", "community_schema": SCHEMA_VERSION,
                      "automatic_registered_worker": True, "private_keys_held": False}), flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        app.close()
        server.shutdown()


if __name__ == "__main__":
    main()
