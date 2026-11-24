#!/usr/bin/env node
/**
 * Fact bank CLI: node scripts/facts/cli.ts <command> [options]; --help lists the commands (docs/FACT_BANK.md).
 * Thin entry point. It hides Node's MODULE_TYPELESS_PACKAGE_JSON warning for src/episode/markup.ts (the studio's
 * package.json has no "type" field and is not ours to change), then loads lib/main.ts. For `verify` behind this cloud
 * session's HTTPS proxy it re-runs itself with NODE_USE_ENV_PROXY=1, because Node's fetch ignores HTTPS_PROXY otherwise.
 */
import {spawnSync} from 'node:child_process';
import {quietTypelessWarning} from './lib/detectors.ts';

const argv = process.argv.slice(2);
const proxied = Boolean(process.env.HTTPS_PROXY || process.env.https_proxy);
const proxyOn = process.env.NODE_USE_ENV_PROXY === '1' || process.execArgv.includes('--use-env-proxy');
if (argv[0] === 'verify' && proxied && !proxyOn) {
	const r = spawnSync(process.execPath, [...process.execArgv, '--disable-warning=UNDICI-EHPA', ...process.argv.slice(1)], {
		stdio: 'inherit',
		env: {...process.env, NODE_USE_ENV_PROXY: '1'},
	});
	process.exit(r.status ?? 1);
}
quietTypelessWarning();
const {main} = await import('./lib/main.ts');
process.exitCode = await main(argv);
