/**
 * News claim gate (channel 2, zoora-security). Usage: node scripts/news/gate.ts <slug> [options]; --help for more.
 * Writes out/claims/news-<slug>.md and .json. Exit 0 = pass, 1 = fail (each failure has a fix hint), 2 = usage error.
 */
import {existsSync} from 'node:fs';
import {basename, dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {runGate, SLUG_RE, CHANNEL} from './run.ts';
import type {GeneralGateMode} from './general-gate.ts';

const STUDIO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const HELP = `News claim gate for channel 2 (${CHANNEL}). Runs in addition to the general claim gate (scripts/claims).

Usage
  node scripts/news/gate.ts <slug> [options]
  node scripts/news/gate.ts ${CHANNEL}/<slug> [options]
  node scripts/news/gate.ts path/to/<slug>/storyboard.json [options]

Reads   content/${CHANNEL}/<slug>/storyboard.json and brief.json, content/${CHANNEL}/corrections.json,
        scripts/news/allowlist.json
Writes  out/claims/news-<slug>.md (for the owner's review) and out/claims/news-<slug>.json

Options
  --brief <path>             brief.json (default: next to the storyboard). A radar daily file works with --incident.
  --incident <id>            the radar incident to read when --brief is a radar daily file
  --content-root <dir>       default: content/${CHANNEL}
  --corrections <path>       default: <content-root>/corrections.json (a missing file means no corrections)
  --allowlist <path>         default: scripts/news/allowlist.json
  --out <dir>                default: out/claims
  --general-gate <mode>      auto (default: run scripts/claims if it exists), require, or off
  --studio-root <dir>        the video-studio folder (default: this script's)
  --now <ISO time>           timestamp written in the report (tests)
  --json                     print the JSON result instead of the summary
  --quiet                    print only the verdict line
  -h, --help

Exit codes: 0 pass, 1 fail (fix hints in the report), 2 usage error.`;

const usage = (msg: string): never => {
	process.stderr.write(`news gate: ${msg}\nRun with --help for usage.\n`);
	process.exit(2);
};

export const main = (argv: string[]): number => {
	let args;
	try {
		args = parseArgs({
			args: argv,
			allowPositionals: true,
			options: {
				brief: {type: 'string'},
				incident: {type: 'string'},
				'content-root': {type: 'string'},
				corrections: {type: 'string'},
				allowlist: {type: 'string'},
				out: {type: 'string'},
				'general-gate': {type: 'string'},
				'studio-root': {type: 'string'},
				now: {type: 'string'},
				json: {type: 'boolean'},
				quiet: {type: 'boolean'},
				help: {type: 'boolean', short: 'h'},
			},
		});
	} catch (err) {
		return usage(err instanceof Error ? err.message : String(err));
	}
	const {values: v, positionals} = args;
	if (v.help) {
		process.stdout.write(`${HELP}\n`);
		return 0;
	}
	if (positionals.length !== 1) return usage('give exactly one slug (or storyboard path)');
	const studioRoot = v['studio-root'] ? resolve(v['studio-root']) : STUDIO;
	const target = positionals[0];
	let slug: string;
	let storyboardPath: string | undefined;
	if (target.endsWith('.json')) {
		storyboardPath = resolve(target);
		slug = basename(dirname(storyboardPath));
	} else {
		slug = target.startsWith(`${CHANNEL}/`) ? target.slice(CHANNEL.length + 1) : target;
		if (slug.includes('/')) return usage(`"${target}" is not a ${CHANNEL} slug`);
	}
	if (!SLUG_RE.test(slug)) return usage(`"${slug}" is not a valid slug`);
	const mode = (v['general-gate'] ?? 'auto') as GeneralGateMode;
	if (!['auto', 'require', 'off'].includes(mode)) return usage('--general-gate must be auto, require or off');
	if (v.now !== undefined && Number.isNaN(Date.parse(v.now))) return usage('--now must be an ISO date-time');
	const contentRoot = v['content-root'] ? resolve(v['content-root']) : undefined;
	if (contentRoot && !existsSync(contentRoot)) return usage(`--content-root ${contentRoot} does not exist`);

	const run = runGate({
		slug,
		studioRoot,
		storyboardPath,
		briefPath: v.brief ? resolve(v.brief) : storyboardPath ? join(dirname(storyboardPath), 'brief.json') : undefined,
		incident: v.incident,
		contentRoot,
		correctionsPath: v.corrections ? resolve(v.corrections) : undefined,
		allowlistPath: v.allowlist ? resolve(v.allowlist) : undefined,
		outDir: v.out ? resolve(v.out) : undefined,
		generalGate: mode,
		now: v.now,
	});
	const r = run.result;
	if (v.json) process.stdout.write(`${JSON.stringify(r, null, 2)}\n`);
	else {
		const head = `news gate: ${r.verdict.toUpperCase()} ${r.slug} (${r.counts.errors} error${r.counts.errors === 1 ? '' : 's'}, ${r.counts.warnings} warning${r.counts.warnings === 1 ? '' : 's'}; ${r.counts.claimsOk}/${r.counts.claims} claims traced; general gate: ${r.generalGate.status})`;
		const lines = [head];
		if (!v.quiet) {
			for (const f of r.findings.filter((x) => x.severity === 'error')) {
				lines.push(`  [${f.rule}] ${[f.where.scene, f.where.surface].filter(Boolean).join(' ')}: ${f.message}`);
				lines.push(`      fix: ${f.fix}`);
			}
			if (run.mdPath) lines.push(`report: ${run.mdPath}`);
		}
		process.stdout.write(`${lines.join('\n')}\n`);
	}
	return r.verdict === 'pass' ? 0 : 1;
};

