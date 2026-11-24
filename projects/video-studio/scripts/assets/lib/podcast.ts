/**
 * (b) PODCAST: narration.wav (+ Badger's recorded sounds, when a cue file exists) → a -16 LUFS / -1 dBTP master →
 * MP3 (ID3v2.3 tags + CHAP/CTOC chapters from scene boundaries) and M4A (iTunes tags + chapter track), Podcasting 2.0
 * JSON chapters, WebVTT/SRT transcripts, show notes (Markdown + HTML) with sources and disclosures, and item.json for
 * the feed builder (build-podcast-feed.ts). Daily Shorts are skipped: podcast episodes are the weekly round-ups and
 * long episodes (owner note, 2026-11-24).
 *
 * Badger cue file (optional; contract owned here, docs/ASSETS.md): public/generated/<channel>/<slug>/<lang>/badger-cues.json
 *   {"version": 1, "cues": [{"clip": "clips/huff-01.wav", "atMs": 15300, "gainDb": -3, "label": "huff"}]}
 * clip paths are relative to the cue file. A cue may never overlap Zoo's words (CLAUDE.md: punchlines AFTER his lines).
 */
import {existsSync, mkdirSync, readFileSync, rmSync} from 'node:fs';
import {dirname, isAbsolute, join, relative, resolve} from 'node:path';
import {buildMaster, checkCover, encodeM4a, encodeMp3, measure, probe, squareJpeg, TARGET_I, TARGET_TP, type BadgerCue, type Loudness} from './audio.ts';
import type {ChannelConfig} from './config.ts';
import type {Episode} from './episode.ts';
import {esc, isSafeUrl} from './html.ts';
import {ISO639_2, RSS_LANG, type Strings} from './i18n.ts';
import {buildId3v23, parseId3, type Id3Chapter} from './id3.ts';
import {checkDisclosedLinks, lintText, type LintContext, type LintIssue} from './lint.ts';
import type {Chapter} from './transcript.ts';
import {cues as captionCues, toSrt, toVtt} from './transcript.ts';
import type {AssetFile, AssetRecord, Check, Source} from './types.ts';
import {clock, fileSize, InputError, isRecord, readJson, sha256File, writeFile, writeJson} from './util.ts';

export type PodcastOffer = {id: string; name: string; disclosure: string; url: string};

export type PodcastContext = {
	ep: Episode;
	cfg: ChannelConfig;
	outDir: string;
	title: string;
	summary: string;
	chapters: Chapter[];
	takeaways: string[];
	sources: Source[];
	articleUrl: string;
	youtubeUrl: string | null;
	publishedAt: string | null;
	offers: PodcastOffer[];
	disclosures: string[];
	fictionNote: string | null;
	developing: string | null;
	subscribeUrl: string;
	s: Strings;
	lint: LintContext;
	minSec: number;
	badgerCuesPath: string | null; // explicit --badger-cues, or the default location when it exists
	coverPath: string | null; // explicit --cover or the channel's configured file
	reviewed: boolean;
	now: string;
	ffmpeg: boolean; // ffmpeg and ffprobe are on PATH
};

export type ItemJson = {
	version: 1;
	channel: string;
	slug: string;
	lang: string;
	guid: string;
	title: string;
	summary: string;
	descriptionHtml: string;
	link: string;
	pubDate: string | null;
	durationSec: number;
	explicit: boolean;
	episodeType: 'full';
	season?: number;
	episode?: number;
	reviewed: boolean;
	files: {mp3: {path: string; bytes: number; type: 'audio/mpeg'}; m4a: {path: string; bytes: number; type: 'audio/x-m4a'}; chapters: string; vtt: string; srt: string; cover: string | null};
	chapters: {startMs: number; endMs: number; title: string; href: string}[];
	status: AssetRecord['status'];
};

const FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const SLUG = /^[a-z0-9][a-z0-9-]{0,95}$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/;
const STATUSES = ['ok', 'draft', 'blocked', 'skipped', 'pending', 'error'];

/**
 * Checks an item.json read back from disk (the feed builder never trusts it): every field's type, the episodeType
 * enum, positive whole season and episode numbers, https links, and plain file names, so a changed item can neither
 * add XML to the feed nor make the builder copy files from outside its folder.
 */
export const checkItemJson = (raw: unknown, expect: {channel: string; slug: string}): {ok: true; item: ItemJson} | {ok: false; problems: string[]} => {
	const p: string[] = [];
	if (!isRecord(raw)) return {ok: false, problems: ['not a JSON object']};
	const str = (k: string, max = 10_000) => {
		if (typeof raw[k] !== 'string' || [...(raw[k] as string)].length > max) p.push(`"${k}" must be a string of at most ${max} characters`);
	};
	if (raw.version !== 1) p.push('"version" must be 1');
	if (raw.channel !== expect.channel) p.push(`"channel" must be "${expect.channel}"`);
	if (raw.slug !== expect.slug || !SLUG.test(String(raw.slug))) p.push(`"slug" must be "${expect.slug}"`);
	for (const k of ['lang', 'guid']) str(k, 200);
	str('title', 500);
	str('summary', 4000);
	str('descriptionHtml', 20_000);
	if (typeof raw.link !== 'string' || !isSafeUrl(raw.link, {httpsOnly: true})) p.push('"link" must be an https URL');
	if (raw.pubDate !== null && !(typeof raw.pubDate === 'string' && ISO.test(raw.pubDate) && Number.isFinite(Date.parse(raw.pubDate)))) p.push('"pubDate" must be an ISO timestamp or null');
	if (typeof raw.durationSec !== 'number' || !Number.isFinite(raw.durationSec) || raw.durationSec < 0) p.push('"durationSec" must be a non-negative number');
	if (typeof raw.explicit !== 'boolean') p.push('"explicit" must be true or false');
	if (!['full', 'trailer', 'bonus'].includes(raw.episodeType as string)) p.push('"episodeType" must be full, trailer or bonus');
	for (const k of ['season', 'episode']) if (raw[k] !== undefined && !(typeof raw[k] === 'number' && Number.isSafeInteger(raw[k]) && (raw[k] as number) > 0)) p.push(`"${k}" must be a positive whole number`);
	if (typeof raw.reviewed !== 'boolean') p.push('"reviewed" must be true or false');
	if (!STATUSES.includes(raw.status as string)) p.push('"status" is not an asset status');
	const f = raw.files;
	if (!isRecord(f)) p.push('"files" must be an object');
	else {
		for (const [k, type] of [['mp3', 'audio/mpeg'], ['m4a', 'audio/x-m4a']] as const) {
			const x = f[k];
			if (!isRecord(x) || typeof x.path !== 'string' || !FILE_NAME.test(x.path) || typeof x.bytes !== 'number' || !Number.isSafeInteger(x.bytes) || x.bytes < 0 || x.type !== type) p.push(`"files.${k}" must be {path: a plain file name, bytes, type: "${type}"}`);
		}
		for (const k of ['chapters', 'vtt', 'srt']) if (typeof f[k] !== 'string' || !FILE_NAME.test(f[k] as string)) p.push(`"files.${k}" must be a plain file name`);
		if (f.cover !== null && (typeof f.cover !== 'string' || !FILE_NAME.test(f.cover))) p.push('"files.cover" must be a plain file name or null');
	}
	if (!Array.isArray(raw.chapters)) p.push('"chapters" must be a list');
	else
		raw.chapters.forEach((c, i) => {
			if (!isRecord(c) || typeof c.startMs !== 'number' || !Number.isFinite(c.startMs) || c.startMs < 0 || typeof c.endMs !== 'number' || !(c.endMs >= c.startMs) || typeof c.title !== 'string' || typeof c.href !== 'string' || !isSafeUrl(c.href, {httpsOnly: true}))
				p.push(`"chapters[${i}]" must be {startMs, endMs >= startMs, title, href: an https URL}`);
		});
	return p.length ? {ok: false, problems: p} : {ok: true, item: raw as unknown as ItemJson};
};

const MIN_CUE_GAP_MS = 100;

type CueCheck = {cues: BadgerCue[]; issues: LintIssue[]};

export const loadBadgerCues = (file: string, words: {startMs: number; endMs: number}[], totalMs: number, durationOf: (clip: string) => number): CueCheck => {
	const raw = readJson(file, 'Badger cue file');
	if (!isRecord(raw) || raw.version !== 1 || !Array.isArray(raw.cues)) throw new InputError(`${file}: expected {"version": 1, "cues": [...]}`);
	const issues: LintIssue[] = [];
	const cues: BadgerCue[] = [];
	raw.cues.forEach((c, i) => {
		const where = `${file} cues[${i}]`;
		if (!isRecord(c) || typeof c.clip !== 'string' || typeof c.atMs !== 'number' || c.atMs < 0) {
			issues.push({level: 'error', rule: 'badger-cue', where, message: 'needs "clip" (path) and "atMs" (>= 0)'});
			return;
		}
		const clip = isAbsolute(c.clip) ? c.clip : resolve(dirname(file), c.clip);
		if (!existsSync(clip)) {
			issues.push({level: 'error', rule: 'badger-cue', where, message: `clip not found: ${clip}`});
			return;
		}
		const dur = durationOf(clip) * 1000;
		if (!(dur > 0)) {
			issues.push({level: 'error', rule: 'badger-cue', where, message: 'clip has no audio'});
			return;
		}
		if (dur > 5000) issues.push({level: 'warning', rule: 'badger-cue', where, message: `clip is ${(dur / 1000).toFixed(1)} s; Badger's sounds should be short punchlines`});
		const start = c.atMs;
		const end = c.atMs + dur;
		if (end > totalMs) issues.push({level: 'error', rule: 'badger-cue', where, message: `ends at ${Math.round(end)} ms, after the episode (${totalMs} ms)`});
		const hit = words.find((w) => start < w.endMs + MIN_CUE_GAP_MS && end > w.startMs - MIN_CUE_GAP_MS);
		if (hit) issues.push({level: 'error', rule: 'badger-cue', where, message: `plays over Zoo's speech (${clock(hit.startMs)}): Badger's sounds go after Zoo's lines, never over them`});
		const gainDb = typeof c.gainDb === 'number' && Number.isFinite(c.gainDb) ? Math.max(-30, Math.min(6, c.gainDb)) : 0;
		cues.push({clip, atMs: start, gainDb, label: typeof c.label === 'string' ? c.label : undefined});
	});
	const perMinute = cues.length / Math.max(1, totalMs / 60_000);
	if (perMinute > 3) issues.push({level: 'warning', rule: 'badger-cue', where: file, message: `${cues.length} cues in ${(totalMs / 60_000).toFixed(1)} min: use Badger's sounds sparingly`});
	return {cues, issues};
};

const fileRecord = (path: string, base: string): AssetFile => ({path: relative(base, path), bytes: fileSize(path) ?? 0, sha256: sha256File(path) ?? ''});

export const showNotes = (c: PodcastContext): {md: string; html: string; texts: [string, string][]} => {
	const s = c.s;
	const md: string[] = [`# ${c.title}`, ''];
	const html: string[] = [];
	const texts: [string, string][] = [['title', c.title], ['summary', c.summary]];
	if (c.developing) {
		md.push(`**${c.developing}**`, '');
		html.push(`<p><strong>${esc(c.developing)}</strong></p>`);
	}
	md.push(c.summary, '');
	html.push(`<p>${esc(c.summary)}</p>`);
	if (c.fictionNote) {
		md.push(`_${c.fictionNote}_`, '');
		html.push(`<p><em>${esc(c.fictionNote)}</em></p>`);
	}
	const links: string[] = [];
	if (c.youtubeUrl) links.push(`${s.fullEpisode} ${c.youtubeUrl}`);
	links.push(`${s.articleLink} ${c.articleUrl}`);
	md.push(...links.map((l) => `${l}  `), '');
	html.push(`<p>${links.map((l) => esc(l).replace(/(https:\/\/\S+)/g, '<a href="$1">$1</a>')).join('<br>')}</p>`);
	// Spotify reads "MM:SS Title" lines (first at 00:00, at least 3, in order); YouTube uses the same format.
	if (c.chapters.length >= 3) {
		md.push(`## ${s.chapters}`, '', ...c.chapters.map((ch) => `${clock(ch.startMs)} ${ch.title}  `), '');
		html.push(`<p><strong>${esc(s.chapters)}</strong><br>${c.chapters.map((ch) => esc(`${clock(ch.startMs)} ${ch.title}`)).join('<br>')}</p>`);
		c.chapters.forEach((ch, i) => texts.push([`chapter ${i + 1}`, ch.title]));
	}
	if (c.takeaways.length) {
		md.push(`## ${s.takeaways}`, '', ...c.takeaways.map((t) => `- ${t}`), '');
		html.push(`<p><strong>${esc(s.takeaways)}</strong></p><ul>${c.takeaways.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>`);
		c.takeaways.forEach((t, i) => texts.push([`takeaway ${i + 1}`, t]));
	}
	if (c.offers.length) {
		md.push(`## ${s.links}`, '');
		html.push(`<p><strong>${esc(s.links)}</strong></p>`);
		for (const o of c.offers) {
			md.push(o.disclosure, `${o.name}: ${o.url}`, '');
			html.push(`<p>${esc(o.disclosure)}<br><a href="${esc(o.url)}">${esc(o.name)}</a></p>`);
			texts.push([`offer ${o.id}`, `${o.name} ${o.disclosure}`]);
		}
	}
	if (c.sources.length) {
		md.push(`## ${s.sources}`, '', ...c.sources.map((src) => `- ${src.title}: ${src.url} (${s.accessed} ${src.accessed})`), '');
		html.push(`<p><strong>${esc(s.sources)}</strong></p><ul>${c.sources.map((src) => `<li><a href="${esc(src.url)}">${esc(src.title)}</a> (${esc(s.accessed)} ${esc(src.accessed)})</li>`).join('')}</ul>`);
		c.sources.forEach((src, i) => texts.push([`source ${i + 1}`, src.title]));
	}
	if (c.disclosures.length) {
		md.push(`## ${s.disclosures}`, '', ...c.disclosures.map((d) => `- ${d}`), '');
		html.push(`<p><strong>${esc(s.disclosures)}</strong></p><ul>${c.disclosures.map((d) => `<li>${esc(d)}</li>`).join('')}</ul>`);
		c.disclosures.forEach((d, i) => texts.push([`disclosure ${i + 1}`, d]));
	}
	md.push(`${s.subscribeLine} ${c.subscribeUrl}`, '');
	html.push(`<p>${esc(s.subscribeLine)} <a href="${esc(c.subscribeUrl)}">${esc(c.subscribeUrl)}</a></p>`);
	return {md: md.join('\n'), html: html.join('\n'), texts};
};

const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;

const loudnessCheck = (id: string, l: Loudness, tolI: number): Check => {
	const ok = near(l.integratedLufs, TARGET_I, tolI) && l.truePeakDbtp <= TARGET_TP;
	return {id, ok, level: ok ? 'info' : 'error', detail: `${l.integratedLufs.toFixed(1)} LUFS integrated (target ${TARGET_I} ±${tolI}), true peak ${l.truePeakDbtp.toFixed(1)} dBTP (ceiling ${TARGET_TP})`};
};

export const makePodcast = (c: PodcastContext): {record: AssetRecord; item: ItemJson | null; issues: LintIssue[]} => {
	const ep = c.ep;
	const base = c.outDir;
	const skipped = (why: string): {record: AssetRecord; item: null; issues: LintIssue[]} => ({
		record: {id: 'podcast', kind: 'podcast', status: 'skipped', summary: why, files: [], checks: [{id: 'podcast', ok: true, level: 'info', detail: why}]},
		item: null,
		issues: [],
	});
	if (!c.cfg.podcast.enabled) return skipped(c.cfg.podcast.reason ?? `the podcast is not enabled for ${ep.channel} in config/channels.json`);
	if (ep.sidecar.podcast?.skip) return skipped('the episode sidecar (assets.json) says podcast.skip');
	if (ep.storyboard.news?.format === 'daily-short') return skipped('daily Shorts are too short for podcast episodes: the podcast takes the weekly round-ups and long episodes');
	if (!ep.timeline || ep.timeline.mock || !ep.narrationPath) return skipped('no narration audio yet (run scripts/voice/build.py for this language first)');
	if (ep.timeline.totalMs < c.minSec * 1000) {
		return skipped(`the episode is ${Math.round(ep.timeline.totalMs / 1000)} s; podcast episodes need at least ${c.minSec} s (weekly round-ups and long episodes, not Shorts)`);
	}

	if (!c.ffmpeg) {
		return {
			record: {id: 'podcast', kind: 'podcast', status: 'error', summary: 'ffmpeg/ffprobe not found on PATH', files: [], checks: [{id: 'ffmpeg', ok: false, level: 'error', detail: 'install ffmpeg 6.x (libmp3lame, aac, loudnorm, ebur128, soxr) and re-run'}]},
			item: null,
			issues: [],
		};
	}

	rmSync(base, {recursive: true, force: true});
	mkdirSync(base, {recursive: true});
	const checks: Check[] = [];
	const issues: LintIssue[] = [];
	const tl = ep.timeline;

	// Badger's recorded sounds
	let cues: BadgerCue[] = [];
	if (c.badgerCuesPath) {
		const words = tl.scenes.flatMap((sc) => sc.words.map((w) => ({startMs: sc.startMs + w.startMs, endMs: sc.startMs + w.endMs})));
		const cueCheck = loadBadgerCues(c.badgerCuesPath, words, tl.totalMs, (clip) => probe(clip).durationSec);
		issues.push(...cueCheck.issues);
		if (cueCheck.issues.some((i) => i.level === 'error')) {
			return {
				record: {id: 'podcast', kind: 'podcast', status: 'blocked', summary: 'Badger cue problems', files: [], checks: cueCheck.issues.map((i) => ({id: 'badger-cues', ok: false, level: i.level, detail: i.message}))},
				item: null,
				issues,
			};
		}
		cues = cueCheck.cues;
		checks.push({id: 'badger-cues', ok: true, level: 'info', detail: `${cues.length} Badger sound(s) mixed in from ${c.badgerCuesPath}`});
	} else checks.push({id: 'badger-cues', ok: true, level: 'info', detail: 'no Badger cue file: narration only'});

	// master
	const masterPath = join(base, 'master.wav');
	const master = buildMaster(ep.narrationPath, cues, masterPath);
	checks.push(loudnessCheck('loudness-master', master.after, 0.5));
	checks.push({id: 'loudness-before', ok: true, level: 'info', detail: `narration in: ${master.before.integratedLufs.toFixed(1)} LUFS, ${master.before.truePeakDbtp.toFixed(1)} dBTP; loudnorm mode: ${master.normalization}`});

	// cover (show art), optional per episode
	let coverJpg: string | null = null;
	let embed: string | null = null;
	if (c.coverPath) {
		const cc = checkCover(c.coverPath);
		if (cc.ok) {
			coverJpg = join(base, 'cover.jpg');
			squareJpeg(c.coverPath, coverJpg, cc.width);
			embed = join(base, 'cover-600.jpg');
			squareJpeg(c.coverPath, embed, 600);
			checks.push({id: 'cover', ok: true, level: 'info', detail: `${cc.width}x${cc.height} ${cc.codec} from ${c.coverPath}`});
		} else checks.push({id: 'cover', ok: false, level: 'warning', detail: `cover not used: ${cc.problems.join('; ')}`});
	} else checks.push({id: 'cover', ok: true, level: 'info', detail: 'no show cover configured yet (see docs/ASSETS.md, "Cover art"); episodes inherit the feed art'});

	// MP3 + ID3
	const show = c.cfg.podcast.shows[ep.lang];
	const durationMs = Math.round(probe(masterPath).durationSec * 1000);
	const chapters = c.chapters.map((ch, i) => ({...ch, endMs: i === c.chapters.length - 1 ? durationMs : ch.endMs}));
	const id3Chapters: Id3Chapter[] = chapters.map((ch, i) => ({id: `chp${i}`, startMs: ch.startMs, endMs: Math.min(ch.endMs, durationMs), title: ch.title, url: `${c.articleUrl}#ch-${ch.sceneIds[0]}`}));
	const rawMp3 = join(base, 'episode.raw.mp3');
	encodeMp3(masterPath, rawMp3);
	const year = (c.publishedAt ?? c.now).slice(0, 4);
	const tag = buildId3v23({
		title: c.title,
		artist: show?.author ?? c.cfg.brand,
		album: show?.title ?? c.cfg.displayName,
		genre: 'Podcast',
		year,
		trackNumber: ep.sidecar.podcast?.episode,
		language: ISO639_2[ep.lang],
		comment: {lang: ISO639_2[ep.lang], text: c.summary},
		copyright: show?.copyright || undefined,
		publisher: c.cfg.brand,
		lengthMs: durationMs,
		url: {description: 'Episode page', url: c.articleUrl},
		picture: embed ? {mime: 'image/jpeg', data: readFileSync(embed), description: 'Cover'} : undefined,
		chapters: id3Chapters.length >= 2 ? id3Chapters : undefined,
		tocTitle: c.s.chapters,
	});
	const mp3Path = join(base, 'episode.mp3');
	writeFile(mp3Path, Buffer.concat([tag, readFileSync(rawMp3)]));
	rmSync(rawMp3, {force: true});

	// M4A
	const m4aPath = join(base, 'episode.m4a');
	encodeM4a(
		masterPath,
		m4aPath,
		{title: c.title, artist: show?.author ?? c.cfg.brand, album: show?.title ?? c.cfg.displayName, genre: 'Podcast', date: year, comment: c.summary, copyright: show?.copyright ?? ''},
		id3Chapters.length >= 2 ? id3Chapters : [],
		embed,
	);

	// verify the encoded files
	for (const [id, file] of [['mp3', mp3Path], ['m4a', m4aPath]] as const) {
		const p = probe(file);
		const a = p.streams.find((x) => x.codec_type === 'audio');
		const okFmt = a?.sample_rate === '44100' && a?.channels === 2;
		checks.push({id: `format-${id}`, ok: okFmt, level: okFmt ? 'info' : 'error', detail: `${a?.codec_name ?? '?'} ${a?.sample_rate ?? '?'} Hz, ${a?.channels ?? '?'} ch`});
		const durOk = near(p.durationSec * 1000, durationMs, 150);
		checks.push({id: `duration-${id}`, ok: durOk, level: durOk ? 'info' : 'error', detail: `${p.durationSec.toFixed(3)} s vs master ${(durationMs / 1000).toFixed(3)} s`});
		const want = id3Chapters.length >= 2 ? id3Chapters.map((x) => x.title) : [];
		const got = p.chapters.map((x) => x.tags?.title ?? '');
		const chOk = JSON.stringify(want) === JSON.stringify(got);
		checks.push({id: `chapters-${id}`, ok: chOk, level: chOk ? 'info' : 'error', detail: `ffprobe reads ${got.length} chapter(s)${chOk ? '' : `; expected ${want.length}: ${want.join(' | ')}`}`});
		checks.push(loudnessCheck(`loudness-${id}`, measure(file), 1.0));
	}
	const parsed = parseId3(readFileSync(mp3Path));
	const tagOk = !!parsed && parsed.version === 3 && parsed.chapters.length === (id3Chapters.length >= 2 ? id3Chapters.length : 0) && (parsed.toc ? parsed.toc.flags === 3 : id3Chapters.length < 2);
	checks.push({id: 'id3', ok: tagOk, level: tagOk ? 'info' : 'error', detail: `ID3v2.${parsed?.version ?? '?'}, ${parsed?.chapters.length ?? 0} CHAP frame(s), CTOC ${parsed?.toc ? `flags ${parsed.toc.flags}` : 'absent'}`});
	if (c.chapters.length < 3) checks.push({id: 'chapter-count', ok: false, level: 'warning', detail: `${c.chapters.length} chapter(s): Spotify and YouTube show description chapters only from 3`});

	// chapters JSON (Podcasting 2.0), transcripts, show notes
	const chaptersJson = {
		version: '1.2.0',
		title: c.title,
		podcastName: show?.title ?? c.cfg.displayName,
		fileName: 'episode.mp3',
		chapters: chapters.map((ch) => ({startTime: Math.round(ch.startMs) / 1000, endTime: Math.round(Math.min(ch.endMs, durationMs)) / 1000, title: ch.title, url: `${c.articleUrl}#ch-${ch.sceneIds[0]}`})),
	};
	writeJson(join(base, 'chapters.json'), chaptersJson);
	const list = captionCues(tl, ep.lang);
	writeFile(join(base, 'transcript.vtt'), toVtt(list));
	writeFile(join(base, 'transcript.srt'), toSrt(list));
	const notes = showNotes(c);
	writeFile(join(base, 'show-notes.md'), notes.md);
	writeFile(join(base, 'show-notes.html'), `${notes.html}\n`);
	for (const [where, text] of notes.texts) issues.push(...lintText(text, `podcast show notes: ${where}`, c.lint));
	const linkChecks = c.offers.map((o) => ({url: o.url, disclosure: o.disclosure, label: `offer "${o.id}"`}));
	issues.push(...checkDisclosedLinks(notes.md, linkChecks, 'podcast show notes (md)'));
	issues.push(...checkDisclosedLinks(notes.html, c.offers.map((o) => ({url: esc(o.url), disclosure: esc(o.disclosure), label: `offer "${o.id}"`})), 'podcast show notes (html)'));
	const descLen = [...notes.html].length;
	checks.push({id: 'description-length', ok: descLen <= 4000, level: descLen <= 4000 ? 'info' : 'warning', detail: `${descLen} characters of HTML (Apple shows up to 4000)`});

	if (!c.reviewed) checks.push({id: 'translation', ok: false, level: 'warning', detail: 'machine translation not reviewed by a native speaker: kept out of the feed until storyboard.translation.status is "native-reviewed"'});
	if (!c.publishedAt) checks.push({id: 'publish-date', ok: false, level: 'warning', detail: 'no publish date (pass --published or set publishedAt in assets.json): the feed needs a pubDate'});

	const hasError = checks.some((x) => !x.ok && x.level === 'error') || issues.some((i) => i.level === 'error');
	const status: AssetRecord['status'] = hasError ? 'blocked' : !c.reviewed || !c.publishedAt ? 'draft' : 'ok';

	const item: ItemJson = {
		version: 1,
		channel: ep.channel,
		slug: ep.slug,
		lang: RSS_LANG[ep.lang],
		guid: `${ep.channel}/${ep.slug}/${ep.lang}`,
		title: c.title,
		summary: c.summary,
		descriptionHtml: notes.html,
		link: c.articleUrl,
		pubDate: c.publishedAt,
		durationSec: Math.round(durationMs / 1000),
		explicit: show?.explicit ?? false,
		episodeType: 'full',
		...(ep.sidecar.podcast?.season !== undefined ? {season: ep.sidecar.podcast.season} : {}),
		...(ep.sidecar.podcast?.episode !== undefined ? {episode: ep.sidecar.podcast.episode} : {}),
		reviewed: c.reviewed,
		files: {
			mp3: {path: 'episode.mp3', bytes: fileSize(mp3Path) ?? 0, type: 'audio/mpeg'},
			m4a: {path: 'episode.m4a', bytes: fileSize(m4aPath) ?? 0, type: 'audio/x-m4a'},
			chapters: 'chapters.json',
			vtt: 'transcript.vtt',
			srt: 'transcript.srt',
			cover: coverJpg ? 'cover.jpg' : null,
		},
		chapters: chaptersJson.chapters.map((ch, i) => ({startMs: chapters[i].startMs, endMs: Math.min(chapters[i].endMs, durationMs), title: ch.title, href: ch.url})),
		status,
	};
	writeJson(join(base, 'item.json'), item);

	const files = ['episode.mp3', 'episode.m4a', 'master.wav', 'chapters.json', 'transcript.vtt', 'transcript.srt', 'show-notes.md', 'show-notes.html', 'item.json', ...(coverJpg ? ['cover.jpg'] : [])].map((f) =>
		fileRecord(join(base, f), dirname(base)),
	);
	return {
		record: {
			id: 'podcast',
			kind: 'podcast',
			status,
			summary: `${Math.round(durationMs / 1000)} s, ${id3Chapters.length >= 2 ? id3Chapters.length : 0} chapters, ${master.after.integratedLufs.toFixed(1)} LUFS master`,
			files,
			checks,
			chars: {showNotesHtml: descLen, showNotesMd: [...notes.md].length},
			extra: {loudness: {before: master.before, master: master.after}, cues: cues.length},
		},
		item,
		issues,
	};
};
