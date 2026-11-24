import assert from 'node:assert/strict';
import {test} from 'node:test';
import {escapeHtml, html, raw, SafeHtml} from './html.ts';

test('escapeHtml escapes the five HTML-significant characters', () => {
	assert.equal(
		escapeHtml(`<a href="x" onclick='y'>&</a>`),
		'&lt;a href=&quot;x&quot; onclick=&#39;y&#39;&gt;&amp;&lt;/a&gt;',
	);
	assert.equal(escapeHtml('plain text, 100% safe'), 'plain text, 100% safe');
});

test('html`` escapes interpolated values, so attribute and tag breakouts stay inert', () => {
	const attack = `"><script>alert(1)</script><a href='javascript:x'>`;
	assert.equal(
		html`<input value="${attack}">`.html,
		'<input value="&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;&lt;a href=&#39;javascript:x&#39;&gt;">',
	);
});

test('html`` keeps nested SafeHtml, joins arrays, and renders null, undefined and false as nothing', () => {
	const items = ['<b>', 'ok'].map((t) => html`<li>${t}</li>`);
	assert.equal(html`<ul>${items}</ul>${null}${undefined}${false}${0}`.html, '<ul><li>&lt;b&gt;</li><li>ok</li></ul>0');
});

test('raw() passes trusted markup through unchanged', () => {
	assert.ok(raw('<br>') instanceof SafeHtml);
	assert.equal(html`a${raw('<br>')}b`.html, 'a<br>b');
	assert.equal(String(raw('<hr>')), '<hr>');
});
