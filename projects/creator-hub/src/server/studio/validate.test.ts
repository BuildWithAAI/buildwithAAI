import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {loadStudioConfig} from './config.ts';
import {blankOrderForm, deadlineProblem, isEmail, normalizeProjectUrl, readOrderForm, validateOrderForm} from './validate.ts';

const config = loadStudioConfig(
	JSON.parse(readFileSync(new URL('../../../config/studio.example.json', import.meta.url), 'utf8')) as unknown,
);
const NOW = Date.UTC(2026, 10, 24, 12); // 2026-11-24T12:00:00Z

const VALID: Record<string, string> = {
	name: 'Ada Lovelace',
	email: 'ada@Example.COM',
	company: 'Analytical Engines',
	project_url: 'example.com/app',
	package: 'explainer-60-90',
	budget: '$1,000 to $2,500',
	deadline: '2027-01-15',
	message: 'We need a 60 second explainer for our wallet security checklist.',
	consent: 'yes',
};

const form = (overrides: Record<string, string | null> = {}): URLSearchParams => {
	const params = new URLSearchParams();
	for (const [key, value] of Object.entries({...VALID, ...overrides})) if (value !== null) params.set(key, value);
	return params;
};

const errorsFor = (overrides: Record<string, string | null>): Record<string, string | undefined> => {
	const result = validateOrderForm(form(overrides), config, NOW);
	assert.equal(result.ok, false, 'expected a validation failure');
	return result.ok ? {} : result.errors;
};

test('a complete request passes and is normalized', () => {
	const result = validateOrderForm(form({name: '  Ada \n  Lovelace ', message: 'Line one\r\nLine two is long enough'}), config, NOW);
	assert.ok(result.ok);
	assert.deepEqual(result.order, {
		name: 'Ada Lovelace',
		email: 'ada@example.com',
		company: 'Analytical Engines',
		projectUrl: 'https://example.com/app',
		packageId: 'explainer-60-90',
		budget: '$1,000 to $2,500',
		deadline: '2027-01-15',
		message: 'Line one\nLine two is long enough',
		consent: true,
	});
});

test('optional fields may be empty and become null; "custom" is a valid package', () => {
	const result = validateOrderForm(
		form({company: '', project_url: '', budget: '', deadline: '', package: 'custom'}),
		config,
		NOW,
	);
	assert.ok(result.ok);
	assert.equal(result.order.company, null);
	assert.equal(result.order.projectUrl, null);
	assert.equal(result.order.budget, null);
	assert.equal(result.order.deadline, null);
	assert.equal(result.order.packageId, 'custom');
});

test('an empty post reports every required field and nothing else', () => {
	const result = validateOrderForm(new URLSearchParams(), config, NOW);
	assert.equal(result.ok, false);
	if (!result.ok) assert.deepEqual(Object.keys(result.errors).sort(), ['consent', 'email', 'message', 'name', 'packageId']);
});

test('field rules', () => {
	assert.match(errorsFor({name: 'x'.repeat(101)}).name ?? '', /100 characters or fewer/);
	assert.match(errorsFor({name: 'Visit www.spam.example'}).name ?? '', /without a web address/);
	assert.match(errorsFor({name: 'Ada‮ecalevol'}).name ?? '', /cannot accept/);
	assert.match(errorsFor({email: 'not-an-email'}).email ?? '', /right format/);
	assert.match(errorsFor({company: 'c'.repeat(121)}).company ?? '', /120 characters/);
	assert.match(errorsFor({project_url: 'javascript:alert(1)'}).projectUrl ?? '', /web address/);
	assert.match(errorsFor({package: 'premium-gold'}).packageId ?? '', /from the list/);
	assert.match(errorsFor({budget: '$1'}).budget ?? '', /from the list/);
	assert.match(errorsFor({message: 'too short'}).message ?? '', /at least 10 characters/);
	assert.match(errorsFor({message: 'm'.repeat(5001)}).message ?? '', /5,000 characters or fewer/);
	assert.match(errorsFor({message: 'A bell character \u0007 here'}).message ?? '', /cannot accept/);
	assert.match(errorsFor({consent: 'no'}).consent ?? '', /Tick the box/);
	assert.match(errorsFor({consent: null}).consent ?? '', /Tick the box/);
});

test('tabs and newlines are fine in the message', () => {
	assert.ok(validateOrderForm(form({message: 'Columns:\tA\tB\nSecond line here'}), config, NOW).ok);
});

test('isEmail accepts real-world addresses and rejects malformed ones', () => {
	for (const ok of ['a@b.co', 'first.last+tag@sub.example.org', "o'neil@example.ie", 'josé@exämple.de', 'x@xn--bcher-kva.example']) {
		assert.equal(isEmail(ok), true, ok);
	}
	for (const bad of ['', 'plain', '@example.com', 'a@', 'a@b', 'a b@example.com', 'a@example..com', '.a@example.com', 'a.@example.com', 'a@-example.com', 'a@1.2.3.4', `${'l'.repeat(65)}@example.com`, 'a<b>@example.com', 'a@example.com>']) {
		assert.equal(isEmail(bad), false, bad);
	}
});

test('normalizeProjectUrl adds https and only allows http(s) links without credentials', () => {
	assert.equal(normalizeProjectUrl('example.com'), 'https://example.com/');
	assert.equal(normalizeProjectUrl('example.com:8080/docs?a=1'), 'https://example.com:8080/docs?a=1');
	assert.equal(normalizeProjectUrl('http://example.com/x'), 'http://example.com/x');
	assert.equal(normalizeProjectUrl('HTTPS://Example.com'), 'https://example.com/');
	for (const bad of ['javascript:alert(1)', 'data:text/html,<b>x</b>', 'ftp://example.com', 'https://user:pw@example.com', 'localhost', 'mailto:a@example.com', 'https://', 'not a url']) {
		assert.equal(normalizeProjectUrl(bad), null, bad);
	}
});

test('deadline must be a real date between yesterday (time zones) and three years out', () => {
	assert.equal(deadlineProblem('2026-11-24', NOW), null);
	assert.equal(deadlineProblem('2026-11-23', NOW), null);
	assert.equal(deadlineProblem('2029-11-24', NOW), null);
	assert.match(deadlineProblem('2026-11-22', NOW) ?? '', /today or later/);
	assert.match(deadlineProblem('2030-06-01', NOW) ?? '', /within the next 3 years/);
	assert.match(deadlineProblem('2027-02-30', NOW) ?? '', /real date/);
	assert.match(deadlineProblem('15/01/2027', NOW) ?? '', /format YYYY-MM-DD/);
});

test('readOrderForm bounds oversized fields; blankOrderForm preselects only real packages', () => {
	const values = readOrderForm(new URLSearchParams({name: 'n'.repeat(50_000), message: 'm'.repeat(50_000)}));
	assert.equal(values.name.length, 1000);
	assert.equal(values.message.length, 20_000);
	assert.equal(blankOrderForm(config, 'shorts-pack-3').packageId, 'shorts-pack-3');
	assert.equal(blankOrderForm(config, 'custom').packageId, 'custom');
	assert.equal(blankOrderForm(config, '"><script>').packageId, '');
});
