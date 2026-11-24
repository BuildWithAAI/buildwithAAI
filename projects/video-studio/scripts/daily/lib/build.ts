/**
 * build <date-slug>: in order, the general claim gate (if present), the news gate, the voice (Kokoro im_nicola), the
 * ShowShort render, the thumbnails, the publish kit, and then the approval packet:
 *   out/approval/<date-slug>/approval.html  approval.md  packet.json  short.mp4  thumbs/
 * A missing tool is reported as missing, never faked. When a gate fails, nothing is voiced or rendered; the packet is
 * still written (NOT READY, with every fix) so the session and the owner see what to change.
 */
import {copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync} from 'node:fs';
import {join} from 'node:path';
import {loadChannel, type ChannelConfig} from './channel.ts';
import type {Exec} from './exec.ts';
import {minutes, outputTail} from './exec.ts';
import {correctionCandidates, correctionLines, type CorrectionCandidate} from './corrections.ts';
import {renderHtml} from './html.ts';
import {beatsOf, episodeForKit, isDeveloping, KIT_NOT_APPLICABLE, readStoryboard, summaryOf, type SbLite} from './kit-adapter.ts';
import {acquireLock} from './lock.ts';
import {renderMd} from './md.ts';
import {displayOf, loadSplitter, type Splitter} from './narration.ts';
import {buildModel, readGate, type GateJson, type Thumb} from './packet.ts';
import {CHANNEL, episodePaths, type Paths} from './paths.ts';
import type {PostInput, RadarMention} from './postapproval.ts';
import {readRadarFile} from './radar.ts';
import type {DailyBrief, Opportunity, PacketSummary, StepResult} from './types.ts';
import {fileSize, isRecord, localTime, parseDateSlug, readJson, rel, scrubEnv, sha256, sha256File, writeAtomic, writeJson} from './util.ts';
import {isRealAnalysis} from './writer.ts';

export type BuildOptions = {
	root: string;
	dateSlug: string;
	exec: Exec;
	now?: () => Date;
	env?: NodeJS.ProcessEnv;
	log?: (line: string) => void;
	skip?: Set<string>;
	onlyGates?: boolean;
	python?: string;
};

export type BuildResult = {exitCode: 0 | 1; packet: PacketSummary | null; error?: string; paths?: {html: string; md: string; packet: string}};

const GENERAL_NAMES_TS = ['gate', 'check', 'cli', 'index', 'run', 'main', 'claims'];

/** The private names list the general claim gate reads (gitignored: a fresh cloud checkout never has it). */
export const namesListPath = (root: string): string => join(root, 'data', 'private', 'names.txt');

/**
 * The general claim gate's command, found the same way the news gate finds it (scripts/news/lib/general-gate.ts).
 * scripts/claims/check.ts takes the episode folder (its --help, read 2026-11-24):
 *   node scripts/claims/check.ts <episode dir> [--lang <lang>] [--out-dir <dir>] [--names <file> | --no-names]
 * The episode folder and the report folder are absolute, under `root`, so a run with --root writes its report there
 * and not into this checkout. Without the private names list (data/private/names.txt, gitignored, so never in a fresh
 * cloud checkout) it runs with --no-names, explicitly, and the packet says so: the news gate's name rule (R4) still
 * refuses every unknown personal name. NEWS_GENERAL_GATE_CMD still overrides everything.
 */
export const findGeneralGate = async (root: string, call: {channel: string; slug: string; storyboard: string; brief: string; root: string}, env: NodeJS.ProcessEnv): Promise<{argv: string[] | null; problem?: string; namesNote?: string}> => {
	const check = join(root, 'scripts', 'claims', 'check.ts');
	if (!env.NEWS_GENERAL_GATE_CMD && existsSync(check)) {
		const names = namesListPath(root);
		const hasNames = existsSync(names);
		return {
			argv: [process.execPath, check, join(root, 'content', call.channel, call.slug), '--lang', 'en', '--out-dir', join(root, 'out', 'claims'), ...(hasNames ? ['--names', names] : ['--no-names'])],
			...(hasNames ? {} : {namesNote: `The general claim gate ran with --no-names: the private names list (${rel(root, names)}, gitignored) is not on this machine. The news gate's name rule (R4) still refuses every unknown personal name.`}),
		};
	}
	try {
		const mod = (await import('../../news/lib/general-gate.ts')) as {discoverGeneralGate: (r: string, c: typeof call, e: NodeJS.ProcessEnv) => {argv: string[] | null; problem?: string}};
		const found = mod.discoverGeneralGate(root, call, env);
		return {argv: found.argv, problem: found.problem};
	} catch {
		for (const n of GENERAL_NAMES_TS) {
			const f = join(root, 'scripts', 'claims', `${n}.ts`);
			if (existsSync(f)) return {argv: [process.execPath, f, `${call.channel}/${call.slug}`]};
		}
		return {argv: null};
	}
};

const step = (s: StepResult): StepResult => s;

/** ShowShort's props (src/show/Root.tsx): the channel name is hidden (null) while it is still TBD. */
export const renderProps = (dateSlug: string, sb: SbLite, channel: ChannelConfig) => ({
	channel: CHANNEL,
	slug: dateSlug,
	lang: 'en',
	...(sb.shorts[0]?.id ? {shortId: sb.shorts[0].id} : {}),
	channelName: channel.displayNameTbd ? null : channel.displayName,
});

/** Every string in the storyboard (to find leftover TODOs). */
const strings = (v: unknown, out: string[] = []): string[] => {
	if (typeof v === 'string') out.push(v);
	else if (Array.isArray(v)) for (const x of v) strings(x, out);
	else if (isRecord(v)) for (const x of Object.values(v)) strings(x, out);
	return out;
};

export const preChecks = (sb: SbLite, brief: DailyBrief | null, dateSlug: string, channel: ChannelConfig, developing: boolean, split: Splitter): {blockers: string[]; warnings: string[]} => {
	const blockers: string[] = [];
	const warnings: string[] = [];
	const raw = sb.raw;
	if (raw.channel !== CHANNEL) blockers.push(`storyboard.channel must be "${CHANNEL}".`);
	if (sb.slug !== dateSlug) blockers.push(`storyboard.slug is "${sb.slug}", not "${dateSlug}".`);
	if (raw.lang !== 'en') blockers.push('storyboard.lang must be "en" (the daily Short is voiced in English first).');
	if (raw.fiction !== false) blockers.push('storyboard.fiction must be false: news is never fiction.');
	if (!sb.title) blockers.push('storyboard.title is missing.');
	const todo = strings(raw).filter((s) => /\bTODO\b/.test(s));
	if (todo.length) blockers.push(`Replace every TODO from the skeleton (${todo.length} left).`);
	if (!brief) blockers.push('brief.json is missing: run prepare first.');
	if (developing) {
		if (!/developing/i.test(sb.title)) blockers.push('Developing story: the title must say "developing".');
		for (const sh of sb.shorts) if (!/developing/i.test(sh.title)) blockers.push(`Developing story: the Short title of "${sh.id}" must say "developing".`);
		// any variant may be the one viewers see
		for (const th of sb.thumbnails) if (!/developing/i.test(th.text)) blockers.push(`Developing story: thumbnail "${th.id}" must say DEVELOPING.`);
	}
	if (brief) {
		// only a hand pick with no real analysis at all is the owner's call (a warning); a real analysis the brief
		// offers and the storyboard leaves out always blocks
		const a = realAnalysisCheck(sb, brief);
		if (!a.ok) (a.handPicked && !a.realAvailable ? warnings : blockers).push(a.message);
	}
	const ids = sb.scenes.map((s) => s.id);
	const short = sb.shorts[0];
	if (!short) blockers.push('storyboard.shorts is empty: the daily Short is shorts[0] with every scene.');
	else {
		const left = ids.filter((id) => !short.sceneIds.includes(id));
		if (left.length) warnings.push(`The Short leaves out ${left.join(', ')} (the daily Short is normally the whole storyboard).`);
	}
	if (sb.thumbnails.length !== 3) warnings.push(`${sb.thumbnails.length} thumbnail variant(s); 3 are expected.`);
	const beats = sb.scenes.reduce((a, s) => a + beatsOf(s).length, 0);
	if (!sb.scenes.some((s) => s.badger?.present || beatsOf(s).length)) blockers.push('Badger appears in no scene (he must appear in every episode).');
	else if (beats < 2 || beats > 3) warnings.push(`${beats} Badger beat(s); 2 or 3 per Short work best.`);
	const words = sb.scenes.reduce((a, s) => a + displayOf(s.narration, split).split(/\s+/).filter(Boolean).length, 0);
	const est = words / 2.5 + sb.scenes.length * 0.35;
	if (est > channel.lengthSec[1] + 15) warnings.push(`${words} words of narration: likely about ${Math.round(est)} s, over the ${channel.lengthSec[1]} s target (the voice step measures the real length).`);
	if (est < channel.lengthSec[0] - 15) warnings.push(`${words} words of narration: likely about ${Math.round(est)} s, under the ${channel.lengthSec[0]} s target.`);
	if (brief && Array.isArray(sb.news.incidentIds) && !sb.news.incidentIds.includes(brief.incident.id)) warnings.push(`news.incidentIds does not list the brief's incident ${brief.incident.id}.`);
	if (brief?.evergreen && !brief.evergreen.url) warnings.push(`The evergreen explainer "${brief.evergreen.title}" is not published yet, so the CTA links nothing.`);
	if (channel.displayNameTbd) warnings.push(`The channel's display name is still TBD (placeholder "${channel.displayName}").`);
	return {blockers, warnings};
};

/** The figures of a text (commas dropped), for matching an analysis to the brief's opportunity. */
const figures = (t: string): string[] => (t.match(/\d[\d,]*(?:\.\d+)?/g) ?? []).map((x) => x.replace(/,/g, ''));

/**
 * Owner rule: real analysis in every video. When the brief offers a real analysis (strong and not a daily template),
 * the storyboard must present one: an analysis entry with its `opportunity` id, or of its kind and basis whose figures
 * all come from it. A story the owner picked by hand without one is shown as a warning at the top of the packet.
 */
export const realAnalysisCheck = (sb: SbLite, brief: DailyBrief): {ok: boolean; handPicked: boolean; realAvailable: boolean; message: string; matched: string[]} => {
	const real = brief.analysisOpportunities.filter(isRealAnalysis);
	const handPicked = !!brief.selection?.picked;
	const presents = (o: Opportunity) =>
		sb.analysis.some((a) => {
			if (!Array.isArray(a.sceneIds) || !a.sceneIds.length) return false;
			if (a.opportunity === o.id) return true;
			const mine = figures(String(a.detail ?? ''));
			const theirs = new Set([...figures(o.detail ?? ''), ...Object.values(o.numbers ?? {}).map(String)]);
			return a.kind === o.kind && a.basis === o.basis && mine.length > 0 && mine.every((n) => theirs.has(n));
		});
	const matched = real.filter(presents).map((o) => o.id);
	const realAvailable = real.length > 0;
	if (matched.length) return {ok: true, handPicked, realAvailable, message: '', matched};
	if (!realAvailable)
		return {ok: false, handPicked, realAvailable, matched, message: `No real analysis: this story has no strong analysis that is not a daily template (owner rule: real analysis in every video).${handPicked ? ' It was picked by hand, so this is the owner\'s call.' : ''}`};
	return {ok: false, handPicked, realAvailable, matched, message: `The storyboard presents none of the real analyses the brief found (${real.map((o) => o.id).join(', ')}): a daily template alone is not real analysis. Copy one into storyboard.analysis with its "opportunity" id and present it.`};
};

/** Other radar stories for the Threat Brief: name, status and up to two tier-A/B links. No claims. */
export const radarMentions = (root: string, brief: DailyBrief | null): RadarMention[] => {
	if (!brief) return [];
	const r = readJson(join(root, brief.radar.path));
	if (!r.ok || !isRecord(r.data)) return [];
	const all = [...(Array.isArray(r.data.top) ? r.data.top : []), ...(Array.isArray(r.data.alsoSeen) ? r.data.alsoSeen : [])].filter(isRecord);
	const out: RadarMention[] = [];
	for (const x of all) {
		if (x.id === brief.incident.id || typeof x.protocol !== 'string' || x.protocol === 'Unknown subject') continue;
		const sources = (Array.isArray(x.sources) ? x.sources : []).filter(isRecord).filter((s) => (s.tier === 'A' || s.tier === 'B') && typeof s.url === 'string');
		const coverage: RadarMention['coverage'] = [];
		for (const s of sources) {
			const publisher = typeof s.publisher === 'string' ? s.publisher : String(s.id);
			if (coverage.length < 2 && !coverage.some((c) => c.publisher === publisher)) coverage.push({publisher, url: String(s.url)});
		}
		if (coverage.length) out.push({name: x.protocol, status: x.status === 'confirmed' ? 'confirmed' : 'developing', coverage});
	}
	return out.slice(0, 4);
};

/** The post-approval input: approved text only (title, claims, analysis, One Fix), sources and links. */
export const postInput = (o: {sb: SbLite; brief: DailyBrief | null; gate: GateJson | null; split: Splitter; channel: ChannelConfig; developing: boolean; youtubeId: string | null; date: string; mentions: RadarMention[]}): PostInput => {
	const {sb, brief, gate} = o;
	const srcById = new Map((brief?.sources ?? []).map((s) => [s.id, s]));
	const sbSrc = new Map(sb.sources.map((s) => [s.id, s]));
	const whatWeKnow: PostInput['whatWeKnow'] = [];
	for (const sc of sb.scenes) {
		let ss;
		try {
			ss = o.split(sc.narration);
		} catch {
			continue;
		}
		ss.forEach((s, k) => {
			if (!s.srcIds.length) return;
			const traced = !gate || gate.claims.filter((c) => c.scene === sc.id && c.sentence === k).every((c) => c.ok);
			if (!traced || whatWeKnow.length >= 5) return;
			whatWeKnow.push({
				text: s.display,
				sources: s.srcIds.map((id) => ({publisher: srcById.get(id)?.publisher ?? sbSrc.get(id)?.title ?? id, url: srcById.get(id)?.url ?? sbSrc.get(id)?.url ?? ''})),
			});
		});
	}
	const fix = sb.scenes.find((s) => /one fix/i.test(String(s.onScreen?.title ?? '')));
	const cited = new Set(sb.scenes.flatMap((sc) => {
		try {
			return o.split(sc.narration).flatMap((s) => s.srcIds);
		} catch {
			return [];
		}
	}));
	const sources = [...cited].map((id) => ({publisher: srcById.get(id)?.publisher ?? id, title: srcById.get(id)?.title ?? sbSrc.get(id)?.title ?? id, url: srcById.get(id)?.url ?? sbSrc.get(id)?.url ?? ''}));
	return {
		slug: sb.slug,
		date: o.date,
		title: sb.title,
		shortTitle: sb.shorts[0]?.title ?? sb.title,
		developing: o.developing,
		summary: summaryOf(sb, o.split),
		whatWeKnow,
		analysis: (sb.analysis ?? []).map((a) => String(a.detail ?? '')).filter(Boolean),
		oneFix: fix ? displayOf(fix.narration, o.split) : null,
		sources,
		corrections: (gate?.corrections.pinnedComments ?? []).map((c) => c.text),
		youtubeId: o.youtubeId,
		alsoOnRadar: o.mentions,
		showName: o.channel.showName,
		displayName: o.channel.displayName,
	};
};

const ffprobeDuration = (exec: Exec, root: string, file: string, env: NodeJS.ProcessEnv): number | null => {
	const r = exec({cmd: 'ffprobe', args: ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file], cwd: root, env, timeoutMs: 30_000});
	const n = Number.parseFloat((r.stdout ?? '').trim());
	return r.status === 0 && Number.isFinite(n) ? n : null;
};

/** A small JPEG of the render's first second, shown on the packet's video before it plays (best effort). */
const posterFrame = (exec: Exec, root: string, mp4: string, out: string, env: NodeJS.ProcessEnv): void => {
	rmSync(out, {force: true});
	exec({cmd: 'ffmpeg', args: ['-v', 'error', '-y', '-ss', '1', '-i', mp4, '-frames:v', '1', '-vf', 'scale=540:-2', '-q:v', '5', out], cwd: root, env, timeoutMs: 60_000});
};

const posterDataUri = (path: string): string | null => {
	const size = fileSize(path) ?? 0;
	return size > 0 && size <= 250_000 ? `data:image/jpeg;base64,${readFileSync(path).toString('base64')}` : null;
};

const thumbView = (file: string, rel: string, label: string): Thumb => {
	const size = fileSize(file) ?? 0;
	const dataUri = size > 0 && size <= 600_000 ? `data:image/png;base64,${readFileSync(file).toString('base64')}` : null;
	return {label, rel, dataUri, sha256: sha256File(file)};
};

export const runBuild = async (o: BuildOptions): Promise<BuildResult> => {
	const log = o.log ?? (() => {});
	const rawEnv = o.env ?? process.env;
	const skip = o.skip ?? new Set<string>();
	const ds = parseDateSlug(o.dateSlug);
	if (!ds) return {exitCode: 1, packet: null, error: `"${o.dateSlug}" is not a <date>-<slug>`};
	const ep: Paths = episodePaths(o.root, o.dateSlug);
	let channel: ChannelConfig;
	try {
		channel = loadChannel(ep.channelJson);
	} catch (err) {
		return {exitCode: 1, packet: null, error: err instanceof Error ? err.message : String(err)};
	}
	const sbRead = readJson(ep.storyboard);
	if (!sbRead.ok) return {exitCode: 1, packet: null, error: sbRead.missing ? `No storyboard yet: write ${rel(o.root, ep.storyboard)} following ${rel(o.root, ep.writer)}.` : sbRead.error};
	const {sb, problems} = readStoryboard(sbRead.data);
	if (!sb) return {exitCode: 1, packet: null, error: problems.join('; ')};
	const lock = acquireLock(ep.lock, o.now);
	if (!lock.ok) return {exitCode: 1, packet: null, error: lock.reason};
	// no build step posts anything, so none of them gets the posting credentials (util.ts scrubEnv)
	const env = scrubEnv(rawEnv, [...channel.announcerCredentialEnv, ...channel.threatBriefCredentialEnv]);
	try {
		return await buildLocked(o, {ep, channel, sb, sbSha: sbRead.sha256, problems, env, skip, log});
	} finally {
		lock.release();
	}
};

const buildLocked = async (
	o: BuildOptions,
	c: {ep: Paths; channel: ChannelConfig; sb: SbLite; sbSha: string; problems: string[]; env: NodeJS.ProcessEnv; skip: Set<string>; log: (l: string) => void},
): Promise<BuildResult> => {
	const {ep, channel, sb, env, skip, log} = c;
	const root = o.root;
	const now = () => (o.now ? o.now() : new Date());
	const started = now();
	const date = parseDateSlug(o.dateSlug)!.date;
	const briefRead = readJson<DailyBrief>(ep.brief);
	const brief = briefRead.ok && isRecord(briefRead.data) && (briefRead.data as DailyBrief).schema === 'zoora-security/daily-brief@1' ? briefRead.data : null;
	const {split, source: splitter} = await loadSplitter();
	const developing = isDeveloping(sb, brief?.status ?? null);
	const pre = preChecks(sb, brief, o.dateSlug, channel, developing, split);
	pre.blockers.unshift(...c.problems.map((p) => `Storyboard: ${p}`));
	const steps: StepResult[] = [];
	const python = o.python ?? 'python3';
	const say = (s: StepResult) => {
		steps.push(s);
		log(`${s.title}: ${s.status}${s.blocking ? ' (blocks approval)' : ''}. ${s.note}`);
		return s;
	};
	mkdirSync(ep.work, {recursive: true});
	mkdirSync(ep.approvalDir, {recursive: true});

	// 1. the general claim gate
	const gg = await findGeneralGate(root, {channel: CHANNEL, slug: o.dateSlug, storyboard: ep.storyboard, brief: ep.brief, root}, env);
	if (gg.namesNote) pre.warnings.unshift(gg.namesNote);
	if (gg.problem) say(step({id: 'general-gate', title: 'General claim gate', status: 'failed', blocking: true, note: gg.problem}));
	else if (!gg.argv) say(step({id: 'general-gate', title: 'General claim gate', status: 'missing', blocking: false, note: 'scripts/claims has no entry point yet; the news gate enforces the news rules on its own.'}));
	else {
		const r = o.exec({cmd: gg.argv[0], args: gg.argv.slice(1), cwd: root, env: {...env, NEWS_GATE_PARENT: '1'}, timeoutMs: minutes(3)});
		const ok = r.status === 0 && !r.error;
		say(step({id: 'general-gate', title: 'General claim gate', status: ok ? 'passed' : 'failed', blocking: !ok, note: ok ? 'Passed.' : r.status === 2 ? 'It refused the input (exit 2): see its output; if its interface changed, set NEWS_GENERAL_GATE_CMD (scripts/news/README.md).' : `Failed (exit ${r.status ?? 'none'}${r.timedOut ? ', timed out' : ''}). Its findings are below and in out/claims/${o.dateSlug}.en.md.`, command: gg.argv, exitCode: r.status, durationMs: r.durationMs, outputTail: ok ? undefined : outputTail(r, 2500)}));
	}

	// 2. the news gate
	let gate: GateJson | null = null;
	const gateScript = join(root, 'scripts', 'news', 'gate.ts');
	if (!existsSync(gateScript)) say(step({id: 'news-gate', title: 'News gate', status: 'missing', blocking: true, note: 'scripts/news/gate.ts is missing; nothing can be approved without it.'}));
	else {
		rmSync(ep.gateJson, {force: true});
		const args = [gateScript, o.dateSlug, '--general-gate', 'off', '--studio-root', root, '--content-root', ep.contentRoot, '--out', join(root, 'out', 'claims'), '--quiet'];
		const r = o.exec({cmd: process.execPath, args, cwd: root, env, timeoutMs: minutes(3)});
		const g = readJson(ep.gateJson);
		gate = g.ok ? readGate(g.data) : null;
		const fresh = gate && gate.inputs.storyboard?.sha256 === c.sbSha;
		if (r.status === 0 && gate?.verdict === 'pass' && fresh) say(step({id: 'news-gate', title: 'News gate', status: 'passed', blocking: false, note: `PASS: ${gate.counts.claimsOk}/${gate.counts.claims} claims traced, ${gate.counts.warnings} warning(s).`, command: [process.execPath, ...args], exitCode: 0, durationMs: r.durationMs}));
		else if (gate && fresh && gate.verdict === 'fail')
			say(step({id: 'news-gate', title: 'News gate', status: 'failed', blocking: true, note: `FAIL: ${gate.counts.errors} error(s). Fix each one (listed below) or switch to an alternate.`, command: [process.execPath, ...args], exitCode: r.status, durationMs: r.durationMs}));
		else say(step({id: 'news-gate', title: 'News gate', status: 'failed', blocking: true, note: `It did not produce a report for this storyboard (exit ${r.status ?? 'none'}).`, command: [process.execPath, ...args], exitCode: r.status, durationMs: r.durationMs, outputTail: outputTail(r, 1500)}));
	}
	const gatesOk = steps.every((s) => !s.blocking) && pre.blockers.length === 0;

	// provenance of the render: which storyboard it was made from
	const renderMeta = join(ep.work, 'render.json');
	const prior = readJson<{storyboardSha256?: string; renderSha256?: string; durationSec?: number | null}>(renderMeta);
	const reusable = prior.ok && prior.data.storyboardSha256 === c.sbSha && existsSync(ep.render) && sha256File(ep.render) === prior.data.renderSha256;

	// 3. voice, 4. render
	let durationSec: number | null = null;
	if (o.onlyGates) {
		say(step({id: 'voice', title: 'Voice (im_nicola)', status: 'skipped', blocking: !reusable, note: reusable ? 'Not re-run (--only gates); the render below was made from this exact storyboard.' : 'Not run (--only gates). Run a full build before approval.'}));
		if (reusable) {
			durationSec = prior.ok ? prior.data.durationSec ?? null : null;
			if (!existsSync(join(ep.work, 'poster.jpg'))) posterFrame(o.exec, root, ep.render, join(ep.work, 'poster.jpg'), env);
			say(step({id: 'render', title: 'Render (ShowShort)', status: 'passed', blocking: false, note: 'Reused: rendered from this exact storyboard.', artifacts: {mp4: rel(root, ep.render)}}));
		} else say(step({id: 'render', title: 'Render (ShowShort)', status: 'skipped', blocking: true, note: 'Not run (--only gates); no render matches this storyboard.'}));
	} else if (!gatesOk) {
		say(step({id: 'voice', title: 'Voice (im_nicola)', status: 'skipped', blocking: true, note: 'Not run: fix the gate failures first (nothing unverified is voiced).'}));
		say(step({id: 'render', title: 'Render (ShowShort)', status: 'skipped', blocking: true, note: 'Not run: fix the gate failures first.'}));
	} else {
		let voiceOk = false;
		const voiceScript = join(root, 'scripts', 'voice', 'build.py');
		if (skip.has('voice')) say(step({id: 'voice', title: 'Voice (im_nicola)', status: 'skipped', blocking: true, note: 'Skipped (--skip voice).'}));
		else if (!existsSync(voiceScript)) say(step({id: 'voice', title: 'Voice (im_nicola)', status: 'missing', blocking: true, note: 'scripts/voice/build.py is missing: no narration can be made.'}));
		else {
			const args = [voiceScript, join('content', CHANNEL, o.dateSlug), '--lang', 'en', '--voice', channel.voice, '-q'];
			const r = o.exec({cmd: python, args, cwd: root, env, timeoutMs: minutes(20)});
			const tl = readJson<{totalMs?: number; voice?: string; mock?: boolean}>(ep.timeline);
			const total = tl.ok && typeof tl.data.totalMs === 'number' ? tl.data.totalMs / 1000 : null;
			if (r.status === 0 && tl.ok && tl.data.voice === channel.voice && !tl.data.mock && total) {
				voiceOk = true;
				const [lo, hi] = channel.lengthSec;
				const longNote = total > 180 ? ` Over YouTube's 3-minute Shorts limit.` : total < lo || total > hi ? ` Outside the ${lo}–${hi} s target.` : '';
				say(step({id: 'voice', title: 'Voice (im_nicola)', status: total > 180 ? 'failed' : longNote ? 'warning' : 'passed', blocking: total > 180, note: `${total.toFixed(1)} s of narration, voice ${channel.voice}.${longNote}`, command: [python, ...args], exitCode: 0, durationMs: r.durationMs, artifacts: {timeline: rel(root, ep.timeline)}}));
			} else
				say(step({id: 'voice', title: 'Voice (im_nicola)', status: 'failed', blocking: true, note: r.status === 0 ? `The timeline is missing, mock or not voiced with ${channel.voice}.` : `Failed (exit ${r.status ?? 'none'}). Run scripts/voice/setup.sh once on a fresh machine.`, command: [python, ...args], exitCode: r.status, durationMs: r.durationMs, outputTail: outputTail(r, 1500)}));
		}
		const entry = join(root, 'src', 'show', 'index.ts');
		rmSync(ep.render, {force: true});
		rmSync(renderMeta, {force: true});
		if (skip.has('render')) say(step({id: 'render', title: 'Render (ShowShort)', status: 'skipped', blocking: true, note: 'Skipped (--skip render).'}));
		else if (!existsSync(entry)) say(step({id: 'render', title: 'Render (ShowShort)', status: 'missing', blocking: true, note: "The show's ShowShort composition (src/show/index.ts) is not built yet, so there is no preview to approve."}));
		else if (!voiceOk) say(step({id: 'render', title: 'Render (ShowShort)', status: 'skipped', blocking: true, note: 'Not run: the voice step did not pass.'}));
		else {
			writeJson(ep.renderProps, renderProps(o.dateSlug, sb, channel));
			const partial = join(ep.approvalDir, 'short.rendering.mp4');
			rmSync(partial, {force: true});
			const args = ['remotion', 'render', 'src/show/index.ts', 'ShowShort', partial, `--props=${ep.renderProps}`];
			const r = o.exec({cmd: 'npx', args, cwd: root, env, timeoutMs: minutes(45)});
			if (r.status === 0 && (fileSize(partial) ?? 0) > 0) {
				renameSync(partial, ep.render);
				durationSec = ffprobeDuration(o.exec, root, ep.render, env);
				posterFrame(o.exec, root, ep.render, join(ep.work, 'poster.jpg'), env);
				const renderSha = sha256File(ep.render);
				writeJson(renderMeta, {storyboardSha256: c.sbSha, renderSha256: renderSha, durationSec, builtAt: now().toISOString()});
				const tooLong = durationSec !== null && durationSec > 180;
				say(step({id: 'render', title: 'Render (ShowShort)', status: tooLong ? 'failed' : 'passed', blocking: tooLong, note: `${durationSec !== null ? `${durationSec.toFixed(1)} s` : 'duration unknown (ffprobe failed)'}, ${(((fileSize(ep.render) ?? 0) / 1e6)).toFixed(1)} MB.${tooLong ? ' Over the 3-minute Shorts limit.' : ''}`, command: ['npx', ...args], exitCode: 0, durationMs: r.durationMs, artifacts: {mp4: rel(root, ep.render)}}));
			} else {
				rmSync(partial, {force: true});
				say(step({id: 'render', title: 'Render (ShowShort)', status: 'failed', blocking: true, note: `Failed (exit ${r.status ?? 'none'}${r.timedOut ? ', timed out' : ''}).`, command: ['npx', ...args], exitCode: r.status, durationMs: r.durationMs, outputTail: outputTail(r, 1500)}));
			}
		}
	}

	// 5. thumbnails (3 variants via the thumbnail tooling, else a still of the show)
	const thumbs: Thumb[] = [];
	if (o.onlyGates || !gatesOk) {
		for (const f of existsSync(ep.thumbsDir) ? readdirSync(ep.thumbsDir).filter((n) => n.endsWith('.png')).sort() : []) if (reusableThumb(ep, f, c.sbSha)) thumbs.push(thumbView(join(ep.thumbsDir, f), `thumbs/${f}`, f.replace('.png', '')));
		say(step({id: 'thumbnails', title: 'Thumbnails', status: 'skipped', blocking: false, note: o.onlyGates ? `Not re-run (--only gates)${thumbs.length ? `; ${thumbs.length} from this storyboard shown` : ''}.` : 'Not run: fix the gate failures first.'}));
	} else {
		rmSync(ep.thumbsDir, {recursive: true, force: true});
		mkdirSync(ep.thumbsDir, {recursive: true});
		const tool = join(root, 'scripts', 'thumbnails.ts');
		const entry = join(root, 'src', 'show', 'index.ts');
		if (skip.has('thumbnails')) say(step({id: 'thumbnails', title: 'Thumbnails', status: 'skipped', blocking: false, note: 'Skipped (--skip thumbnails).'}));
		else if (existsSync(tool)) {
			const args = ['--disable-warning=MODULE_TYPELESS_PACKAGE_JSON', tool, `${CHANNEL}/${o.dateSlug}`, '--lang', 'en', '--out', ep.thumbnailsOut];
			const r = o.exec({cmd: process.execPath, args, cwd: root, env, timeoutMs: minutes(15)});
			const dir = join(ep.thumbnailsOut, 'en');
			for (const v of ['v0', 'v1', 'v2']) {
				const f = join(dir, `${v}.png`);
				if (existsSync(f)) {
					copyFileSync(f, join(ep.thumbsDir, `${v}.png`));
					thumbs.push(thumbView(join(ep.thumbsDir, `${v}.png`), `thumbs/${v}.png`, v));
				}
			}
			writeJson(join(ep.thumbsDir, 'thumbs.json'), {storyboardSha256: c.sbSha, files: thumbs.map((t) => ({rel: t.rel, sha256: t.sha256}))});
			const ok = r.status === 0 && thumbs.length === 3;
			say(step({id: 'thumbnails', title: 'Thumbnails', status: ok ? 'passed' : 'warning', blocking: false, note: ok ? '3 variants rendered and checked (size, contrast, legibility).' : `${thumbs.length} of 3 rendered; the thumbnail tool exited ${r.status ?? 'none'} (its checks are in ${rel(root, join(dir, 'report.json'))}).`, command: [process.execPath, ...args], exitCode: r.status, durationMs: r.durationMs, outputTail: ok ? undefined : outputTail(r, 1200)}));
		} else if (existsSync(entry)) {
			const out = join(ep.thumbsDir, 'still.png');
			const args = ['remotion', 'still', 'src/show/index.ts', 'ShowShort', out, '--frame=45', `--props=${ep.renderProps}`];
			writeJson(ep.renderProps, renderProps(o.dateSlug, sb, channel));
			const r = o.exec({cmd: 'npx', args, cwd: root, env, timeoutMs: minutes(10)});
			if (existsSync(out)) thumbs.push(thumbView(out, 'thumbs/still.png', 'still (frame 45)'));
			writeJson(join(ep.thumbsDir, 'thumbs.json'), {storyboardSha256: c.sbSha, files: thumbs.map((t) => ({rel: t.rel, sha256: t.sha256}))});
			say(step({id: 'thumbnails', title: 'Thumbnails', status: r.status === 0 && thumbs.length ? 'warning' : 'failed', blocking: false, note: r.status === 0 && thumbs.length ? 'The thumbnail tool is missing; a still of the show stands in.' : 'The thumbnail tool is missing and the still failed.', command: ['npx', ...args], exitCode: r.status, durationMs: r.durationMs}));
		} else say(step({id: 'thumbnails', title: 'Thumbnails', status: 'missing', blocking: false, note: 'Neither scripts/thumbnails.ts nor src/show/index.ts exists.'}));
	}

	// 6. publish kit
	let kit: {pinned: string | null; description: string | null; failing: Array<{id: string; detail: string}>; notApplicable: Array<{id: string; why: string}>} | null = null;
	let kitJsonPath: string | null = null;
	const kitCli = join(root, 'scripts', 'publish-kit', 'cli.ts');
	if (skip.has('publish-kit')) say(step({id: 'publish-kit', title: 'Publish kit', status: 'skipped', blocking: false, note: 'Skipped (--skip publish-kit).'}));
	else if (!existsSync(kitCli)) say(step({id: 'publish-kit', title: 'Publish kit', status: 'missing', blocking: false, note: 'scripts/publish-kit/cli.ts is missing; the checklist below stands in.'}));
	else {
		const episode = episodeForKit({sb, channel, split, developing, incidentType: brief?.incident.type ?? null, evergreenUrl: brief?.evergreen?.url ?? null});
		writeJson(ep.episodeJson, episode);
		const args = [kitCli, `${CHANNEL}/${o.dateSlug}`, '--out', ep.publishOut];
		const r = o.exec({cmd: process.execPath, args, cwd: root, env, timeoutMs: minutes(2)});
		const kj = readJson(join(ep.publishOut, 'kit.json'));
		if ((r.status === 0 || r.status === 1) && kj.ok && isRecord(kj.data)) {
			kitJsonPath = join(ep.publishOut, 'kit.json');
			const checks = (Array.isArray(kj.data.checks) ? kj.data.checks : []).filter(isRecord) as Array<{id: string; ok: boolean; detail: string}>;
			const failing = checks.filter((x) => !x.ok && !KIT_NOT_APPLICABLE[x.id]).map((x) => ({id: x.id, detail: x.detail}));
			const notApplicable = checks.filter((x) => !x.ok && KIT_NOT_APPLICABLE[x.id]).map((x) => ({id: x.id, why: KIT_NOT_APPLICABLE[x.id]}));
			const read = (n: string) => (existsSync(join(ep.publishOut, n)) ? readFileSync(join(ep.publishOut, n), 'utf8') : null);
			kit = {pinned: read('pinned-comment.txt'), description: read('youtube-description.txt'), failing, notApplicable};
			say(step({id: 'publish-kit', title: 'Publish kit', status: failing.length ? 'warning' : 'passed', blocking: false, note: failing.length ? `${failing.length} check(s) to look at: ${failing.map((x) => x.id).join(', ')}.` : `All applicable checks pass${notApplicable.length ? ` (${notApplicable.map((x) => x.id).join(', ')}: not applicable to a Short)` : ''}.`, command: [process.execPath, ...args], exitCode: r.status, durationMs: r.durationMs, artifacts: {kit: rel(root, kitJsonPath)}}));
		} else say(step({id: 'publish-kit', title: 'Publish kit', status: 'failed', blocking: false, note: `It refused the episode file (exit ${r.status ?? 'none'}); the checklist below stands in.`, command: [process.execPath, ...args], exitCode: r.status, durationMs: r.durationMs, outputTail: outputTail(r, 1200)}));
	}

	// 7. corrections to pin on episodes already approved (from the brief's radar file), then the packet
	const corrections = pendingCorrections(root, brief, o.dateSlug, date);
	const cl = correctionLines(corrections);
	pre.blockers.push(...cl.blockers);
	pre.warnings.push(...cl.warnings);
	const renderOk = existsSync(ep.render) && steps.some((s) => s.id === 'render' && s.status === 'passed');
	const renderSha = renderOk ? sha256File(ep.render) : null;
	const gateSha = existsSync(ep.gateJson) ? sha256(readFileSync(ep.gateJson)) : null;
	const versions: PacketSummary['versions'] = {
		storyboard: {path: rel(root, ep.storyboard), sha256: c.sbSha},
		brief: {path: rel(root, ep.brief), sha256: briefRead.ok ? briefRead.sha256 : null},
		render: {path: rel(root, ep.render), sha256: renderSha, bytes: renderOk ? fileSize(ep.render) : null, durationSec: renderOk ? durationSec : null},
		thumbnails: thumbs.map((t) => ({path: rel(root, join(ep.approvalDir, t.rel ?? '')), sha256: t.sha256})),
		newsGate: {path: rel(root, ep.gateJson), sha256: gateSha, verdict: gate?.verdict ?? null},
		publishKit: {path: kitJsonPath ? rel(root, kitJsonPath) : rel(root, join(ep.publishOut, 'kit.json')), sha256: kitJsonPath ? sha256File(kitJsonPath) : null},
	};
	const builtAt = now().toISOString();
	const model = buildModel({
		slug: o.dateSlug,
		date,
		builtAt,
		builtAtLocal: localTime(builtAt, channel.timezone),
		sb,
		brief,
		gate,
		steps,
		channel,
		split,
		splitter: splitter === 'news-gate' ? "the news gate's (sentence numbers match its report)" : 'local fallback (the news gate module did not load)',
		preChecks: pre,
		developing,
		preview: renderOk ? {rel: 'short.mp4', bytes: fileSize(ep.render), durationSec, sha256: renderSha, note: '', posterDataUri: posterDataUri(join(ep.work, 'poster.jpg'))} : {rel: null, bytes: null, durationSec: null, sha256: null, note: steps.find((s) => s.id === 'render')?.note ?? 'Not rendered.'},
		thumbnails: thumbs,
		kit,
		post: postInput({sb, brief, gate, split, channel, developing, youtubeId: null, date, mentions: radarMentions(root, brief)}),
		versions,
		corrections,
	});
	const html = renderHtml(model);
	const mdText = renderMd(model);
	writeAtomic(ep.approvalHtml, html);
	writeAtomic(ep.approvalMd, mdText);
	const packet: PacketSummary = {
		version: 1,
		schema: 'zoora-security/approval-packet@1',
		slug: o.dateSlug,
		builtAt,
		readyToApprove: model.ready,
		blockers: model.blockers,
		warnings: model.warnings,
		developing,
		title: sb.title,
		versions,
		steps,
		pinnedComment: model.checklist.pinnedComment,
		files: {html: rel(root, ep.approvalHtml), md: rel(root, ep.approvalMd)},
	};
	writeJson(ep.packetJson, packet);
	writeJson(ep.buildLog, {startedAt: started.toISOString(), finishedAt: now().toISOString(), ready: model.ready, steps});
	log(`Approval packet: ${rel(root, ep.approvalHtml)} (${model.ready ? 'READY TO APPROVE' : `NOT READY: ${model.blockers.length} blocker(s)`}).`);
	return {exitCode: model.ready ? 0 : 1, packet, paths: {html: ep.approvalHtml, md: ep.approvalMd, packet: ep.packetJson}};
};

/** Correction candidates against the brief's radar file (none without a brief or a readable radar file). */
const pendingCorrections = (root: string, brief: DailyBrief | null, slug: string, date: string): CorrectionCandidate[] => {
	if (!brief?.radar?.path) return [];
	const r = readRadarFile(join(root, brief.radar.path), brief.radar.runDate, brief.radar.mode === 'live' ? 'live' : 'offline');
	if (!r.ok) return [];
	const cp = episodePaths(root, slug);
	return correctionCandidates({contentRoot: cp.contentRoot, correctionsPath: cp.corrections, radar: r.file, date, exceptSlug: slug});
};

/** A thumbnail from an earlier full build counts only if it was made from this exact storyboard. */
const reusableThumb = (ep: Paths, file: string, sbSha: string): boolean => {
	const meta = readJson<{storyboardSha256?: string; files?: Array<{rel: string; sha256: string}>}>(join(ep.thumbsDir, 'thumbs.json'));
	if (!meta.ok || meta.data.storyboardSha256 !== sbSha) return false;
	const entry = (meta.data.files ?? []).find((f) => f.rel === `thumbs/${file}`);
	try {
		return !!entry && statSync(join(ep.thumbsDir, file)).isFile() && sha256File(join(ep.thumbsDir, file)) === entry.sha256;
	} catch {
		return false;
	}
};
