/** Rendering tests: the article page, the site files, the social posts and the podcast feed. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {test} from 'node:test';
import {articleUrl, renderArticle, type ArticleInput} from '../lib/article.ts';
import {htmlBalanceProblems} from '../lib/html.ts';
import {strings} from '../lib/i18n.ts';
import {buildPodcastFeed, feedProblems, type FeedItem} from '../lib/rss.ts';
import {buildAtomFeed, buildIndexPage, buildSitemap} from '../lib/site.ts';
import {linkedinPost, telegramPost, xThread, type SocialInput} from '../lib/social.ts';
import {xLength} from '../lib/xcount.ts';
import type {PodcastShow} from '../lib/config.ts';
import {HAS_PYTHON, xmlError} from './helpers.ts';

const EVIL = `</script><script>alert("x")</script><img src=x onerror=alert(1)>`;
const BASE = 'https://go.zoora.ai/articles';

const input = (over: Partial<ArticleInput> = {}): ArticleInput => {
	const url = articleUrl(BASE, 'zoora-security', 'ep', 'en');
	return {
		channel: 'zoora-security',
		slug: 'ep',
		lang: 'en',
		siteKey: 'hub',
		siteName: 'Zoora AI',
		brand: 'Zoora AI',
		showName: 'The Zoo & Badger Show',
		hubOrigin: 'https://go.zoora.ai',
		url,
		indexUrl: `${BASE}/`,
		alternates: [
			{lang: 'en', hreflang: 'en', url},
			{lang: 'pt-br', hreflang: 'pt-BR', url: articleUrl(BASE, 'zoora-security', 'ep', 'pt-br')},
		],
		indexable: true,
		title: `Title ${EVIL}`,
		summary: `Summary ${EVIL}`,
		takeaways: [`Take ${EVIL}`],
		paragraphs: [
			{sceneId: 's01', sceneType: 'hook', startMs: 0, endMs: 9000, text: `Hello ${EVIL}`, sourceIds: ['a']},
			{sceneId: 's02', sceneType: 'talk', startMs: 9000, endMs: 20000, text: 'Second part.', sourceIds: []},
		],
		chapters: [
			{startMs: 0, endMs: 9000, title: 'One', sceneIds: ['s01']},
			{startMs: 9000, endMs: 20000, title: 'Two', sceneIds: ['s02']},
		],
		transcriptFromTimeline: true,
		sources: [{id: 'a', title: `Source ${EVIL}`, url: 'https://consumer.ftc.gov/x?a=1&b=2', accessed: '2026-11-24', status: 'verified'}],
		offers: [{id: 'w', name: `Wallet ${EVIL}`, disclosure: 'Affiliate link: I may earn a commission.', url: 'https://go.zoora.ai/go/w?v=ep&s=site'}],
		disclosures: ['Recreated messages, fictional accounts.'],
		fictionNote: null,
		developing: {label: 'Developing story', asOf: '2026-11-24 10:00 UTC'},
		corrections: [{date: '2026-11-25', text: `Fixed ${EVIL}`}],
		machineTranslation: false,
		youtubeId: 'Zb7xq2Ph0aA',
		publishedAt: '2026-11-24T00:00:00Z',
		modifiedAt: '2026-11-24T12:00:00Z',
		durationMs: 20000,
		subscribeUrl: 'https://go.zoora.ai/subscribe?s=site&v=ep',
		feedUrl: `${BASE}/feed.xml`,
		s: strings('en').s,
		...over,
	};
};

test('article: every piece of text is escaped; JSON-LD parses and cannot close its script', () => {
	const {html} = renderArticle(input());
	assert.equal(html.includes('<script>alert'), false);
	assert.equal(html.includes('<img src=x'), false);
	assert.equal(html.match(/<script/g)?.length, 1, 'only the JSON-LD block');
	assert.deepEqual(htmlBalanceProblems(html), []);
	const ld = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html);
	assert.ok(ld);
	const data = JSON.parse(ld[1]) as {'@graph': Record<string, unknown>[]};
	const types = data['@graph'].map((g) => g['@type']);
	assert.deepEqual(types, ['Article', 'VideoObject']);
	const video = data['@graph'][1];
	for (const key of ['name', 'description', 'thumbnailUrl', 'uploadDate', 'embedUrl', 'duration']) assert.ok(video[key], `VideoObject.${key}`);
	assert.equal(video.duration, 'PT20S');
	assert.equal((data['@graph'][0].headline as string).length <= 110, true);
});

test('article: canonical, hreflang (with x-default), OpenGraph, CSP hash of the inline style', () => {
	const {html, meta} = renderArticle(input());
	assert.match(html, /<link rel="canonical" href="https:\/\/go\.zoora\.ai\/articles\/zoora-security\/ep\/en\/">/);
	assert.match(html, /hreflang="pt-BR" href="https:\/\/go\.zoora\.ai\/articles\/zoora-security\/ep\/pt-br\/"/);
	assert.match(html, /hreflang="x-default" href="https:\/\/go\.zoora\.ai\/articles\/zoora-security\/ep\/en\/"/);
	assert.match(html, /<meta property="og:locale:alternate" content="pt_BR">/);
	assert.match(html, /<meta name="robots" content="index, follow/);
	const style = /<style>([\s\S]*?)<\/style>/.exec(html)?.[1] ?? '';
	const hash = createHash('sha256').update(style).digest('base64');
	assert.equal(html.includes(`style-src 'sha256-${hash}'`), true);
	assert.equal(meta.styleSha256, hash);
	assert.equal(/ style="/.test(html), false, 'no inline style attributes (the CSP would block them)');
});

test('article: each offer link has its disclosure directly above it and rel=sponsored', () => {
	const {html} = renderArticle(input());
	const m = /<div class="offer"><p class="disclosure">([^<]+)<\/p><p><a href="([^"]+)" rel="sponsored noopener">/.exec(html);
	assert.ok(m, 'disclosure paragraph immediately before the link');
	assert.equal(m[1], 'Affiliate link: I may earn a commission.');
	assert.equal(m[2], 'https://go.zoora.ai/go/w?v=ep&amp;s=site');
});

test('article: drafts are noindex with no hreflang; no YouTube id gives a placeholder and no VideoObject', () => {
	const {html} = renderArticle(input({indexable: false, alternates: [], youtubeId: null, publishedAt: null, machineTranslation: true}));
	assert.match(html, /<meta name="robots" content="noindex, follow">/);
	assert.equal(html.includes('hreflang'), false);
	assert.equal(html.includes('<iframe'), false);
	assert.match(html, /The video is not published yet/);
	assert.match(html, /Machine translation/);
	assert.equal(html.includes('VideoObject'), false);
	assert.equal(html.includes('og:image'), false);
});

test('article: transcript paragraphs carry timestamp links and source footnotes', () => {
	const {html} = renderArticle(input());
	assert.match(html, /<p id="p-s02"><a class="ts" href="https:\/\/www\.youtube\.com\/watch\?v=Zb7xq2Ph0aA&amp;t=9s"/);
	assert.match(html, /<a href="#src-1" aria-label="Sources: 1">\[1\]<\/a>/);
	assert.match(html, /<li id="src-1"><a href="https:\/\/consumer\.ftc\.gov\/x\?a=1&amp;b=2" rel="noopener">/);
	assert.match(html, /<h3 id="ch-s02">Two<\/h3>/);
	assert.match(html, /Developing story/);
	assert.match(html, /<h2 id="corrections">Corrections<\/h2>/);
});

test('site: sitemap with hreflang, Atom feed and index are well-formed XML/HTML and list only indexable pages', {skip: !HAS_PYTHON && 'python3 not installed'}, () => {
	const a = renderArticle(input()).meta;
	const b = {...renderArticle(input({lang: 'pt-br', url: articleUrl(BASE, 'zoora-security', 'ep', 'pt-br')})).meta};
	const hidden = {...renderArticle(input({slug: 'draft', url: articleUrl(BASE, 'zoora-security', 'draft', 'en'), indexable: false, alternates: []})).meta};
	const info = {siteName: 'Zoora AI', articleBase: BASE, brand: 'Zoora AI', hubOrigin: 'https://go.zoora.ai', generatedAt: '2026-11-24T12:00:00Z'};
	const sitemap = buildSitemap([a, b, hidden]);
	assert.equal(xmlError(sitemap), null);
	assert.equal((sitemap.match(/<url>/g) ?? []).length, 2);
	assert.equal(sitemap.includes('/draft/'), false);
	assert.match(sitemap, /<xhtml:link rel="alternate" hreflang="x-default"/);
	const feed = buildAtomFeed([a, b, hidden], info);
	assert.equal(xmlError(feed), null);
	assert.equal((feed.match(/<entry /g) ?? []).length, 2);
	assert.equal(feed.includes('<script'), false);
	const index = buildIndexPage([a, b, hidden], info);
	assert.deepEqual(htmlBalanceProblems(index), []);
	assert.equal(index.includes('<script'), false);
});

const social = (over: Partial<SocialInput> = {}): SocialInput => ({
	title: 'Support never DMs you first',
	summary: 'A stranger in your DMs claims to be wallet support and sends a link. Zoo shows the trick. The fix: real support never messages you first.',
	hook: null,
	takeaways: ['They watch public help channels', 'They message you first', 'Use support links from the official website only'],
	chapterTitles: ['Intro', 'The trick', 'The fix'],
	youtubeUrl: 'https://www.youtube.com/watch?v=Zb7xq2Ph0aA',
	articleUrl: 'https://go.zoora.ai/articles/zoora-security/ep/en/',
	subscribeUrl: 'https://go.zoora.ai/subscribe?s=other&v=ep',
	developing: null,
	fictionNote: null,
	hashtags: ['CryptoSecurity'],
	offersX: [{id: 'w', name: 'Wallet', disclosure: 'Affiliate link: I may earn a commission.', url: 'https://go.zoora.ai/go/w?v=ep&s=x'}],
	offersOther: [{id: 'w', name: 'Wallet', disclosure: 'Affiliate link: I may earn a commission.', url: 'https://go.zoora.ai/go/w?v=ep&s=other'}],
	s: strings('en').s,
	...over,
});

test('X thread: 3-6 posts, each within 280 weighted characters, disclosure in the post with the link', () => {
	for (const inp of [
		social(),
		social({takeaways: [], chapterTitles: []}),
		social({summary: 'x '.repeat(400), takeaways: Array.from({length: 30}, (_, i) => `Takeaway number ${i} with some words in it`)}),
		social({title: '你好'.repeat(60), summary: '这是一个很长的摘要。'.repeat(30), takeaways: ['第一条'.repeat(80)]}),
		social({developing: 'DEVELOPING:', fictionNote: 'Fictional story · composite characters · not financial advice'}),
	]) {
		const t = xThread(inp);
		assert.equal(t.posts.length >= 3 && t.posts.length <= 6, true, `${t.posts.length} posts`);
		for (const p of t.posts) assert.equal(p.xLength <= 280 && p.xLength === xLength(p.text), true, `${p.xLength}: ${p.text.slice(0, 40)}`);
		const withLink = t.posts.filter((p) => p.text.includes('/go/w'));
		assert.equal(withLink.length, 1);
		assert.equal(withLink[0].text.indexOf('Affiliate link') < withLink[0].text.indexOf('/go/w'), true);
	}
	const t = xThread(social());
	assert.equal(t.posts[0].text.endsWith('messages you first.'), true, 'the opener ends on a whole sentence');
});

test('Telegram and LinkedIn: limits, escaping, disclosure right above the offer link', () => {
	const tg = telegramPost(social({title: 'A <b>bold</b> & "title"'}));
	assert.equal(tg.html.includes('<b>A &lt;b&gt;bold&lt;/b&gt; &amp; &quot;title&quot;</b>'), true);
	assert.equal(tg.visibleLength <= 4096, true);
	assert.match(tg.text, /Affiliate link: I may earn a commission\.\nWallet: https:\/\/go\.zoora\.ai\/go\/w\?v=ep&s=other/);
	assert.match(tg.html, /Affiliate link: I may earn a commission\.\n<a href="https:\/\/go\.zoora\.ai\/go\/w\?v=ep&amp;s=other">Wallet<\/a>/);
	const li = linkedinPost(social());
	assert.equal(li.length <= 3000, true);
	assert.equal(li.hookLength <= 210, true);
	assert.match(li.text, /Affiliate link: I may earn a commission\.\nWallet: https:\/\/go\.zoora\.ai\/go\/w\?v=ep&s=other/);
	assert.match(li.text, /#CryptoSecurity$/);
});

const show: PodcastShow = {
	title: 'The Zoo & Badger Show',
	description: 'Crypto & AI security.',
	author: 'Zoora AI',
	ownerName: 'Zoora AI',
	ownerEmail: 'owner@zoora.test',
	feedUrl: 'https://podcast.zoora.test/en/feed.xml',
	mediaBase: 'https://podcast.zoora.test/en',
	imageUrl: 'https://podcast.zoora.test/cover.jpg',
	link: 'https://go.zoora.ai/articles/zoora-security/',
	categories: [['Technology'], ['News', 'Tech News']],
	explicit: false,
	type: 'episodic',
	copyright: '© 2026 Zoora AI',
	guid: null,
	locked: true,
};

const item: FeedItem = {
	guid: 'zoora-security/ep/en',
	title: 'Episode & "quotes"',
	link: 'https://go.zoora.ai/articles/zoora-security/ep/en/',
	descriptionHtml: '<p>Notes with ]]> inside</p>',
	pubDate: '2026-11-24T00:00:00Z',
	durationSec: 61,
	explicit: false,
	episodeType: 'full',
	enclosure: {url: 'https://podcast.zoora.test/en/ep/episode.mp3', bytes: 1234, type: 'audio/mpeg'},
	chaptersUrl: 'https://podcast.zoora.test/en/ep/chapters.json',
	transcripts: [{url: 'https://podcast.zoora.test/en/ep/transcript.vtt', type: 'text/vtt', language: 'en'}],
	chapters: [{startMs: 0, title: 'Intro'}, {startMs: 22900, title: "Badger's Red Flag"}],
};

test('podcast feed: required iTunes and Podcasting 2.0 tags, well-formed, owner inputs enforced', {skip: !HAS_PYTHON && 'python3 not installed'}, () => {
	const xmlText = buildPodcastFeed(show, 'en', [item], '2026-11-24T12:00:00Z');
	assert.equal(xmlError(xmlText), null);
	for (const tag of ['<itunes:image href=', '<itunes:explicit>false</itunes:explicit>', '<itunes:category text="News"><itunes:category text="Tech News"/>', '<language>en</language>', '<itunes:email>owner@zoora.test</itunes:email>', '<podcast:guid>', '<podcast:locked owner="owner@zoora.test">yes</podcast:locked>', '<podcast:transcript url=', '<podcast:chapters url=', '<psc:chapter start="00:00:22.900"', 'length="1234" type="audio/mpeg"']) {
		assert.equal(xmlText.includes(tag), true, tag);
	}
	assert.equal(xmlText.includes('<![CDATA[<p>Notes with ]]]]><![CDATA[> inside</p>]]>'), true, 'CDATA end marker split');
	const missing = feedProblems({...show, ownerEmail: null, feedUrl: null, mediaBase: null, imageUrl: null}, []);
	assert.equal(missing.filter((p) => p.level === 'error').length, 5);
	assert.deepEqual(feedProblems(show, [item]), []);
});
