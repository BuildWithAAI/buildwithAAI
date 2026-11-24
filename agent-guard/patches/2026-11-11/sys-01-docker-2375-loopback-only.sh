#!/usr/bin/env bash
# sys-01: Docker Engine API on tcp/2375 is open on 0.0.0.0 with no TLS and no auth.
# Anyone who can reach 172.30.0.2:2375 can start a privileged container that mounts the host.
# Default: dry run (read-only). --apply: drop tcp/2375 from every interface except loopback with nftables.
# The real fix is on the platform side: start dockerd with -H unix:///var/run/docker.sock (or
# -H tcp://127.0.0.1:2375 plus --tlsverify). dockerd is not in this box's PID namespace.
# OWNER DECISION: anything that drives Docker from outside the box over 2375 will stop working.
set -euo pipefail
APPLY=0; [ "${1:-}" = "--apply" ] && APPLY=1
echo "== listener"; ss -ltn 'sport = :2375' || true
echo "== unauthenticated API reachable?"
if curl -s -m 3 http://127.0.0.1:2375/_ping | grep -q OK; then
  echo "YES: /_ping answers without credentials"
  curl -s -m 3 http://127.0.0.1:2375/version | python3 -c 'import sys,json;j=json.load(sys.stdin);print("engine",j.get("Version"),"api",j.get("ApiVersion"))' || true
else
  echo "no answer on 127.0.0.1:2375"
fi
RULESET='table inet agentguard_docker {
  chain input { type filter hook input priority -10; policy accept;
    iifname "lo" tcp dport 2375 accept
    tcp dport 2375 counter drop
  }
}'
echo "== planned nftables ruleset"; echo "$RULESET"
if [ "$APPLY" -ne 1 ]; then echo "DRY RUN. Re-run with --apply to install nftables and load the ruleset (not persistent across reboots)."; exit 0; fi
command -v nft >/dev/null || sudo -n apt-get install -y --no-install-recommends nftables
echo "$RULESET" | sudo -n nft -f - || { echo "nft failed (no CAP_NET_ADMIN in this sandbox?). Ask the platform to rebind dockerd."; exit 1; }
sudo -n nft list table inet agentguard_docker
echo "Rollback: sudo nft delete table inet agentguard_docker"
