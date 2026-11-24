/** Lint tests: income-claim words, disclosures next to links, placeholders, links and unsafe HTML. */
import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import type {NewsletterDraft} from './draft.ts';
import {checkText, htmlToText, lintDraft, lintFile, lintRendered} from './lint.ts';
import {renderEmailHtml, renderMarkdown} from './render.ts';

const LINK = 'https://go.zoora.ai/go/hardware-wallet?v=ep1&s=email';
const DISCLOSURE = 'Affiliate link: I may earn a commission if you buy.';

const draft = (overrides: Partial<NewsletterDraft> = {}): NewsletterDraft => ({
	slug: 'ep1',
	brandName: 'Zoora AI',
	subject: 'Real support never DMs you first',
	previewText: 'How the fake support trick works.',
	title: 'Real support never DMs you first',
	summary: 'How the fake support trick works, and the habit that stops it.',
	watchUrl: 'https://www.youtube.com/watch?v=AbCdEfGh123',
	takeaways: [{time: '00:42', text: 'Why support never DMs first', url: 'https://www.youtube.com/watch?v=AbCdEfGh123&t=42s'}],
	sources: [{title: 'FTC: Report fraud', url: 'https://reportfraud.ftc.gov/'}],
	offers: [{id: 'hardware-wallet', name: 'Hardware Wallet', label: 'Affiliate link', url: LINK, disclosure: [DISCLOSURE]}],
	leftOut: [],
	episodeDisclosures: [],
	safetyLine: 'Zoora AI will never DM you first or ask for your seed phrase.',
	footer: ['Educational content, not financial advice.', "You're getting this email because you subscribed."],
	disclosuresUrl: 'https://go.zoora.ai/disclosures',
	generatedAt: '2026-11-24T12:00:00.000Z',
	...overrides,
});

const errors = (issues: {level: string; message: string}[]): string[] => issues.filter((i) => i.level === 'error').map((i) => i.message);
const warnings = (issues: {level: string; message: string}[]): string[] => issues.filter((i) => i.level === 'warning').map((i) => i.message);

describe('income-claim words', () => {
	const claims = [
		'Guaranteed returns every week',
		'A guarantee you will love it',
		'This is risk-free',
		'a risk free trade',
		'There is no risk at all',
		'How to get rich with memecoins',
		'a get-rich-quick plan',
		'Earn passive income while you sleep',
		'The next 100x coin',
		'it went 1,000x',
		'easy 10X',
		'a x100 gem',
		'Double your money',
		'Reach financial freedom',
		'make money fast',
		'Quit your job',
		'This coin is going to the moon',
		'price target of $5',
		'going to $10 soon',
		'life-changing gains',
		'a sure thing',
	];
	for (const text of claims) {
		it(`fails: "${text}"`, () => {
			const found = errors(checkText(text, 'summary'));
			assert.equal(found.length, 1, `expected one error for "${text}", got ${JSON.stringify(found)}`);
			assert.match(found[0] ?? '', /income or return claim/);
		});
	}

	it('fails even when the claim is quoted from a scam', () => {
		assert.equal(errors(checkText('The bot promised "guaranteed 100x" profits.', 'summary')).length, 2);
	});

	for (const text of [
		'A 1920x1080 video',
		'Never send funds to 0x1234abcdef1234abcdef',
		'24 x 7 support is a red flag',
		'The new app is 2x faster',
		'Real support never DMs you first',
		'Write your seed phrase on paper and keep it offline',
	]) {
		it(`passes: "${text}"`, () => assert.deepEqual(errors(checkText(text, 'summary')), []));
	}

	it('only warns on softer money words', () => {
		const issues = checkText('Scammers promise returns and profit, so they say act now. Do not invest in a hurry.', 'summary');
		assert.deepEqual(errors(issues), []);
		assert.deepEqual(
			warnings(issues).map((w) => w.split(':')[0]),
			['investment wording', 'returns or profit wording', 'urgency'],
		);
	});

	it('fails on placeholders', () => {
		for (const text of ['TODO write the intro', 'link: REPLACE', 'Lorem ipsum dolor', 'See [INSERT LINK] here']) {
			assert.equal(errors(checkText(text, 'summary')).length, 1, text);
		}
		assert.deepEqual(errors(checkText('Replace your password today', 'summary')), [], 'ordinary "replace" is fine');
	});
});

describe('lintDraft', () => {
	it('passes a clean draft', () => assert.deepEqual(errors(lintDraft(draft())), []));

	it('names the field that holds a claim', () => {
		const issues = lintDraft(draft({takeaways: [{time: '01:00', text: 'Passive income secrets', url: null}]}));
		assert.equal(issues.find((i) => i.level === 'error')?.where, 'chapters (takeaway 1)');
	});

	it('fails an offer with no disclosure, or with one that does not say what the relationship is', () => {
		const none = draft({offers: [{...draft().offers[0]!, disclosure: []}]});
		assert.match(errors(lintDraft(none)).join('\n'), /has no disclosure/);
		const blank = draft({offers: [{...draft().offers[0]!, disclosure: ['  ']}]});
		assert.match(errors(lintDraft(blank)).join('\n'), /has no disclosure/);
		const vague = draft({offers: [{...draft().offers[0]!, disclosure: ['Check this out.']}]});
		assert.match(errors(lintDraft(vague)).join('\n'), /does not say what the relationship is/);
	});

	it('fails offer links that are not hub links tagged v=<slug>&s=email', () => {
		for (const url of [
			'https://go.zoora.ai/go/hardware-wallet?v=ep1&s=yt',
			'https://go.zoora.ai/go/hardware-wallet?v=other&s=email',
			'https://go.zoora.ai/go/hardware-wallet?v=ep1&s=email&utm=x',
			'https://wallet.example/buy?ref=abc',
			'http://go.zoora.ai/go/hardware-wallet?v=ep1&s=email',
		]) {
			const issues = lintDraft(draft({offers: [{...draft().offers[0]!, url}]}));
			assert.match(errors(issues).join('\n'), /the link must be https:\/\/<hub>\/go\/hardware-wallet\?v=ep1&s=email/, url);
		}
	});

	it('fails placeholder hosts and warns on plain http sources', () => {
		const issues = lintDraft(draft({sources: [{title: 'Example', url: 'https://example.com/a'}, {title: 'Old site', url: 'http://old.site.org/'}]}));
		assert.match(errors(issues).join('\n'), /placeholder or private host: example\.com/);
		assert.match(warnings(issues).join('\n'), /plain http link/);
	});

	it('warns about long subjects', () => {
		assert.match(warnings(lintDraft(draft({subject: 'x'.repeat(80)}))).join('\n'), /80 characters/);
	});
});

describe('lintRendered', () => {
	it('passes the rendered draft', () => {
		const d = draft();
		assert.deepEqual(lintRendered(d, renderMarkdown(d), renderEmailHtml(d)), []);
	});

	it('fails when an offer link loses its disclosure or goes missing', () => {
		const d = draft();
		const md = renderMarkdown(d).replace(DISCLOSURE, '');
		const html = renderEmailHtml(d).replace(/href="https:\/\/go\.zoora\.ai\/go\/hardware-wallet[^"]*"/, 'href="https://go.zoora.ai/"');
		const found = errors(lintRendered(d, md, html));
		assert.ok(found.includes('a link for offer "hardware-wallet" does not have its disclosure right above it'));
		assert.ok(found.includes('the link for offer "hardware-wallet" is missing'));
	});

	it('fails unsafe HTML', () => {
		const d = draft();
		const html = renderEmailHtml(d).replace('</body>', '<script>alert(1)</script><a href="javascript:x" onclick="y">z</a></body>');
		assert.equal(errors(lintRendered(d, renderMarkdown(d), html)).length, 3);
	});
});

describe('lintFile (hand-edited drafts)', () => {
	it('needs a disclosure before every hub link, not just the first', () => {
		const ok = `${DISCLOSURE}\n\n[Visit](${LINK})\n`;
		assert.deepEqual(errors(lintFile(ok, 'markdown', 'a.md')), []);
		const second = `${ok}\n### Another tool\n\n[Visit another](https://go.zoora.ai/go/other-tool?v=ep1&s=email)\n`;
		assert.match(errors(lintFile(second, 'markdown', 'a.md')).join('\n'), /other-tool\?v=ep1&s=email has no disclosure/);
	});

	it('warns about hub links that are not tagged for this email', () => {
		const md = `${DISCLOSURE}\n\n[Visit](https://go.zoora.ai/go/hardware-wallet?s=yt)\n`;
		assert.match(warnings(lintFile(md, 'markdown', 'a.md')).join('\n'), /not tagged \?v=<episode>&s=email/);
	});

	it('reads claims in HTML text, including encoded entities and the hidden preview line', () => {
		const html = '<div style="display:none">Risk&#45;free</div><p>Get &amp; stay rich: guaran&#116;eed</p>';
		assert.equal(htmlToText(html).trim(), 'Risk-free Get & stay rich: guaranteed');
		assert.equal(errors(lintFile(html, 'html', 'a.html')).length, 2);
	});

	it('fails unsafe HTML in an edited file', () => {
		assert.match(errors(lintFile('<p onmouseover="x()">Hi</p>', 'html', 'a.html')).join('\n'), /inline event handler/);
	});
});
