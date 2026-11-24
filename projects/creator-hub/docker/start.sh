#!/bin/sh
# Starts the creator hub as the unprivileged "node" user (uid 1000).
# Fly.io (and some other hosts) mount volumes owned by root. When the container starts as root, this
# script only gives the data directory to "node" and then drops privileges before Node starts.
# The server itself never runs as root.
set -eu
DATA_DIR="${DATA_DIR:-/data}"
if [ "$(id -u)" = "0" ]; then
	mkdir -p "$DATA_DIR"
	chown -R node:node "$DATA_DIR"
	exec setpriv --reuid=node --regid=node --init-groups --no-new-privs -- node src/server/main.ts
fi
exec node src/server/main.ts
