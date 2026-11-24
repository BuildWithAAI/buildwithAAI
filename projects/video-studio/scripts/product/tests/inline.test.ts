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
