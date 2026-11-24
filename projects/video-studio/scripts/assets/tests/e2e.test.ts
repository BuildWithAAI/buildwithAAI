/**
 * End-to-end: make.ts on a temp copy of the fixture episode (narration synthesized with ffmpeg), then the site and
 * podcast-feed builders, plus the cases that must block or skip. The newsletter step runs creator-hub's real CLI.
 */
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {existsSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {test} from 'node:test';
import {main as buildFeed} from '../build-podcast-feed.ts';
import {main as buildSite} from '../build-site.ts';
import {main as cover} from '../cover.ts';
import {parseId3} from '../lib/id3.ts';
import {sha256File} from '../lib/util.ts';
import type {Manifest} from '../lib/types.ts';
import {main as make} from '../make.ts';
import {CHANNEL, HAS_FFMPEG, HAS_PYTHON, quiet, SLUG, synthClip, workspace, wsArgs, xmlError, type Workspace} from './helpers.ts';

const manifestOf = (ws: Workspace, lang: string): Manifest => JSON.parse(readFileSync(join(ws.out, CHANNEL, SLUG, lang, 'manifest.json'), 'utf8')) as Manifest;
const asset = (m: Manifest, id: string) => {
	const a = m.assets.find((x) => x.id === id);
	assert.ok(a, `asset ${id} in manifest`);
	return a;
};
const editJson = (file: string, edit: (j: Record<string, unknown>) => void) => {
	const j = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
	edit(j);
	writeFileSync(file, JSON.stringify(j, null, 1));
};
const sbPath = (ws: Workspace, lang = 'en') => join(ws.content, CHANNEL, SLUG, lang === 'en' ? 'storyboard.json' : `storyboard.${lang}.json`);
type Scene = {id: string; narration: string; onScreen?: Record<string, unknown>};

test('full run: en and es, every asset, manifest, site and podcast feed', {skip: !HAS_FFMPEG && 'ffmpeg not installed', timeout: 240_000}, () => {
	const ws = workspace();
	const out = quiet();
	const code = make(wsArgs(ws, ['--published', '2026-11-24']), out.print, out.print);
	assert.equal(code, 0, out.lines.join('\n'));

	const en = manifestOf(ws, 'en');
	assert.equal(en.status, 'ok', out.lines.join('\n'));
	for (const id of ['article', 'podcast', 'social', 'newsletter']) assert.equal(asset(en, id).status, 'ok', `${id}: ${JSON.stringify(asset(en, id).checks.filter((c) => !c.ok))}`);
	assert.equal(en.lint.errors, 0);
	// every listed file exists with the recorded hash
	for (const a of en.assets) for (const f of a.files) assert.equal(sha256File(join(ws.out, CHANNEL, SLUG, 'en', f.path)), f.sha256, f.path);

	// podcast: the publish kit's chapters (the YouTube description's) in both containers, loudness within Apple's
	// window, ID3 tag
	const pod = join(ws.out, CHANNEL, SLUG, 'en', 'podcast');
	for (const file of ['episode.mp3', 'episode.m4a']) {
		const p = spawnSync('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_chapters', join(pod, file)], {encoding: 'utf8'});
		const chapters = (JSON.parse(p.stdout) as {chapters: {tags: {title: string}}[]}).chapters.map((c) => c.tags.title);
		assert.deepEqual(chapters, ['Support never DMs you first', 'How the fake support trick works', "Badger's Red Flag: the countdown", "Zoo's One Fix"], file);
	}
	assert.match(JSON.stringify(asset(en, 'article').checks), /chapters come from the publish kit \(as in the YouTube description: 00:00, 00:09, 00:22, 00:35\); the scene rule would give 00:00, 00:22, 00:35/);
	assert.match(JSON.stringify(asset(en, 'article').checks), /1 kit chapter\(s\) under 10 s \(00:00\)/);
	const loud = asset(en, 'podcast').checks.filter((c) => c.id.startsWith('loudness-') && c.id !== 'loudness-before');
	assert.equal(loud.length, 3);
	for (const c of loud) assert.equal(c.ok, true, c.detail);
	const tag = parseId3(readFileSync(join(pod, 'episode.mp3')));
	assert.equal(tag?.version, 3);
	assert.equal(tag?.chapters.length, 4);
	const item = JSON.parse(readFileSync(join(pod, 'item.json'), 'utf8')) as {durationSec: number; status: string; season: number};
	assert.equal(item.status, 'ok');
	assert.equal(item.season, 1);
	const chaptersJson = JSON.parse(readFileSync(join(pod, 'chapters.json'), 'utf8')) as {version: string; chapters: {startTime: number}[]};
	assert.equal(chaptersJson.version, '1.2.0');
	assert.equal(chaptersJson.chapters[0].startTime, 0);
	assert.match(readFileSync(join(pod, 'show-notes.md'), 'utf8'), /\n00:00 Support never DMs you first {2}\n00:09 How the fake support trick works {2}\n00:22 /);

	// newsletter: creator-hub's CLI ran on the publish kit and wrote its draft; nothing was sent
	const run = JSON.parse(readFileSync(join(ws.out, CHANNEL, SLUG, 'en', 'newsletter', 'run.json'), 'utf8')) as {exitCode: number; kitSource: string; command: string[]};
	assert.equal(run.exitCode, 0);
	assert.equal(run.kitSource, 'publish-kit');
	assert.equal(run.command.includes('--kit-draft'), false);
	assert.equal(existsSync(join(ws.out, CHANNEL, SLUG, 'en', 'newsletter', `${SLUG}.html`)), true);

	// es: machine translation → drafts, noindex, no newsletter (English list), the exchange offer never appears
	const es = manifestOf(ws, 'es');
	assert.equal(asset(es, 'article').status, 'draft');
	assert.equal(asset(es, 'newsletter').status, 'skipped');
	const esHtml = readFileSync(join(ws.out, CHANNEL, SLUG, 'es', 'article', 'index.html'), 'utf8');
	assert.match(esHtml, /<html lang="es">/);
	assert.match(esHtml, /noindex/);
	assert.match(esHtml, /Transcripción/);
	// disclosures are in the page language: the owner-approved Spanish one, never the English registry text
	assert.match(esHtml, /<p class="disclosure">Enlace de afiliado: puedo ganar una comisión si compras\. No te cuesta nada extra\.<\/p>/);
	assert.equal(esHtml.includes('Affiliate link:'), false);
	// es has no kit of its own: it borrows the English kit's video id and offers, and its episode-level disclosure
	// line in the owner-approved Spanish (config disclosureTranslations), never dropped
	assert.match(esHtml, /Los mensajes y páginas que se ven en este video son recreaciones con cuentas ficticias\./);
	assert.equal(esHtml.includes('recreations with fictional accounts'), false);
	assert.match(esHtml, /youtube-nocookie\.com\/embed\/Zb7xq2Ph0aA/);
	assert.match(readFileSync(join(ws.out, CHANNEL, SLUG, 'es', 'podcast', 'show-notes.md'), 'utf8'), /Los mensajes y páginas que se ven en este video son recreaciones/);
	assert.equal(readFileSync(join(ws.out, CHANNEL, SLUG, 'es', 'social', 'telegram.txt'), 'utf8').includes('Affiliate link:'), false);
	for (const lang of ['en', 'es']) {
		for (const f of ['article/index.html', 'social/x-thread.txt', 'social/telegram.txt', 'social/linkedin.txt', 'podcast/show-notes.md']) {
			assert.equal(readFileSync(join(ws.out, CHANNEL, SLUG, lang, f), 'utf8').includes('exchange-demo'), false, `${lang}/${f} has no exchange link`);
		}
	}
	// the pinned correction is on the article; the other episode's is not
	const enHtml = readFileSync(join(ws.out, CHANNEL, SLUG, 'en', 'article', 'index.html'), 'utf8');
	assert.match(enHtml, /general consumer guidance/);
	assert.equal(enHtml.includes('Not for this episode'), false);

	// site: only the ok article; sitemap and feed well-formed
	const site = quiet();
	assert.equal(buildSite(['--out', ws.out, '--config', ws.config, '--now', '2026-11-24T12:00:00Z'], site.print, site.print), 0);
	const articles = join(ws.out, '_site', 'hub', 'articles');
	assert.equal(existsSync(join(articles, CHANNEL, SLUG, 'en', 'index.html')), true);
	assert.equal(existsSync(join(articles, CHANNEL, SLUG, 'es', 'index.html')), false);
	if (HAS_PYTHON) for (const f of ['sitemap.xml', 'feed.xml']) assert.equal(xmlError(readFileSync(join(articles, f), 'utf8')), null, f);

	// podcast feed: written with the test config's owner inputs; refused with the real (empty) ones
	const feed = quiet();
	assert.equal(buildFeed([CHANNEL, '--out', ws.out, '--config', ws.config, '--now', '2026-11-24T12:00:00Z'], feed.print, feed.print), 0, feed.lines.join('\n'));
	const feedXml = readFileSync(join(ws.out, '_site', 'podcast', CHANNEL, 'en', 'feed.xml'), 'utf8');
	if (HAS_PYTHON) assert.equal(xmlError(feedXml), null);
	assert.match(feedXml, /<enclosure url="https:\/\/podcast\.zoora\.test\/zoora-security\/en\/fixture-fake-support\/episode\.mp3" length="\d+" type="audio\/mpeg"\/>/);
	assert.equal(existsSync(join(ws.out, '_site', 'podcast', CHANNEL, 'en', SLUG, 'episode.mp3')), true);
	const refused = quiet();
	assert.equal(buildFeed([CHANNEL, '--out', ws.out], refused.print, refused.print), 1);
	assert.match(refused.lines.join('\n'), /ownerEmail is not set/);
	rmSync(ws.root, {recursive: true, force: true});
});

test('blocking lint: private name, "ZOO", income claim, unverified source', {timeout: 120_000}, () => {
	const ws = workspace(false);
	const run = (lang = 'en') => {
		const out = quiet();
		const code = make(wsArgs(ws, ['--lang', lang, '--only', 'article,social', '--published', '2026-11-24']), out.print, out.print);
		return {code, m: manifestOf(ws, lang), text: out.lines.join('\n')};
	};
	assert.equal(run().code, 0);

	// a storyboard edited after the voice step: flagged, and the article is no longer "ok"
	editJson(sbPath(ws), (j) => void ((j.scenes as Scene[])[4].narration = 'Subscribe now, please.'));
	let r = run();
	assert.equal(r.code, 0);
	assert.equal(asset(r.m, 'article').status, 'draft');
	assert.match(JSON.stringify(asset(r.m, 'article').checks), /timeline-stale.*s05/);

	editJson(sbPath(ws), (j) => {
		(j.scenes as Scene[])[4].narration = "If this saved you a bad afternoon, subscribe. Badger will keep judging the links, so you don't have to.";
		((j.scenes as Scene[])[1].onScreen as {bullets: string[]}).bullets[0] = 'Zelda Fixturova watches public help channels';
	});
	r = run();
	assert.equal(r.code, 1);
	assert.equal(asset(r.m, 'article').status, 'blocked');
	assert.equal(asset(r.m, 'social').status, 'blocked');
	assert.equal(r.text.includes('Zelda'), false, 'the private name is not printed');
	assert.equal(JSON.stringify(r.m).includes('Zelda'), false, 'nor written to the manifest');

	editJson(sbPath(ws), (j) => {
		((j.scenes as Scene[])[1].onScreen as {bullets: string[]}).bullets[0] = 'They watch public help channels';
		((j.scenes as Scene[])[3].onScreen as {steps: string[]}).steps[0] = "ZOO'S ONE FIX: use official links";
	});
	r = run();
	assert.equal(asset(r.m, 'article').status, 'blocked');
	assert.equal(asset(r.m, 'social').status, 'blocked');
	assert.match(JSON.stringify(asset(r.m, 'social').checks), /zoo-name/);

	editJson(sbPath(ws), (j) => void (((j.scenes as Scene[])[3].onScreen as {steps: string[]}).steps[0] = 'Use official links'));
	editJson(join(ws.content, CHANNEL, SLUG, 'assets.json'), (j) => void (j.summary = 'This trick is a guaranteed way to lose money.'));
	r = run();
	assert.equal(asset(r.m, 'article').status, 'blocked');
	assert.match(JSON.stringify(asset(r.m, 'article').checks), /income-claim/);

	editJson(join(ws.content, CHANNEL, SLUG, 'assets.json'), (j) => void (j.summary = 'A fake support message and the one fix.'));
	editJson(sbPath(ws), (j) => void ((j.sources as {status: string}[])[1].status = 'unverified'));
	r = run();
	assert.equal(asset(r.m, 'article').status, 'blocked');
	assert.match(JSON.stringify(asset(r.m, 'article').checks), /unverified source\(s\): ftc-report/);

	// a source link that is not http(s) is an input error: nothing is built from it
	editJson(sbPath(ws), (j) => void ((j.sources as {url: string}[])[1].url = 'javascript:alert(1)'));
	const bad = quiet();
	assert.equal(make(wsArgs(ws, ['--lang', 'en', '--only', 'article']), bad.print, bad.print), 2);
	assert.match(bad.lines.join('\n'), /sources\[1\]\.url must be an http\(s\) URL/);
	rmSync(ws.root, {recursive: true, force: true});
});

test('Badger cues: mixed when they sit between Zoo\'s lines, blocked when they play over him', {skip: !HAS_FFMPEG && 'ffmpeg not installed', timeout: 180_000}, () => {
	const ws = workspace();
	const dir = join(ws.generated, CHANNEL, SLUG, 'en');
	synthClip(join(dir, 'huff.wav'));
	const cues = join(dir, 'badger-cues.json');
	writeFileSync(cues, JSON.stringify({version: 1, cues: [{clip: 'huff.wav', atMs: 34500, gainDb: -3, label: 'huff'}]}));
	let out = quiet();
	assert.equal(make(wsArgs(ws, ['--lang', 'en', '--only', 'podcast', '--published', '2026-11-24']), out.print, out.print), 0, out.lines.join('\n'));
	let pod = asset(manifestOf(ws, 'en'), 'podcast');
	assert.equal(pod.status, 'ok');
	assert.equal((pod.extra as {cues: number}).cues, 1);

	writeFileSync(cues, JSON.stringify({version: 1, cues: [{clip: 'huff.wav', atMs: 10_000}]}));
	out = quiet();
	assert.equal(make(wsArgs(ws, ['--lang', 'en', '--only', 'podcast']), out.print, out.print), 1);
	pod = asset(manifestOf(ws, 'en'), 'podcast');
	assert.equal(pod.status, 'blocked');
	assert.match(JSON.stringify(pod.checks), /over Zoo's speech/);
	rmSync(ws.root, {recursive: true, force: true});
});

test('skips and fallbacks: daily Shorts, short episodes, no timeline, no publish kit', {timeout: 120_000}, () => {
	const ws = workspace(false);
	// no audio at all → podcast skipped, article still built from the timeline
	let out = quiet();
	assert.equal(make(wsArgs(ws, ['--lang', 'en', '--only', 'podcast,article']), out.print, out.print), 0);
	assert.match(asset(manifestOf(ws, 'en'), 'podcast').summary, /no narration audio/);

	editJson(sbPath(ws), (j) => void (j.news = {format: 'daily-short'}));
	out = quiet();
	make(wsArgs(ws, ['--lang', 'en', '--only', 'podcast']), out.print, out.print);
	assert.match(asset(manifestOf(ws, 'en'), 'podcast').summary, /daily Shorts/);

	// the timeline removed: transcript from the storyboard, flagged, no timestamps
	rmSync(join(ws.generated, CHANNEL, SLUG, 'es', 'timeline.json'));
	out = quiet();
	assert.equal(make(wsArgs(ws, ['--lang', 'es', '--only', 'article']), out.print, out.print), 0);
	const es = manifestOf(ws, 'es');
	assert.equal(asset(es, 'article').status, 'draft');
	assert.match(JSON.stringify(asset(es, 'article').checks), /no timeline/);
	const esHtml = readFileSync(join(ws.out, CHANNEL, SLUG, 'es', 'article', 'index.html'), 'utf8');
	assert.equal(esHtml.includes('class="ts"'), false);
	assert.match(esHtml, /procede del guion/);

	// no publish kit: the newsletter runs on the adapter kit and stays a draft
	rmSync(ws.publish, {recursive: true, force: true});
	out = quiet();
	assert.equal(make(wsArgs(ws, ['--lang', 'en', '--only', 'newsletter', '--youtube-id', 'Zb7xq2Ph0aA']), out.print, out.print), 0, out.lines.join('\n'));
	const nl = asset(manifestOf(ws, 'en'), 'newsletter');
	assert.equal(nl.status, 'draft', JSON.stringify(nl.checks));
	const run = JSON.parse(readFileSync(join(ws.out, CHANNEL, SLUG, 'en', 'newsletter', 'run.json'), 'utf8')) as {exitCode: number; kitSource: string};
	assert.equal(run.exitCode, 0);
	assert.equal(run.kitSource, 'assets-adapter');
	// --only keeps the other assets of the previous runs in the manifest
	assert.deepEqual(manifestOf(ws, 'en').assets.map((a) => a.id), ['article', 'podcast', 'newsletter']);
	rmSync(ws.root, {recursive: true, force: true});
});

test('usage errors exit 2; the cover step reports the missing composition', () => {
	const out = quiet();
	assert.equal(make([], out.print, out.print), 2);
	assert.equal(make(['no-slash'], out.print, out.print), 2);
	assert.equal(make(['zoora-security/does-not-exist'], out.print, out.print), 2);
	assert.equal(make([`${CHANNEL}/${SLUG}`, '--only', 'video'], out.print, out.print), 2);
	assert.equal(make([`${CHANNEL}/${SLUG}`, '--lang', 'fr'], out.print, out.print), 2);
	const c = quiet();
	assert.equal(cover([CHANNEL, '--composition', 'NoSuchCompositionForTests'], c.print, c.print), 3);
	assert.match(c.lines.join('\n'), /npx remotion still src\/episode\/index\.ts NoSuchCompositionForTests/);
});

test('podcast feed: a sidecar season or episode that is not a positive whole number is refused, and a changed item.json never reaches the feed', {skip: !HAS_FFMPEG && 'ffmpeg not installed', timeout: 180_000}, () => {
	const ws = workspace();
	const sidecar = join(ws.content, CHANNEL, SLUG, 'assets.json');
	// the 2026-11-24 review's payload: a string season that closes the item and adds channel-level elements
	const payload = '1</itunes:season></item><itunes:new-feed-url>https://attacker.example/feed.xml</itunes:new-feed-url><itunes:block>Yes</itunes:block><item><itunes:season>1';
	editJson(sidecar, (j) => void (j.podcast = {season: payload}));
	let out = quiet();
	assert.equal(make(wsArgs(ws, ['--lang', 'en', '--only', 'podcast', '--published', '2026-11-24']), out.print, out.print), 2, 'refused as bad input');
	assert.match(out.lines.join('\n'), /"podcast\.season" must be a positive whole number/);
	for (const bad of [0, -1, 1.5, '2', true]) {
		editJson(sidecar, (j) => void (j.podcast = {episode: bad}));
		out = quiet();
		assert.equal(make(wsArgs(ws, ['--lang', 'en', '--only', 'podcast']), out.print, out.print), 2, `episode ${JSON.stringify(bad)}`);
	}
	editJson(sidecar, (j) => void (j.podcast = {season: 1, episode: 2, title: 'x', skip: false, extra: 1}));
	out = quiet();
	assert.equal(make(wsArgs(ws, ['--lang', 'en', '--only', 'podcast']), out.print, out.print), 2);
	assert.match(out.lines.join('\n'), /unknown key "podcast\.extra"/);

	// a valid build, then item.json changed on disk (the payload, and a path out of its folder): the feed is refused
	editJson(sidecar, (j) => void (j.podcast = {season: 1, episode: 2}));
	out = quiet();
	assert.equal(make(wsArgs(ws, ['--lang', 'en', '--only', 'podcast', '--published', '2026-11-24T17:00:00Z']), out.print, out.print), 0, out.lines.join('\n'));
	const itemPath = join(ws.out, CHANNEL, SLUG, 'en', 'podcast', 'item.json');
	const good = readFileSync(itemPath, 'utf8');
	for (const [name, edit] of [
		['season payload', (j: Record<string, unknown>) => void (j.season = payload)],
		['episodeType', (j: Record<string, unknown>) => void (j.episodeType = 'full</itunes:episodeType><itunes:block>Yes</itunes:block><x>')],
		['file path', (j: Record<string, unknown>) => void ((j.files as {mp3: {path: string}}).mp3.path = '../../../../../../etc/passwd')],
		['duration', (j: Record<string, unknown>) => void (j.durationSec = '1</itunes:duration><itunes:block>Yes</itunes:block>')],
	] as const) {
		writeFileSync(itemPath, good);
		editJson(itemPath, edit);
		const feed = quiet();
		assert.equal(buildFeed([CHANNEL, '--out', ws.out, '--config', ws.config, '--now', '2026-11-25T12:00:00Z'], feed.print, feed.print), 1, name);
		assert.match(feed.lines.join('\n'), /invalid podcast item/, name);
		assert.equal(existsSync(join(ws.out, '_site', 'podcast', CHANNEL, 'en', 'feed.xml')), false, `${name}: no feed written`);
	}
	writeFileSync(itemPath, good);
	const feed = quiet();
	assert.equal(buildFeed([CHANNEL, '--out', ws.out, '--config', ws.config, '--now', '2026-11-25T12:00:00Z'], feed.print, feed.print), 0, feed.lines.join('\n'));
	const xmlText = readFileSync(join(ws.out, '_site', 'podcast', CHANNEL, 'en', 'feed.xml'), 'utf8');
	assert.match(xmlText, /<itunes:season>1<\/itunes:season>\n {6}<itunes:episode>2<\/itunes:episode>/);
	assert.equal(xmlText.includes('new-feed-url') || xmlText.includes('itunes:block'), false);
	if (HAS_PYTHON) assert.equal(xmlError(xmlText), null);
	rmSync(ws.root, {recursive: true, force: true});
});

test('a dub with no kit of its own: an untranslated kit disclosure blocks it instead of disappearing', {timeout: 120_000}, () => {
	const ws = workspace(false);
	editJson(ws.config, (c) => void delete (c.defaults as Record<string, unknown>).disclosureTranslations);
	const out = quiet();
	assert.equal(make(wsArgs(ws, ['--lang', 'es', '--only', 'article,social', '--published', '2026-11-24']), out.print, out.print), 1);
	const es = manifestOf(ws, 'es');
	assert.equal(asset(es, 'article').status, 'blocked');
	assert.equal(asset(es, 'social').status, 'blocked');
	assert.match(JSON.stringify(asset(es, 'article').checks), /disclosure-untranslated.*have no owner-approved es translation.*recreations with fictional/);
	assert.ok(es.ownerActions.some((a) => /No es publish kit: borrowed the en kit/.test(a)));
	rmSync(ws.root, {recursive: true, force: true});
});

test('pinned corrections: in the page language when translated; otherwise marked with their language and warned', {timeout: 120_000}, () => {
	const ws = workspace(false);
	const corrections = join(ws.content, CHANNEL, 'corrections.json');
	let out = quiet();
	assert.equal(make(wsArgs(ws, ['--lang', 'es', '--only', 'article', '--published', '2026-11-24']), out.print, out.print), 0, out.lines.join('\n'));
	let html = readFileSync(join(ws.out, CHANNEL, SLUG, 'es', 'article', 'index.html'), 'utf8');
	assert.match(html, /<span lang="en">The FTC page linked below is general consumer guidance/);
	assert.match(JSON.stringify(asset(manifestOf(ws, 'es'), 'article').checks), /correction-untranslated.*1 pinned correction\(s\) have no es text/);
	editJson(corrections, (j) => void ((j.corrections as Array<Record<string, unknown>>)[0].languages = {es: 'La página de la FTC enlazada abajo es una guía general para consumidores; no describe este mensaje concreto.'}));
	out = quiet();
	assert.equal(make(wsArgs(ws, ['--lang', 'es', '--only', 'article', '--published', '2026-11-24']), out.print, out.print), 0);
	html = readFileSync(join(ws.out, CHANNEL, SLUG, 'es', 'article', 'index.html'), 'utf8');
	assert.match(html, /La página de la FTC enlazada abajo es una guía general/);
	assert.equal(html.includes('general consumer guidance'), false);
	assert.doesNotMatch(JSON.stringify(asset(manifestOf(ws, 'es'), 'article').checks), /correction-untranslated/);
	rmSync(ws.root, {recursive: true, force: true});
});

test('a date with no time is that day in America/Chicago, and the site has an index page per channel for the podcast link', {timeout: 120_000}, () => {
	const ws = workspace(false);
	const out = quiet();
	assert.equal(make(wsArgs(ws, ['--lang', 'en', '--only', 'article', '--published', '2026-11-30', '--youtube-id', 'Zb7xq2Ph0aA']), out.print, out.print), 0, out.lines.join('\n'));
	const html = readFileSync(join(ws.out, CHANNEL, SLUG, 'en', 'article', 'index.html'), 'utf8');
	assert.match(html, /<meta property="article:published_time" content="2026-11-30">/, 'only the date: no invented time');
	assert.match(html, /"datePublished": "2026-11-30"/);
	assert.match(html, /<time datetime="2026-11-30">/);
	const meta = JSON.parse(readFileSync(join(ws.out, CHANNEL, SLUG, 'en', 'article', 'meta.json'), 'utf8')) as {datePublished: string};
	assert.equal(meta.datePublished, '2026-11-30T06:00:00Z', 'feeds: 00:00 in Chicago (CST), not 00:00 UTC (18:00 the evening before)');
	assert.match(JSON.stringify(asset(manifestOf(ws, 'en'), 'article').checks), /only a date was given \(2026-11-30\): the feeds read it as 00:00 America\/Chicago/);

	const site = quiet();
	assert.equal(buildSite(['--out', ws.out, '--config', ws.config, '--now', '2026-11-30T12:00:00Z'], site.print, site.print), 0);
	const articles = join(ws.out, '_site', 'hub', 'articles');
	const index = readFileSync(join(articles, CHANNEL, 'index.html'), 'utf8');
	assert.match(index, /<link rel="canonical" href="https:\/\/go\.zoora\.ai\/articles\/zoora-security\/">/);
	assert.match(index, /<h1>The Zoo &amp; Badger Show: episodes<\/h1>/);
	const sitemap = readFileSync(join(articles, 'sitemap.xml'), 'utf8');
	assert.match(sitemap, /<loc>https:\/\/go\.zoora\.ai\/articles\/zoora-security\/<\/loc>/);
	assert.match(sitemap, /<loc>https:\/\/go\.zoora\.ai\/articles\/<\/loc>/);
	assert.match(readFileSync(join(articles, 'feed.xml'), 'utf8'), /<published>2026-11-30T06:00:00Z<\/published>/);
	if (HAS_PYTHON) assert.equal(xmlError(sitemap), null);
	rmSync(ws.root, {recursive: true, force: true});
});
