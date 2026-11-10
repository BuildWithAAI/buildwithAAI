#!/bin/sh
set -e
mkdir -p /data
chown node:node /data
if [ -z "$LUMEN_DESK_SECRET" ]; then
  LUMEN_DESK_SECRET="$(node -e "process.stdout.write(require('crypto').randomBytes(24).toString('hex'))")"
  export LUMEN_DESK_SECRET
fi
gosu node ./desk-proxy.mjs &
exec gosu node "$@"
