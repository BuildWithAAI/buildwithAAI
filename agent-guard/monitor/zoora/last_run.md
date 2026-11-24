# zoora.ai monitor run — 2026-11-24 5:04 PM America/Chicago

Slot: evening (9:00 AM / 5:00 PM America/Chicago schedule).

## Cutover
Not seen. Apex still GitHub Pages, www CNAME expected buildwithaai.github.io., lumen-tidepool.fly.dev NXDOMAIN. Pre-launch posture unchanged vs the Nov 10 report.

## Checks
- DNS: unchanged vs baseline.
- Known open items still open: missing_dmarc, missing_caa, missing_dnssec.
- Certificate transparency (crt.sh): 2 unique entries. new_vs_known=none. issuers=["C=US, O=Let's Encrypt, CN=YE1"].
- gitleaks since 2026-11-17T22:52:56+00:00: 247 commits in window, 13 findings, 0 potential real, 13 false positives (2 in proof/injections.ts initially flagged, then reviewed as fixture key: fields).
- Repo: default main=4733ad08edb4 PR cursor/lumen-jellyfish-9263=a7a504114b58. new_branches=['claude/audit-1122', 'claude/audit-20261121', 'claude/audusd-book', 'claude/balance', 'claude/buildings-enter', 'claude/city-buy', 'claude/city-units', 'claude/economy-foundation', 'claude/economy-readers', 'claude/economy-whole-business', 'claude/engine-upgrades', 'claude/forex-rule', 'claude/forge', 'claude/forge-index', 'claude/fx-check', 'claude/her-world', 'claude/injection-defense', 'claude/ladder-brakes', 'claude/land-paths', 'claude/landed-20261121', 'claude/live-look', 'claude/live-only', 'claude/lumen-security-fixes-20261120', 'claude/no-paper', 'claude/one-style', 'claude/open-from-day-one', 'claude/print-checkout', 'claude/roads-connect', 'claude/rooms', 'claude/self-image', 'claude/setup-day', 'claude/soul-caeo-mind', 'claude/tidal-memory', 'claude/trade-rules', 'claude/unit-pay', 'claude/unit-prices', 'claude/venture-desk', 'claude/venture-plans', 'claude/youtube-video-pipeline-dcfqfr', 'dependabot/github_actions/actions/checkout-7', 'dependabot/github_actions/actions/deploy-pages-5', 'dependabot/github_actions/actions/setup-python-7.1.0', 'dependabot/github_actions/actions/upload-pages-artifact-5', 'dependabot/github_actions/dtolnay/rust-toolchain-df2a88e9fe4098bad09cb42c3dec7187f15861fc', 'dependabot/npm_and_yarn/projects/lumen/next-16.4.6', 'dependabot/npm_and_yarn/projects/lumen/playwright-1.65.1', 'dependabot/npm_and_yarn/projects/lumen/suncalc-2.1.4', 'dependabot/npm_and_yarn/projects/lumen/types/node-26.6.6', 'dependabot/npm_and_yarn/projects/lumen/typescript-7.0.2', 'origin'].
- Skipped: uptime /healthz (pre-cutover: zoora.ai does not point to Fly).
- Skipped: security headers and closed-route probes (pre-cutover).
- Skipped: headless Chrome CSP checks of / and /world (pre-cutover).
- Skipped: TLS expiry/issuer via openssl (morning-only).
- Skipped: dnstwist lookalikes (morning-only).
- Skipped: npm audit of projects/lumen (morning-only).

## Failures
None.

## Alerts
None. Two generic-api-key hits in a backtranslate proof fixture were reviewed and not alerted (false positives).

## State written
dns_current.json, state.json, last_run.md, certs_current.json, gitleaks_current.json, repo_refs_baseline.txt
