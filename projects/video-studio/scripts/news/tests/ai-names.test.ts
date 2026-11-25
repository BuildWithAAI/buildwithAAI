import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {describe, test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {buildIndex, validateAllowlist} from '../lib/allowlist.ts';
import {scanNames} from '../lib/names.ts';
import {runRules} from '../lib/rules.ts';

// R4 in the AI-security lane: AI products and companies are names the gate knows, never unknown personal names;
// real private individuals (researchers, employees, victims) are still refused.

const NEWS = join(fileURLToPath(import.meta.url), '..', '..');
const ALLOW = JSON.parse(readFileSync(join(NEWS, 'allowlist.json'), 'utf8'));
const idx = buildIndex(validateAllowlist(ALLOW).file!);
const persons = (t: string, short = false) => scanNames(t, {idx, briefText: t.toLowerCase(), short}).persons.map((p) => `${p.text}:${p.reason}`);

describe('R4: AI product names are not people', () => {
	const clean = [
		'According to GitGuardian, Claude Code saved secrets in a settings file.',
		'Anthropic says it fixed the issue in Claude Code and Claude Desktop.',
		'Researchers say Gemini, Copilot, ChatGPT, Grok and Llama all refused at first.',
		'Hidden instructions hijacked Claude Opus in auto mode, Embrace The Red reports.',
		'OpenRouter dropped three AI providers, BleepingComputer reports.',
		'The Gemini CLI and GitHub Copilot were patched, according to Microsoft Security.',
		'Codex and Cursor users should update, Unit 42 says.',
		'Microsoft 365 Copilot, Copilot Studio and Amazon Q Developer were affected.',
		'DeepSeek, Qwen, Mistral and Perplexity were named in the report by the AI Incident Database.',
	];
	for (const t of clean) test(t, () => assert.deepEqual(persons(t), []));
	test('in titles and thumbnails too (sentence case, as WRITER.md asks)', () => {
		assert.deepEqual(persons('Claude Code leaks secrets', true), []);
		assert.deepEqual(persons('Copilot flaw patched', true), []);
		assert.deepEqual(persons('DEVELOPING: Gemini CLI hijacked', true), []);
	});
});

describe('R4: private individuals are still refused next to AI products', () => {
	test('a person who shares a product word', () => assert.deepEqual(persons('Claude Dupont said the agent was hijacked.'), ['Claude Dupont:two-word-name']));
	test('a researcher by name', () => assert.ok(persons('Robin Sample responded on the forum about Claude Code.').includes('Robin Sample:two-word-name')));
	test('an apposition', () => assert.ok(persons('The researcher, Avery Example, found the Copilot flaw.').some((p) => p.startsWith('Avery Example'))));
	test('a lower-case handle after a role', () => assert.ok(persons('Security researcher examplehandle reported the ChatGPT bug.').some((p) => p.startsWith('examplehandle'))));
	test('the radar placeholder', () => assert.ok(persons('[named person] reported the Gemini issue.').some((p) => p.endsWith(':placeholder'))));
});

describe('R4 in a full AI storyboard', () => {
	const GOOD = join(NEWS, 'fixtures', 'zoora-security', 'good-fixtureswap-drain');
	const load = (f: string) => JSON.parse(readFileSync(join(GOOD, f), 'utf8'));
	const run = (narration: string) => {
		const sb = load('storyboard.json');
		const brief = load('brief.json');
		sb.scenes.find((s: {id: string}) => s.id === 's05').narration = narration;
		const out = runRules({storyboard: sb, brief, corrections: null, allowlist: ALLOW, slug: sb.slug});
		return out.findings.filter((f) => f.rule === 'R4' && f.severity === 'error').map((f) => f.code);
	};
	test('product names pass, a named individual fails', () => {
		assert.deepEqual(run('Zoo checks whether Claude Code, Copilot and ChatGPT keep secrets out of shared files.'), []);
		assert.ok(run('Zoo checks whether Robin Sample keeps secrets out of shared files.').length > 0);
	});
});
