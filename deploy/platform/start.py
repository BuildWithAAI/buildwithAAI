"""Supervise the existing trusted HTTP proxy and unified application."""
import os
import signal
import subprocess
import sys
import time
from urllib.parse import urlsplit

from zoora_community.wallet_login import public_origin

origin = public_origin(os.environ.get("ZOORA_PUBLIC_ORIGIN"))
if origin is None:
    raise ValueError("HTTPS application origin required")
port = int(os.environ.get("PORT", "8080"))
if not 1024 <= port <= 65535 or port == 8765:
    raise ValueError("invalid external port")
os.environ["ZOORA_PROXY_HOST"] = urlsplit(origin).netloc
os.environ["PORT"] = str(port)
children = []
stopping = False


def stop(_signum, _frame):
    global stopping
    stopping = True


signal.signal(signal.SIGTERM, stop)
signal.signal(signal.SIGINT, stop)
try:
    children.append(subprocess.Popen([sys.executable, "-B", "-m", "zoora_platform"]))
    children.append(subprocess.Popen(["caddy", "run", "--config", "/app/deploy/platform/Caddyfile", "--adapter", "caddyfile"]))
    while not stopping and all(child.poll() is None for child in children):
        time.sleep(0.2)
    if not stopping:
        raise RuntimeError("platform child exited")
finally:
    for child in reversed(children):
        if child.poll() is None:
            child.terminate()
    deadline = time.monotonic() + 12
    for child in reversed(children):
        try:
            child.wait(timeout=max(0.1, deadline - time.monotonic()))
        except subprocess.TimeoutExpired:
            child.kill()
            child.wait(timeout=3)
