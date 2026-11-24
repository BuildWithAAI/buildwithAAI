/**
 * CLI for the daily orchestrator. Exit codes:
 *   prepare  0 brief ready · 3 no video today · 1 error · 2 usage
 *   build    0 packet ready to approve · 1 packet written but NOT ready (or error) · 2 usage
 *   approve  0 approved and drafts written · 1 refused (not ready, stale, wrong reply) · 2 usage
 *   status   0
 */
import {parseArgs} from 'node:util';
import {realExec, type Exec} from './exec.ts';
import {STUDIO_ROOT} from './paths.ts';
import {isDate, parseDateSlug} from './util.ts';

export const HELP = `Daily orchestrator for channel 2 (zoora-security). Run from projects/video-studio.

  node scripts/daily/run.ts prepare [--date YYYY-MM-DD] [--radar live|reuse|offline] [--pick <incident id>]
                                    [--format daily-short|what-we-know] [--force]
      Runs the radar, picks today's story and 2 alternates, writes
      content/zoora-security/<date>-<slug>/brief.json and WRITER.md, and out/daily/<date>/prepare.{json,md}.
      --date defaults to today in America/Chicago. --radar reuse reads the file an earlier run wrote (no fetches).
      Exit 0 brief ready, 3 no video today, 1 error.

  node scripts/daily/run.ts build <date-slug> [--only gates] [--skip voice,render,thumbnails,publish-kit]
      Runs the general claim gate (if present), the news gate, the voice (im_nicola), the ShowShort render, the
      thumbnails and the publish kit, then writes out/approval/<date-slug>/approval.html, approval.md and packet.json.
      Exit 0 ready to approve, 1 not ready (the packet says why).

  node scripts/daily/run.ts approve <date-slug> --reply "APPROVE <date-slug>" [--by owner] [--youtube-id <id>]
      Records content/zoora-security/<date-slug>/approval.json (who, when, version hashes) after checking the reply
      and that nothing changed since the packet was built, then writes the announcer and Threat Brief drafts
      (dry-run unless the hub tools and their credentials exist). Never uploads: uploads stay manual in YouTube Studio.
      Later, --youtube-id <id> (without --reply) records the id of the manual upload and refreshes the drafts.

  node scripts/daily/run.ts status <date-slug>

Common options: --root <video-studio dir> (default: this checkout), --json (print the result as JSON).`;

const usage = (msg: string): number => {
	process.stderr.write(`daily: ${msg}\nRun with --help for usage.\n`);
	return 2;
};

export type MainDeps = {exec?: Exec; now?: () => Date; env?: NodeJS.ProcessEnv; out?: (s: string) => void; err?: (s: string) => void};

export const main = async (argv: string[], deps: MainDeps = {}): Promise<number> => {
	const out = deps.out ?? ((s: string) => process.stdout.write(`${s}\n`));
	const exec = deps.exec ?? realExec;
	const [cmd, ...rest] = argv;
	if (!cmd || cmd === '-h' || cmd === '--help' || cmd === 'help') {
		out(HELP);
		return cmd ? 0 : 2;
	}
	let parsed;
	try {
		parsed = parseArgs({
			args: rest,
			allowPositionals: true,
			options: {
				date: {type: 'string'},
				radar: {type: 'string'},
				pick: {type: 'string'},
				format: {type: 'string'},
				force: {type: 'boolean'},
				only: {type: 'string'},
				skip: {type: 'string'},
				reply: {type: 'string'},
				by: {type: 'string'},
				'youtube-id': {type: 'string'},
				root: {type: 'string'},
				json: {type: 'boolean'},
				help: {type: 'boolean', short: 'h'},
			},
		});
	} catch (err) {
		return usage(err instanceof Error ? err.message : String(err));
	}
	const v = parsed.values;
	if (v.help) {
		out(HELP);
		return 0;
	}
	const root = v.root ?? STUDIO_ROOT;
	const log = v.json ? () => {} : out;
	const env = deps.env ?? process.env;

	if (cmd === 'prepare') {
		if (parsed.positionals.length) return usage('prepare takes no positional arguments');
		if (v.date !== undefined && !isDate(v.date)) return usage('--date must be YYYY-MM-DD');
		const radar = v.radar ?? 'live';
		if (radar !== 'live' && radar !== 'reuse' && radar !== 'offline') return usage('--radar must be live, reuse or offline');
		if (v.format !== undefined && v.format !== 'daily-short' && v.format !== 'what-we-know') return usage('--format must be daily-short or what-we-know');
		const {runPrepare} = await import('./prepare.ts');
		const r = runPrepare({root, date: v.date, radar, pick: v.pick, format: v.format as 'daily-short' | 'what-we-know' | undefined, force: v.force, exec, now: deps.now, env, log});
		if (v.json) out(JSON.stringify({exitCode: r.exitCode, date: r.date, dateSlug: r.dateSlug, decision: r.selection?.decision ?? null, reason: r.selection?.decisionReason ?? null, files: r.files, messages: r.messages}, null, 2));
		return r.exitCode;
	}

	const slugArg = parsed.positionals[0];
	if (cmd === 'build' || cmd === 'approve' || cmd === 'status') {
		if (parsed.positionals.length !== 1 || !slugArg) return usage(`${cmd} needs exactly one <date-slug>`);
		if (!parseDateSlug(slugArg)) return usage(`"${slugArg}" is not a <date>-<slug> such as 2026-11-24-binance`);
	}
	if (cmd === 'build') {
		const skip = new Set((v.skip ?? '').split(',').map((s) => s.trim()).filter(Boolean));
		for (const s of skip) if (!['voice', 'render', 'thumbnails', 'publish-kit'].includes(s)) return usage(`--skip: unknown step "${s}"`);
		if (v.only !== undefined && v.only !== 'gates') return usage('--only takes "gates"');
		const {runBuild} = await import('./build.ts');
		const r = await runBuild({root, dateSlug: slugArg, exec, now: deps.now, env, log, skip, onlyGates: v.only === 'gates'});
		if (v.json) out(JSON.stringify(r.packet ?? {error: r.error}, null, 2));
		return r.exitCode;
	}
	if (cmd === 'approve') {
		const yt = v['youtube-id'];
		if (yt !== undefined && !/^[A-Za-z0-9_-]{11}$/.test(yt)) return usage('--youtube-id must be an 11-character YouTube video id');
		if (v.reply === undefined && yt === undefined) return usage('approve needs --reply "<the owner\'s reply>" (or --youtube-id <id> after the manual upload)');
		const by = v.by ?? 'owner';
		if (!/^[a-z][a-z0-9_-]{1,31}$/.test(by)) return usage('--by must be a short role such as "owner" (the repo is public: no personal names)');
		const {runApprove} = await import('./approve.ts');
		const r = await runApprove({root, dateSlug: slugArg, reply: v.reply, by, youtubeId: yt, exec, now: deps.now, env, log});
		if (v.json) out(JSON.stringify(r, null, 2));
		return r.exitCode;
	}
	if (cmd === 'status') {
		const {statusOf} = await import('./status.ts');
		const s = statusOf(root, slugArg);
		out(v.json ? JSON.stringify(s, null, 2) : s.lines.join('\n'));
		return 0;
	}
	return usage(`unknown command "${cmd}"`);
};
