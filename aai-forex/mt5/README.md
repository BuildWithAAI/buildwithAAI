# MT5 Linux installation attempt

Status recorded 2026-11-06T15:42:39.488938-06:00 (America/Chicago).

## Verified results
- Box: Debian GNU/Linux 13 (trixie), x86_64, user box.
- Xvfb and xauth already installed; Wine / wine64 absent.
- Official installer downloaded successfully (23784536 bytes).
- SHA256: `a879492dd9d7b168d0538edd1c0dc5604ca43dc0951825b3501818e8b18f4c93` (local integrity fingerprint, not publisher signature verification).
- Wine installation could not begin: `sudo apt-get update` failed with HTTP 500 for all three Debian repositories at deb.debian.org, followed by repository-not-signed errors. No signature checks were disabled and no repository settings were changed.
- MT5 not installed; terminal64.exe and metaeditor64.exe not available. Headless launch, EA compilation, history retrieval and Strategy Tester therefore NOT tested.
- No demo account created, no credentials used, no trades placed, no backtest results or report generated.
- agent-guard and the protected MT5 adapter were not modified.

## Official downloads retained
The originally requested URL with `/metatrader5/mt5setup.exe` returned HTTP 404.
Current official Linux instructions at https://www.metatrader5.com/en/terminal/help/start_advanced/install_linux link to:
https://download.terminal.free/cdn/web/metaquotes.software.corp/mt5/mt5linux.sh
The matching official installer endpoint downloaded successfully:
https://download.terminal.free/cdn/web/metaquotes.software.corp/mt5/mt5setup.exe

Files: `downloads/mt5setup.exe`, `downloads/mt5linux.sh`, `downloads/SHA256SUMS`.
The Linux script was downloaded for reference only; it was NOT executed. Do not run it as a way to bypass the apt/network failure.

## Next steps after package access is restored
1. Install Wine using the normal signed Debian packages. Xvfb/xauth are already present.
2. Use a dedicated prefix, e.g. `WINEPREFIX=$HOME/.mt5`, and run the retained installer with `xvfb-run -a wine downloads/mt5setup.exe /auto` (export WINEPREFIX first).
3. Verify terminal64.exe and metaeditor64.exe under the prefix. Launch with `/portable` and no live-account credentials.
4. Compile a tester-only EA with MetaEditor `/compile:<Windows path> /log`; inspect the compiler log and require an EX5 file, not merely exit code zero.
5. Use `/config:<Windows path to tester.ini>` with a `[Tester]` section. Official parameters: https://www.metatrader5.com/en/terminal/help/start_advanced/start
6. Obtain history only via an authorized free MetaQuotes demo account or an explicitly implemented custom-symbol import. Neither source was exercised here.
7. Run AUDUSD H1, 2025.01.01–2026.01.01, Deposit=100, Currency=USD; save reports in this directory's `reports/`. Do not claim performance until actual tester output exists.

No EA source or runnable tester configuration is supplied: without Wine the compilation and execution safety checks could not be performed. This attempt deliberately stops at the prerequisite failure rather than presenting unverified artifacts as a working system.

## Practical alternative
Use Strategy Tester on Zoorped's Windows PC, keeping all real MT5 credentials there; EAs can be developed and tested in tester-only/demo mode. Continue research with the existing Python backtester meanwhile. This is not evidence that MT5 is incompatible with headless Linux: only that Wine could not be installed in this attempt.
