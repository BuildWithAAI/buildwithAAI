#!/bin/sh
set -e
mkdir -p /data
chown node:node /data
exec gosu node "$@"
