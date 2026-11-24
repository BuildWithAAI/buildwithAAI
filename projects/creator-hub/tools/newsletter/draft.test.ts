/** Draft generator tests: the fixture kit.json, offer gating by region, links, escaping and kit validation. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {describe, it} from 'node:test';
import {checkRegistry} from '../../src/server/offers.ts';
import type {OfferRegistry} from '../../src/types.ts';
import {buildDraft, previewText, type DraftOptions} from './draft.ts';
import {lintDraft, lintFile, lintRendered} from './lint.ts';
import {checkPublishKit, readPublishKit, type NewsletterKit} from './publish-kit.ts';
import {renderEmailContent, renderEmailHtml, renderMarkdown} from './render.ts';

const fixture = (name: string): string => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
const NOW = new Date('2026-11-24T12:00:00Z');
const EMAIL_LINK = 'https://go.zoora.ai/go/hardware-wallet?v=fake-support-dm&s=email';
const WALLET_DISCLOSURE = 'Affiliate link: I may earn a commission if you buy. It costs you nothing extra.';

const loadKit = (): NewsletterKit => {
	const {kit, errors} = readPublishKit(fixture('kit.json'));
	assert.deepEqual(errors, []);
	assert.ok(kit);
	return kit;
};
const loadRegistry = (): OfferRegistry => {
	const check = checkRegistry(JSON.parse(readFileSync(fixture('offers.json'), 'utf8')));
	assert.deepEqual(check.errors, []);
	return check.registry;
};
const build = (kit: NewsletterKit = loadKit(), options: Partial<DraftOptions> = {}) =>
	buildDraft(kit, {registry: loadRegistry(), now: NOW, ...options});
const errorsOf = (issues: {level: string; message: string}[]): string[] => issues.filter((i) => i.level === 'error').map((i) => i.message);

describe('buildDraft with the fixture kit.json', () => {
	it('builds the summary, watch link, chapter takeaways, sources and footer', () => {
		const {draft, issues} = build();
		assert.deepEqual(errorsOf(issues), []);
		assert.equal(draft.slug, 'fake-support-dm');
		assert.equal(draft.subject, 'POV: "Support" DMs you first');
		assert.match(draft.summary, /^A stranger in your DMs says he is from wallet support/);
		assert.ok(draft.previewText.length <= 140);
		assert.equal(draft.watchUrl, 'https://www.youtube.com/watch?v=AbCdEfGh123');
		assert.deepEqual(
			draft.takeaways.map((t) => [t.time, t.url]),
			[
				['00:42', 'https://www.youtube.com/watch?v=AbCdEfGh123&t=42s'],
				['02:05', 'https://www.youtube.com/watch?v=AbCdEfGh123&t=125s'],
				['04:30', 'https://www.youtube.com/watch?v=AbCdEfGh123&t=270s'],
				['06:10', 'https://www.youtube.com/watch?v=AbCdEfGh123&t=370s'],
			],
			'"Cold open" is not a takeaway',
		);
		assert.equal(draft.sources.length, 2);
		assert.equal(draft.disclosuresUrl, 'https://go.zoora.ai/disclosures');
		assert.match(draft.footer.join(' '), /You're getting this email because you subscribed to Zoora AI emails/);
		assert.match(draft.safetyLine, /never DM you first, ask for your seed phrase/);
		assert.equal(draft.generatedAt, NOW.toISOString());
	});

	it('includes unrestricted live offers through the hub with s=email&v=<slug> and their disclosure', () => {
		const {draft} = build();
		assert.deepEqual(draft.offers, [
			{id: 'hardware-wallet', name: 'Test Hardware Wallet', label: 'Affiliate link', url: EMAIL_LINK, disclosure: [WALLET_DISCLOSURE]},
		]);
	});

	it('leaves restricted offers out, because an email reader country is unknown', () => {
		const {draft} = build();
		assert.equal(draft.leftOut.length, 1);
		assert.equal(draft.leftOut[0]?.id, 'exchange-demo');
		assert.match(draft.leftOut[0]?.reason ?? '', /restricted by country \(blocked in US, GB; unknownCountry "block"\)/);
		assert.doesNotMatch(renderEmailHtml(draft) + renderMarkdown(draft), /exchange-demo|Demo Exchange|share of fees/);
	});

	it('leaves out inactive offers, offers missing from the registry, and every offer when there is no registry', () => {
		const kit = loadKit();
		const withExtra = {...kit, offers: [...kit.offers, {id: 'paused-tool', hubUrl: 'https://go.zoora.ai/go/paused-tool', disclosure: 'Affiliate link.'}, {id: 'unknown-offer', hubUrl: 'https://go.zoora.ai/go/unknown-offer', disclosure: 'Affiliate link.'}]};
		const {draft} = build(withExtra);
		assert.deepEqual(
			draft.leftOut.map((o) => [o.id, o.reason.split(' (')[0]]),
			[
				['exchange-demo', 'restricted by country'],
				['paused-tool', 'inactive or expired in the offer registry'],
				['unknown-offer', 'not in the offer registry'],
			],
		);
		const none = build(kit, {registry: null}).draft;
		assert.deepEqual(none.offers, []);
		assert.ok(none.leftOut.every((o) => /no offer registry was loaded/.test(o.reason)));
	});

	it('keeps the episode disclosures that are not already next to an offer link', () => {
		assert.deepEqual(build().draft.episodeDisclosures, ['The people and chats in this video are fictional and animated.']);
	});

	it('rebuilds every hub link instead of trusting the kit query string', () => {
		const kit = loadKit();
		const odd = {...kit, offers: [{...kit.offers[0]!, hubUrl: 'https://go.zoora.ai/go/hardware-wallet?v=other&s=yt&utm_source=x#frag'}]};
		assert.equal(build(odd).draft.offers[0]?.url, EMAIL_LINK);
	});

	it('resolves relative hub links with the hub origin, and reports them without one', () => {
		const kit = loadKit();
		const relative = {...kit, offers: [{...kit.offers[0]!, hubUrl: '/go/hardware-wallet?v=fake-support-dm&s=yt'}]};
		assert.equal(build(relative, {hubOrigin: 'https://go.zoora.ai'}).draft.offers[0]?.url, EMAIL_LINK);
		assert.match(errorsOf(build(relative).issues).join('\n'), /hubUrl is a relative link: pass --hub <origin>/);
		const wrongPath = {...kit, offers: [{...kit.offers[0]!, hubUrl: 'https://go.zoora.ai/go/other-offer'}]};
		assert.match(errorsOf(build(wrongPath).issues).join('\n'), /hubUrl must point at the hub's \/go\/hardware-wallet/);
		const plainHttp = {...kit, offers: [{...kit.offers[0]!, hubUrl: 'http://go.zoora.ai/go/hardware-wallet'}]};
		assert.match(errorsOf(build(plainHttp).issues).join('\n'), /hubUrl must use https/);
	});

	it('reports a missing watch link, and takes --youtube-id instead', () => {
		const noVideo = {...loadKit(), youtubeVideoId: null};
		const missing = build(noVideo);
		assert.match(errorsOf(missing.issues).join('\n'), /no watch link/);
		assert.equal(missing.draft.takeaways[0]?.url, null);
		const fixed = build(noVideo, {youtubeId: 'ZyXwVuTs987'});
		assert.deepEqual(errorsOf(fixed.issues), []);
		assert.equal(fixed.draft.watchUrl, 'https://www.youtube.com/watch?v=ZyXwVuTs987');
	});

	it('fails an offer whose kit.json disclosure is missing', () => {
		const kit = loadKit();
		const bare = {...kit, offers: [{...kit.offers[0]!, disclosure: ''}]};
		assert.match(errorsOf(build(bare).issues).join('\n'), /has no disclosure in kit\.json/);
	});

	it('warns when the email names an offer that was left out for region reasons', () => {
		const kit = {...loadKit(), summary: 'Why Demo Exchange support will never DM you first.'};
		const warnings = build(kit).issues.filter((i) => i.level === 'warning').map((i) => i.message);
		assert.match(warnings.join('\n'), /mentions "Demo Exchange", which is left out of emails by its region rules/);
	});

	it('cuts the preview text at a word boundary', () => {
		const text = previewText('word '.repeat(60));
		assert.ok(text.length <= 140);
		assert.match(text, /word…$/);
	});
});

describe('rendering', () => {
	it('writes email-safe HTML: 600 px, inline styles only, no scripts, images or style blocks', () => {
		const {draft} = build();
		const html = renderEmailHtml(draft);
		assert.match(html, /^<!doctype html>/);
		assert.match(html, /max-width:600px/);
		assert.match(html, /<table role="presentation" width="600" align="center"/, 'fixed 600 px table for Outlook');
		assert.doesNotMatch(html, /<script|<style|<link|<img|\sclass=|\son[a-z]+=|javascript:/i);
		assert.match(html, /href="https:\/\/www\.youtube\.com\/watch\?v=AbCdEfGh123"[^>]*>Watch on YouTube</);
		assert.match(html, /Kit adds the unsubscribe link and the sender's postal address/);
		const disclosureAt = html.indexOf(WALLET_DISCLOSURE);
		const linkAt = html.indexOf(`href="${EMAIL_LINK.replace('&', '&amp;')}"`);
		assert.ok(disclosureAt > 0 && linkAt > disclosureAt && linkAt - disclosureAt < 400, 'the disclosure sits right above its link');
		assert.ok(!renderEmailContent(draft).includes('<html'), 'the Kit content is a fragment');
		assert.deepEqual(lintRendered(draft, renderMarkdown(draft), html), []);
		assert.deepEqual(errorsOf(lintFile(html, 'html', 'fixture.html')), []);
		assert.deepEqual(errorsOf(lintDraft(draft)), []);
	});

	it('writes Markdown with front matter and the disclosure right above each offer link', () => {
		const {draft} = build();
		const md = renderMarkdown(draft);
		assert.match(md, /^---\nsubject: "POV: \\"Support\\" DMs you first"\npreview: "/);
		assert.match(md, /\*\*\[Watch the episode on YouTube\]\(https:\/\/www\.youtube\.com\/watch\?v=AbCdEfGh123\)\*\*/);
		assert.match(md, /- \[00:42\]\(https:\/\/www\.youtube\.com\/watch\?v=AbCdEfGh123&t=42s\) Why real support never DMs you first/);
		assert.ok(md.includes(`### Test Hardware Wallet (affiliate link)\n\n${WALLET_DISCLOSURE}\n\n[Visit Test Hardware Wallet](${EMAIL_LINK})`));
		assert.deepEqual(errorsOf(lintFile(md, 'markdown', 'fixture.md')), []);
	});

	it('escapes kit text in both outputs, including Kit Liquid tags', () => {
		const kit = {
			...loadKit(),
			title: '<script>alert(1)</script> {{ subscriber.email_address }}',
			summary: '[Click](javascript:alert(1)) *now* & <b>bold</b> {% raw %}',
			chapters: [{start: '00:10', title: '# Heading <img src=x onerror=alert(1)>'}],
		};
		const {draft} = build(kit);
		const html = renderEmailHtml(draft);
		assert.doesNotMatch(html, /<script>alert|<b>bold|<img src=x|\{\{|\{%/);
		assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt; &#123;&#123; subscriber\.email_address &#125;&#125;/);
		const md = renderMarkdown(draft);
		assert.match(md, /^# \\<script\\>alert\(1\)\\<\/script\\> \{\{ subscriber\.email\\_address \}\}$/m);
		assert.match(md, /^\\\[Click\\\]\(javascript:alert\(1\)\) \\\*now\\\* & \\<b\\>bold\\<\/b\\>/m);
		assert.match(md, /\) \\# Heading \\<img src=x onerror=alert\(1\)\\>$/m);
	});
});

describe('checkPublishKit', () => {
	it('accepts the fixture and reports every problem in a broken kit', () => {
		assert.deepEqual(checkPublishKit(JSON.parse(readFileSync(fixture('kit.json'), 'utf8'))).errors, []);
		const {kit, errors} = checkPublishKit({
			version: 2,
			channel: 'zoora-ai',
			slug: '../etc/passwd',
			youtubeVideoId: 'short',
			title: '',
			summary: 'ok',
			chapters: [{start: '1:2', title: 'x'}],
			sources: [{title: 'Bad', url: 'javascript:alert(1)'}],
			offers: [{id: 'Bad_ID', hubUrl: 'https://go.zoora.ai/go/x', disclosure: 5}],
			disclosures: ['fine'],
			checks: [{id: 'x', ok: 'yes', detail: ''}],
		});
		assert.equal(kit, null);
		for (const expected of [
			/"version" must be 1/,
			/"slug" must be 1-64 characters/,
			/"youtubeVideoId" must be null or an 11-character YouTube video id/,
			/"title" must be a non-empty string/,
			/chapters\[0\]\.start must be a timestamp/,
			/sources\[0\]\.url must be an http\(s\) URL/,
			/offers\[0\]\.id must be an offer id/,
			/offers\[0\]\.disclosure must be a string/,
			/checks\[0\]\.ok must be true or false/,
		]) {
			assert.ok(errors.some((e) => expected.test(e)), `expected an error matching ${expected}: ${errors.join(' | ')}`);
		}
	});

	it('reports unreadable files with their path', () => {
		const {kit, errors} = readPublishKit(fixture('does-not-exist.json'));
		assert.equal(kit, null);
		assert.match(errors[0] ?? '', /cannot read .*does-not-exist\.json/);
	});
});
