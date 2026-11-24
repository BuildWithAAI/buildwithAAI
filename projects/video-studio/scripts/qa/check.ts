// Automatic visual QA for any Remotion composition in this project.
//
//   node scripts/qa/check.ts --entry <entry.ts> --comp <id> [--props <json|file.json>] [--frames auto|<list>]
//        [--every <N>] [--max-samples <n>] [--scout-step <k>] [--out <dir>] [--concurrency <n>]
//        [--shorts-zone organic|ads] [--fail-on error|warn] [--keep-frames] [--no-pixels]
//
//   e.g. node scripts/qa/check.ts --entry src/index.ts --comp Preview10s
//        node scripts/qa/check.ts --entry src/charts/dev/index.ts --comp ChartShort
//        node scripts/qa/check.ts --entry src/episode/index.ts --comp EpisodeShort --props '{"channel":"_dev","slug":"engine-demo","lang":"en"}'
//        node scripts/qa/check.ts --entry src/index.ts --comp Preview10s --frames 0,95-105,299
//
// The entry is bundled unchanged; a webpack swap injects a probe into every composition (src/qa/runtime).
// Checks: (1) text overflow and clipping, (2) safe zones (16:9 title-safe; 9:16 Shorts UI), (3) captions and
// text over faces, (4) text contrast >= 4.5:1 from rendered pixels, (5) off-model characters (canonical-render
// comparison, pin / ear-cap / spot / palette heuristics, transforms, effects), (6) banding and blotch risk and
// mid-scene flicker. Writes <out>/report.md, <out>/report.json and <out>/issues/*.png (default out/qa/<comp>).
// Exit 0 = no errors (PASS), 1 = errors (or warnings with --fail-on warn), 2 = bad arguments or a tool failure.
import {createHash} from 'node:crypto';
import {existsSync, mkdirSync, readFileSync, rmSync} from 'node:fs';
import {cpus} from 'node:os';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {openBrowser, type HeadlessBrowser} from '@remotion/renderer';
import {qaRefId, type FrameFacts, type RefItem} from '../../src/qa/protocol.ts';
import {browserExecutable, bundleForQa, PROJECT_ROOT, relToRoot} from './lib/bundle.ts';
import {bannedFindings, characterDomFindings, decompose, faceFindings, oneFrameFindings, textFindings, textKey, zoneFindings} from './lib/checks/dom.ts';
import {contrastFindings} from './lib/checks/contrast.ts';
import {modelPixelFindings, type CharRef, type ModelStats} from './lib/checks/model.ts';
import {gradientFindings, prepareFrame, textureFindings} from './lib/checks/banding.ts';
import {analyseScout, flickerFindings, transitionFrames} from './lib/checks/flicker.ts';
import {buildGeo, demoteInTransitions, demoteTransient, settledAt} from './lib/motion.ts';
import {parseFrameList, planSamples, scoutStep as autoScoutStep, type Reason} from './lib/frames.ts';
import {groupFindings, type Finding, type Issue} from './lib/issues.ts';
import {loadManifest} from './lib/manifest.ts';
import {loadPng, QaRenderer, scoutScale} from './lib/render.ts';
import {renderThumb, writeReport, type ThumbSources} from './lib/report.ts';
import {THRESHOLDS} from './lib/thresholds.ts';
import {zonesFor, type ShortsProfile} from './lib/zones.ts';
import type {Image} from './lib/png.ts';

const TOOL = 'zoora-visual-qa 1.0.0';

type Args = {
	entry: string;
	comp: string;
	props: Record<string, unknown>;
	frames: 'auto' | string;
	every: number | null;
	maxSamples: number;
	scoutStep: number | null;
	out: string | null;
	concurrency: number;
	shortsZone: ShortsProfile;
	failOn: 'error' | 'warn';
	keepFrames: boolean;
	pixels: boolean;
};

const USAGE = `usage: node scripts/qa/check.ts --entry <entry.ts> --comp <id> [--props <json|file.json>] [--frames auto|<list>]
       [--every <N>] [--max-samples <n>] [--scout-step <k>] [--out <dir>] [--concurrency <n>]
       [--shorts-zone organic|ads] [--fail-on error|warn] [--keep-frames] [--no-pixels]`;

class UsageError extends Error {}

export const parseArgs = (argv: string[]): Args => {
	const a: Partial<Args> & {props?: Record<string, unknown>} = {};
	const num = (name: string, v: string, min: number): number => {
		const n = Number(v);
		if (!Number.isInteger(n) || n < min) throw new UsageError(`${name} must be an integer >= ${min}, got "${v}"`);
		return n;
	};
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		const [flag, inline] = arg.startsWith('--') && arg.includes('=') ? [arg.slice(0, arg.indexOf('=')), arg.slice(arg.indexOf('=') + 1)] : [arg, undefined];
		const val = (): string => {
			if (inline !== undefined) return inline;
			const v = argv[++i];
			if (v === undefined) throw new UsageError(`${flag} needs a value`);
			return v;
		};
		switch (flag) {
			case '--entry':
				a.entry = val();
				break;
			case '--comp':
				a.comp = val();
				break;
			case '--props': {
				const v = val().trim();
				let text = v;
				if (!v.startsWith('{')) {
					const file = resolve(v.startsWith('@') ? v.slice(1) : v);
					if (!existsSync(file)) throw new UsageError(`--props: no such file ${v}`);
					text = readFileSync(file, 'utf8');
				}
				try {
					const p = JSON.parse(text);
					if (!p || typeof p !== 'object' || Array.isArray(p)) throw new Error('not an object');
					a.props = p as Record<string, unknown>;
				} catch (err) {
					throw new UsageError(`--props must be a JSON object: ${err instanceof Error ? err.message : String(err)}`);
				}
				break;
			}
			case '--frames':
				a.frames = val();
				break;
			case '--every':
				a.every = num('--every', val(), 1);
				break;
			case '--max-samples':
				a.maxSamples = num('--max-samples', val(), 3);
				break;
			case '--scout-step':
				a.scoutStep = num('--scout-step', val(), 1);
				break;
			case '--out':
				a.out = val();
				break;
			case '--concurrency':
				a.concurrency = num('--concurrency', val(), 1);
				break;
			case '--shorts-zone': {
				const v = val();
				if (v !== 'organic' && v !== 'ads') throw new UsageError('--shorts-zone must be organic or ads');
				a.shortsZone = v;
				break;
			}
			case '--fail-on': {
				const v = val();
				if (v !== 'error' && v !== 'warn') throw new UsageError('--fail-on must be error or warn');
				a.failOn = v;
				break;
			}
			case '--keep-frames':
				a.keepFrames = true;
				break;
			case '--no-pixels':
				a.pixels = false;
				break;
			case '-h':
			case '--help':
				throw new UsageError('');
			default:
				throw new UsageError(`unknown argument ${arg}`);
		}
	}
	if (!a.entry) throw new UsageError('--entry is required');
	if (!a.comp) throw new UsageError('--comp is required');
	return {
		entry: a.entry,
		comp: a.comp,
		props: a.props ?? {},
		frames: a.frames ?? 'auto',
		every: a.every ?? null,
		maxSamples: a.maxSamples ?? 240,
		scoutStep: a.scoutStep ?? null,
		out: a.out ?? null,
		concurrency: a.concurrency ?? Math.max(1, Number(process.env.REMOTION_CONCURRENCY) || Math.min(3, cpus().length)),
		shortsZone: a.shortsZone ?? 'organic',
		failOn: a.failOn ?? 'error',
		keepFrames: a.keepFrames ?? false,
		pixels: a.pixels ?? true,
	};
};

const VISUAL_DROPPED = new Set(['between', 'children']);

/** Canonical placement: same origin and size (and rotation, reported separately), never mirror/stretch/skew. */
export const canonicalMatrix = (ctm: [number, number, number, number, number, number]): RefItem['matrix'] => {
	const d = decompose(ctm);
	const s = Math.sqrt(Math.abs(d.det));
	const th = d.mirrored ? 0 : (d.rotationDeg * Math.PI) / 180;
	const c = Math.cos(th) * s;
	const sn = Math.sin(th) * s;
	const q = (n: number) => Math.round(n * 1e6) / 1e6;
	return [q(c), q(sn), q(-sn), q(c), ctm[4], ctm[5]];
};

export type RunResult = {code: number; verdict: 'PASS' | 'FAIL'; issues: Issue[]; report: string; json: string; toolErrors: string[]};
export type Shared = {serveUrl?: string; browser?: HeadlessBrowser; quiet?: boolean};

export const run = async (args: Args, shared: Shared = {}): Promise<RunResult> => {
	const t0 = Date.now();
	const timings: Record<string, number> = {};
	const log = (m: string) => {
		if (!shared.quiet) console.log(m);
	};
	const outDir = resolve(args.out ?? join(PROJECT_ROOT, 'out', 'qa', args.comp));
	const workDir = join(outDir, 'frames');
	rmSync(join(outDir, 'issues'), {recursive: true, force: true});
	rmSync(workDir, {recursive: true, force: true});
	mkdirSync(join(outDir, 'issues'), {recursive: true});
	const manifest = loadManifest(PROJECT_ROOT);
	const runId = createHash('sha1').update(`${Date.now()}-${Math.random()}`).digest('hex').slice(0, 8);

	log(`Visual QA ${args.comp} (${args.entry})`);
	if (!shared.serveUrl) log('  bundling (QA shim) ...');
	const serveUrl = shared.serveUrl ?? (await bundleForQa(args.entry));
	timings.bundle = Date.now() - t0;

	const browser = shared.browser ?? ((await openBrowser('chrome', {browserExecutable: browserExecutable(), logLevel: 'error'} as never)) as HeadlessBrowser);
	const errors: string[] = [];
	try {
		const r = new QaRenderer({serveUrl, browser, concurrency: args.concurrency, run: runId, workDir, log});
		const comp = await r.select(args.comp, args.props, 'scout');
		const W = comp.width;
		const H = comp.height;
		const D = comp.durationInFrames;
		const zones = zonesFor(W, H, args.shortsZone);
		log(`  ${W}x${H} ${zones.format}, ${comp.fps} fps, ${D} frames`);
		const domFindingsOf = (f: FrameFacts): Finding[] => [...textFindings(f), ...zoneFindings(f, zones), ...faceFindings(f), ...characterDomFindings(f, manifest), ...bannedFindings(f)];

		// ---- scout: DOM facts on every (k-th) frame + 1/8-size frames for cuts and pops ----
		let domFacts = new Map<number, FrameFacts>();
		let plan: ReturnType<typeof planSamples>;
		let step = 1;
		let scouted = 0;
		let transitions = new Set<number>();
		let scoutStats: Array<[number, number, number]> = [];
		const findings: Finding[] = [];
		if (args.frames === 'auto') {
			step = args.scoutStep ?? autoScoutStep(D);
			const scoutFrames = Array.from({length: Math.ceil(D / step)}, (_, i) => i * step);
			const ts = Date.now();
			log(`  scout: ${scoutFrames.length} frames at ${scoutScale(W, H) === 1 ? 'full' : `1/${Math.round(1 / scoutScale(W, H))}`} size ...`);
			const scout = await r.pass('scout', comp, args.props, scoutFrames, {scale: scoutScale(W, H), label: 'scout'});
			timings.scout = Date.now() - ts;
			errors.push(...scout.errors);
			domFacts = scout.facts;
			scouted = scout.facts.size;
			const sa = analyseScout(scout.luma);
			transitions = transitionFrames(sa.boundaries);
			// two instances of the same character in one frame: two scenes are mounted at once (a transition)
			for (const f of domFacts.values()) if (overlapsScenes(f)) transitions.add(f.frame);
			scoutStats = [...sa.meanDiff.keys()].sort((a, b) => a - b).map((f) => [f, Number((sa.meanDiff.get(f) ?? 0).toFixed(2)), Number((sa.changedFrac.get(f) ?? 0).toFixed(3))]);
			const domOnly: Finding[] = [];
			for (const f of domFacts.values()) domOnly.push(...domFindingsOf(f));
			domOnly.push(...oneFrameFindings(domFacts));
			demoteTransient(domOnly, buildGeo(domFacts.values()));
			demoteInTransitions(domOnly, transitions);
			const issueFrames = firstFrames(domOnly);
			plan = planSamples({duration: D, fps: comp.fps, boundaries: sa.boundaries, issueFrames, popCandidates: sa.popCandidates, everyN: args.every ?? undefined, maxSamples: args.maxSamples});
			const cuts = sa.boundaries.filter(([a, b]) => a === b).length;
			log(`  scout: ${cuts} cut(s), ${sa.boundaries.length - cuts} transition(s), ${sa.popCandidates.length} pop candidate(s), ${domOnly.filter((f) => f.severity !== 'info').length} DOM finding(s); ${plan.frames.length} frames to check at full size`);
			findings.push(...domOnly);
		} else {
			const list = parseFrameList(args.frames, D);
			plan = {frames: list, reasons: new Map(list.map((f) => [f, new Set<Reason>(['listed'])])), everyN: 0, scenes: [[0, D]]};
		}

		let contrastMeasured = 0;
		let contrastSkipped = 0;
		let contrastLowest = Infinity;
		const stats: ModelStats = {compared: 0, skipped: [], worstSsim: 1, maxChangedFrac: 0};
		let P = new Map<number, string>();
		let Tfiles = new Map<number, string>();
		let Sfiles = new Map<number, string>();
		const refFile = new Map<string, string>();
		const pFacts = new Map<number, FrameFacts>();
		if (args.pixels) {
			// ---- full-size passes on the sampled frames ----
			const tp = Date.now();
			log(`  pixels: ${plan.frames.length} frames ...`);
			const pass = await r.pass('pixels', comp, args.props, plan.frames, {label: 'pixels'});
			errors.push(...pass.errors);
			P = pass.files;
			for (const [k, v] of pass.facts) pFacts.set(k, v);
			if (args.frames !== 'auto') {
				const listed: Finding[] = [];
				for (const f of pFacts.values()) listed.push(...domFindingsOf(f));
				listed.push(...oneFrameFindings(pFacts));
				demoteTransient(listed, buildGeo(pFacts.values()));
				findings.push(...listed);
				scouted = pFacts.size;
				domFacts = pFacts;
			} else {
				// frames the scout skipped (scout step > 1) still get the DOM checks
				const extra: Finding[] = [];
				for (const [k, f] of pFacts) if (!domFacts.has(k)) extra.push(...domFindingsOf(f));
				demoteTransient(extra, buildGeo([...domFacts.values(), ...pFacts.values()]));
				findings.push(...extra);
			}
			const geo = buildGeo([...domFacts.values(), ...pFacts.values()]);
			const withText = plan.frames.filter((f) => pFacts.get(f)?.texts.some((t) => t.role !== 'badge'));
			const withChars = plan.frames.filter((f) => (pFacts.get(f)?.chars.length ?? 0) > 0);
			if (withText.length) {
				log(`  textoff: ${withText.length} frames ...`);
				const t = await r.pass('textoff', comp, args.props, withText, {label: 'textoff'});
				errors.push(...t.errors);
				Tfiles = t.files;
			}
			if (withChars.length) {
				log(`  solo: ${withChars.length} frames ...`);
				const s = await r.pass('solo', comp, args.props, withChars, {label: 'solo'});
				errors.push(...s.errors);
				Sfiles = s.files;
				// canonical references: one render per character instance
				const items: RefItem[] = [];
				const keys: string[] = [];
				for (const fr of withChars) {
					const ff = pFacts.get(fr) as FrameFacts;
					ff.chars.forEach((c, i) => {
						if (!c.props || !c.ctm || c.droppedProps.some((k) => VISUAL_DROPPED.has(k)) || c.effects.opacity < THRESHOLDS.model.minOpacity) return;
						items.push({kind: c.kind, props: c.props, localFrame: c.localFrame, matrix: canonicalMatrix(c.ctm)});
						keys.push(`${fr}:${i}`);
					});
				}
				if (items.length) {
					log(`  canonical references: ${items.length} renders ...`);
					const refProps = {items, width: W, height: H, fps: comp.fps, durationInFrames: D};
					const refComp = await r.select(qaRefId(args.comp), refProps, 'ref');
					const rp = await r.pass('ref', refComp, refProps, items.map((_, i) => i), {label: 'ref'});
					errors.push(...rp.errors);
					for (const [i, file] of rp.files) refFile.set(keys[i], file);
				}
			}
			timings.render = Date.now() - tp;

			// ---- pixel analysis, frame by frame (sliding window of three for flicker) ----
			const ta = Date.now();
			const cache = new Map<number, Image>();
			const scene = (f: number): Image | null => {
				const file = P.get(f);
				if (!file) return null;
				let img = cache.get(f);
				if (!img) {
					img = loadPng(file);
					cache.set(f, img);
					for (const k of [...cache.keys()]) if (Math.abs(k - f) > 2) cache.delete(k);
				}
				return img;
			};
			const paletteCache = new Map<number, boolean>();
			const spent: Record<string, number> = {};
			const timed = <T,>(name: string, fn: () => T): T => {
				const t1 = Date.now();
				try {
					return fn();
				} finally {
					spent[name] = (spent[name] ?? 0) + Date.now() - t1;
				}
			};
			for (const fr of plan.frames) {
				const facts = pFacts.get(fr);
				const img = scene(fr);
				if (!facts || !img) continue;
				const fading = facts.chars.some((c) => c.effects.opacity > 0.02 && c.effects.opacity < THRESHOLDS.model.minOpacity);
				if (transitions.has(fr) || fading || overlapsScenes(facts)) {
					// a cross-fade or wipe blends two scenes: only the flicker test below applies
					stats.skipped.push({frame: fr, who: 'frame', why: transitions.has(fr) ? 'inside a scene transition' : 'characters fading (cross-fade)'});
				} else {
					const tf = Tfiles.get(fr);
					if (tf) {
						const res = timed('contrast', () => contrastFindings(facts, img, loadPng(tf), (t) => settledAt(geo, textKey(t), fr) !== false));
						findings.push(...res.findings);
						contrastMeasured += res.measured;
						contrastSkipped += res.skipped;
						contrastLowest = Math.min(contrastLowest, res.lowest);
					}
					const sf = Sfiles.get(fr);
					if (sf && facts.chars.length) {
						const S = loadPng(sf);
						const refs: CharRef[] = facts.chars.map((_, i) => {
							const file = refFile.get(`${fr}:${i}`);
							return file ? {img: loadPng(file), facts: null} : null;
						});
						findings.push(...timed('model', () => modelPixelFindings(facts, img, S, refs, manifest, stats, paletteCache)));
					}
					const pre = timed('ramps', () => prepareFrame(img));
					findings.push(...timed('gradient', () => gradientFindings(facts, img, pre)), ...timed('texture', () => textureFindings(facts, img, pre)));
				}
				if (P.has(fr - 1) && P.has(fr + 1)) {
					const a = scene(fr - 1);
					const b = scene(fr + 1);
					const c = scene(fr);
					if (a && b && c) findings.push(...timed('flicker', () => flickerFindings(fr, a, c, b, facts)));
				}
			}
			timings.analysis = Date.now() - ta;
			log(`  analysis: ${Object.entries(spent).map(([k, v]) => `${k} ${(v / 1000).toFixed(1)} s`).join(', ')}`);
		}

		// ---- group, thumbnails, report ----
		const issues = groupFindings(findings);
		const thumbSrc: ThumbSources = {
			scene: (f) => (P.has(f) ? loadPng(P.get(f) as string) : null),
			solo: (f) => (Sfiles.has(f) ? loadPng(Sfiles.get(f) as string) : null),
			ref: (f, i) => (refFile.has(`${f}:${i}`) ? loadPng(refFile.get(`${f}:${i}`) as string) : null),
		};
		let n = 0;
		for (const issue of issues) {
			if (issue.severity === 'info') continue;
			// thumbnail from the worst finding that has full-size pixels
			const withPixels = findings.filter((f) => f.check === issue.check && `${f.check}|${f.key}` === `${issue.worst.check}|${issue.worst.key}` && P.has(f.frame));
			if (withPixels.length) issue.worst = withPixels.reduce((a, b) => (b.score > a.score ? b : a));
			const file = join(outDir, 'issues', `${String(++n).padStart(2, '0')}-${issue.check}-f${issue.worst.frame}.png`);
			if (renderThumb(issue, thumbSrc, file)) issue.thumb = `issues/${file.split('/').pop()}`;
		}
		const badges = new Set<string>();
		let texts = 0;
		let chars = 0;
		for (const f of domFacts.values()) {
			for (const t of f.texts) if (t.role === 'badge') badges.add(t.text.slice(0, 80));
			texts += f.texts.filter((t) => t.role !== 'badge').length;
			chars += f.chars.length;
		}
		timings.total = Date.now() - t0;
		const reasons: Record<number, string[]> = {};
		for (const [f, rs] of plan.reasons) reasons[f] = [...rs];
		const rep = writeReport(
			outDir,
			{
				tool: TOOL,
				date: new Date().toISOString(),
				entry: relToRoot(resolve(args.entry)),
				comp: args.comp,
				props: args.props,
				width: W,
				height: H,
				fps: comp.fps,
				durationInFrames: D,
				format: zones.format,
				scouted,
				scoutStep: step,
				sampled: plan.frames,
				sampleReasons: reasons,
				everyN: plan.everyN,
				scenes: plan.scenes,
				timings,
				zones: {safe: zones.safe, ui: zones.ui.map((u) => ({name: u.name, rect: u.rect})), adsSafe: zones.adsSafe, sources: zones.sources},
				thresholds: THRESHOLDS,
				counts: {texts, characters: chars, contrastMeasured, contrastSkipped, modelCompared: stats.compared},
				calibration: {
					lowestContrast: Number.isFinite(contrastLowest) ? contrastLowest : null,
					worstCanonicalSsim: stats.compared ? Number(stats.worstSsim.toFixed(5)) : null,
					maxCanonicalChangedPercent: stats.compared ? Number((stats.maxChangedFrac * 100).toFixed(3)) : null,
				},
				skipped: stats.skipped,
				errors,
				ignoredBadges: [...badges],
				scoutMotion: scoutStats,
			},
			issues,
		);
		if (!args.keepFrames) rmSync(workDir, {recursive: true, force: true});
		const nErr = issues.filter((i) => i.severity === 'error').length;
		const nWarn = issues.filter((i) => i.severity === 'warn').length;
		log(`\n${rep.verdict}: ${nErr} error(s), ${nWarn} warning(s) in ${(timings.total / 1000).toFixed(1)} s`);
		for (const i of issues.filter((x) => x.severity !== 'info').slice(0, 12)) log(`  ${i.severity.toUpperCase().padEnd(5)} ${i.title}: ${i.subject} [frames ${i.ranges.slice(0, 40)}]`);
		log(`  report: ${relToRoot(rep.md)}`);
		if (errors.length) log(`  tool notes: ${errors.length} (see report.json "errors")`);
		return {code: nErr > 0 || (args.failOn === 'warn' && nWarn > 0) ? 1 : 0, verdict: rep.verdict, issues, report: rep.md, json: rep.json, toolErrors: errors};
	} finally {
		if (!shared.browser) await browser.close({silent: true} as never).catch(() => undefined);
	}
};

/** Each character appears once per scene; two Zoos (or two Badgers) mean two scenes overlap mid-transition. */
const overlapsScenes = (f: FrameFacts): boolean => f.chars.filter((c) => c.kind === 'zoo').length > 1 || f.chars.filter((c) => c.kind === 'badger').length > 1;

/** The first frame of each DOM finding group (they need real pixels for the thumbnail). */
const firstFrames = (fs: Finding[]): number[] => {
	const first = new Map<string, number>();
	for (const f of fs) {
		if (f.severity === 'info') continue;
		const k = `${f.check}|${f.key}`;
		const v = first.get(k);
		if (v === undefined || f.frame < v) first.set(k, f.frame);
	}
	return [...new Set(first.values())];
};

const isMain = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
	let code = 2;
	try {
		code = (await run(parseArgs(process.argv.slice(2)))).code;
	} catch (err) {
		if (err instanceof UsageError) {
			if (err.message) console.error(err.message);
			console.error(USAGE);
		} else console.error(`visual QA failed: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
		code = 2;
	}
	process.exit(code);
}
