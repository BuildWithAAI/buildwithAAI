import assert from 'node:assert/strict';
import {test} from 'node:test';
import {citationsOf, escapeHtml, inline, InlineError, keepTogether, linksOf, parseInline, plainText, smartQuotes} from '../lib/inline.ts';

const ctx = {cite: (ids: string[]) => `[${ids.join(',')}]`};

test('parses strong, emphasis, code, links, citations and escapes', () => {
	const n = parseInline('**Bold.** *it* `x<y` [link](https://a.test/p?q=1) [@one; @two-b] \\*literal\\*');
	assert.deepEqual(
		n.map((x) => x.t),
		['strong', 'text', 'em', 'text', 'code', 'text', 'link', 'text', 'cite', 'text'],
	);
	assert.deepEqual(citationsOf(n), ['one', 'two-b']);
	assert.deepEqual(linksOf(n), ['https://a.test/p?q=1']);
	assert.equal(plainText(n), 'Bold. it x<y link  *literal*');
});

test('rejects malformed markup', () => {
	assert.throws(() => parseInline('**open'), InlineError);
	assert.throws(() => parseInline('`open'), InlineError);
	assert.throws(() => parseInline('[@BAD_ID]'), InlineError);
	assert.throws(() => parseInline('[@]'), InlineError);
	assert.throws(() => parseInline('[@a; b]'), InlineError);
});

test('escapes HTML everywhere, including link targets and code', () => {
	const html = inline('<script>alert(1)</script> [x](https://a.test/"onmouseover=") `<b>`', ctx);
	assert.ok(!html.includes('<script>'));
	assert.ok(html.includes('&lt;script&gt;'));
	assert.ok(html.includes('href="https://a.test/&quot;onmouseover=&quot;"'));
	assert.ok(html.includes('<code>&lt;b&gt;</code>'));
	assert.equal(escapeHtml(`'"&<>`), '&#39;&quot;&amp;&lt;&gt;');
});

test('smart quotes and ellipses', () => {
	assert.equal(smartQuotes('"Hello," she said. It\'s fine...'), '“Hello,” she said. It’s fine…');
	assert.equal(smartQuotes("'quoted'"), '‘quoted’');
	assert.equal(smartQuotes('end"', 'x'), 'end”');
	// quotes carry across inline nodes
	assert.equal(inline('"**bold**"', ctx), '“<strong>bold</strong>”');
});

test('keeps numbers with units and the show name together', () => {
	const nb = ' ';
	assert.equal(keepTogether('$68 million in Chapter 3'), `$68${nb}million in Chapter${nb}3`);
	assert.equal(keepTogether('Zoo &amp; Badger'), '<span class="nowrap">Zoo &amp; Badger</span>');
});

test('a citation sticks to the word before it', () => {
	assert.equal(inline('Fact. [@a]', ctx), 'Fact. [a]');
});

test('cross-references: [#id] parses to an xref, renders through the context, and is no plain text', () => {
	const n = parseInline('Revoke it ([#approvals]), then [@one] [#seed-phrases]');
	assert.deepEqual(
		n.filter((x) => x.t === 'xref').map((x) => (x as {id: string}).id),
		['approvals', 'seed-phrases'],
	);
	assert.equal(plainText(n), 'Revoke it (), then  ');
	const html = inline('See [#approvals].', {...ctx, xref: (id) => `<a href="#${id}">Chapter 3, p. 8</a>`});
	assert.equal(html, 'See <a href="#approvals">Chapter 3, p. 8</a>.');
	// without a section to point at (the marketing copy, the free edition) a cross-reference is an error
	assert.throws(() => inline('See [#approvals].', ctx), /not available here/);
	assert.throws(() => parseInline('[#Bad Id]'), InlineError);
	assert.throws(() => parseInline('[#open'), InlineError);
});

test('phone numbers stay on one line; years and counts are untouched', () => {
	assert.equal(keepTogether('Call 0300 123 2040 today'), 'Call <span class="nowrap">0300 123 2040</span> today');
	assert.equal(keepTogether('or 1-888-495-8501.'), 'or <span class="nowrap">1-888-495-8501</span>.');
	assert.equal(keepTogether('In 2024 an employee'), 'In 2024 an employee');
	assert.equal(keepTogether('22,364 complaints in 2025'), '22,364 complaints in 2025');
	assert.equal(keepTogether('Call 101'), 'Call 101');
});
