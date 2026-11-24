# Patches, Nov 11, 2026 (vulnerability sweep)

None of these patches have been applied. Code patches are `git format-patch` files. Each one applied cleanly on its base, and its base plus that patch passed `tsc --noEmit`, `vitest run` and `npm run build`. The stacked results were tested too. System scripts default to a read-only dry run and change nothing without `--apply`.
Full findings: `/workspace/agent-guard/reports/vuln_sweep_2026-11-11.md`.

## Code (BuildWithAAI/buildwithAAI, projects/lumen)

| # | File | Severity | Fixes | Base SHA | Tests after |
|---|------|----------|-------|----------|-------------|
| 01 | code-01-pr88-ledger-boot-fork-and-busy.patch | Low | A pre-forked ledger crash-loops at boot (db.ts:72). Cold-start "database is locked" (db.ts:443/445) | 468dc57 (also applies on bc6489e) | 206/206 |
| 02 | code-02-pr88-card-filter-fields.patch | Low | No USPS/IMpb exemption in merchant/reason. 420+ZIP false positive. UUID false positive. Token-field skip only at top level. Failure reason capped before it reaches the ledger | 468dc57 (also applies on bc6489e) | 209/209 |
| 03 | code-03-pr88-deps-npm-audit.patch | Medium (dev/build chain) | npm audit 5 → 0: vitest 4.1.12, postcss override 8.5.32, esbuild declared, vitest jsx config | 468dc57 (also applies on bc6489e alone; conflicts with 06, so use 08 on the PR #91 stack) | 204/204 |
| 04 | code-04-pr91-visitor-cap-fairness.patch | Medium (visitors ON) | N-1r: at most 8 live tokens per address/64, eviction of the over-share prefix when full, cap applied after rate checks | bc6489e | 227/227 |
| 05 | code-05-pr91-chunk-chain-tail-and-recovery.patch | Low | L-16 tail hash check on every append. L-14 freeze lifts on re-verify (boot plus desk button) | bc6489e | 225/225 |
| 06 | code-06-pr91-predeploy-readonly.patch | Low | L-15: read-only predeploy, refuses a missing file or old-hash rows, vite-node declared, HOSTING_FLY.md step | bc6489e | 224/224 |
| 07 | code-07-pr91-info-hardening.patch | Info | Default_Ignorable chars, nearby filter before the cap, chain refuses a Zoora privacy-off row, import-graph sink test, .env.example | bc6489e | 225/225 |
| 08 | code-08-pr91-deps-npm-audit-after-06.patch | Medium (dev/build chain) | Same as 03, regenerated on top of 06 | bc6489e + 01,02,04,05,06,07 | 239/239 (full stack) |

Tested stacks:
- PR #88: 468dc57 + 01, 02, 03 gives tsc OK, 211/211 tests, build OK, npm audit 0.
- PR #91: bc6489e + 01, 02, 04, 05, 06, 07, 08 gives tsc OK, 239/239 tests, build OK, npm audit 0, and the local CSP smoke result is in the report.

Applying, from a clean checkout of the PR branch (only Software Engineer does this, on their branch):

```bash
# PR #88 (cursor/... at 468dc57)
git am /path/code-01-*.patch /path/code-02-*.patch /path/code-03-*.patch
# PR #91 (cursor/metaverse-m1 at bc6489e); 01 and 02 also apply here because PR #91 is stacked on 468dc57
git am /path/code-01-*.patch /path/code-02-*.patch /path/code-04-*.patch /path/code-05-*.patch \
       /path/code-06-*.patch /path/code-07-*.patch /path/code-08-*.patch
cd projects/lumen && npm ci && npx tsc --noEmit && npx vitest run && npm run build
```

Notes:
- 05 changes one existing test (metaverse.test.ts): the forged home-private row is now correctly hash-chained, because the append path now refuses a forged tail.
- 06 changes one existing assertion: predeploy no longer writes a desk alert. The boot path still does.
- Check the PowerShell quoting of the `fly ssh console` line in 06 (HOSTING_FLY.md) on the owner machine before relying on it.

## System (shared box)

Run as `bash <script>` for the dry run. Add `--apply` only after the owner approves.

| # | Script | Severity | What --apply does | Owner decision |
|---|--------|----------|-------------------|----------------|
| sys-01 | sys-01-docker-2375-loopback-only.sh | High | Installs nftables and drops tcp/2375 except on loopback (not persistent, may need CAP_NET_ADMIN). The real fix is the platform rebinding dockerd | **Yes**: may break anything that uses Docker over 2375 |
| sys-02 | sys-02-plaintext-key-lockdown.sh | High | chmod 600 on the plaintext RSA key and a key-like transcript. Never reads them | **Yes**: rotate the RSA key wherever its public half is trusted |
| sys-03 | sys-03-telegram-token-exposure.sh | High | Adds an unset for both Telegram vars in ~/.bashrc (new shells only) | **Yes**: revoke and reissue both bot tokens in @BotFather; stop box-wide injection |
| sys-04 | sys-04-perms-and-tmp-hygiene.sh | Low | `--apply`: chmod 600 on world-readable secret-bearing files. `--delete-stale`: remove stale box-owned /tmp scratch | Deletion only |
| sys-05 | sys-05-package-updates.sh | Medium | apt only-upgrade zlib1g and libreoffice; pip upgrade in 5 venvs | Low risk; confirm a maintenance window |
