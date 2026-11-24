# Security report: unauthenticated Docker Engine API on my Grok Bot box

**Summary:** The Docker Engine API is reachable on TCP port 2375 on my box with no TLS and no authentication.

**How I verified it (read-only):** On Nov 9, 2026 at 6:53 PM CT (America/Chicago), a plain `GET http://localhost:2375/version` returned HTTP 200 with Docker Engine - Community 29.1.4 (API 1.52, containerd v2.2.5, runc 1.3.6). `/_ping` also returned 200 with no credentials. `ss -ltn` shows the port listening on `0.0.0.0:2375` (all interfaces). No changes were made through the API.

**Impact:** Any process on the box, including a compromised package, script or AI agent, can use this API to start privileged containers, mount the host filesystem and get root-equivalent control or escape the sandbox. That bypasses every other control I run. If the port is reachable from outside the box, anyone on that network could do the same.

**Requests:**
1. Bind the Docker API to a Unix socket only, or require TLS client-certificate auth (port 2376).
2. Confirm whether port 2375 is reachable from outside my box (other tenants, internal network, internet), and if so, for how long.
3. Confirm whether this is intended platform behavior.
