import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {describe, it} from 'node:test';
import {type Action, classify, classifyAll, type CommentInput, findBursts, HOLD_AT, type Identity, REVIEW_AT} from './classifier.ts';
import {RULES} from './rules.ts';

type Fixture = {id: string; label: 'scam' | 'legit'; kind: string; round: number; author: string; authorChannelId: string; text: string};
const data = JSON.parse(readFileSync(new URL('./fixtures/comments.json', import.meta.url), 'utf8')) as {
	identity: Identity;
	comments: Fixture[];
};
const identity = data.identity;
const fixtures = data.comments;
const inputs: CommentInput[] = fixtures.map((f) => ({id: f.id, text: f.text, authorName: f.author, authorChannelId: f.authorChannelId}));
const verdicts = classifyAll(inputs, identity);

const ACTIONS: Action[] = ['hold', 'review', 'allow'];
const matrix = {scam: {hold: 0, review: 0, allow: 0}, legit: {hold: 0, review: 0, allow: 0}};
fixtures.forEach((f, i) => matrix[f.label][verdicts[i].action]++);
const scams = fixtures.filter((f) => f.label === 'scam').length;
const legits = fixtures.length - scams;
const recall = (matrix.scam.hold + matrix.scam.review) / scams;
const holdRecall = matrix.scam.hold / scams;
const falsePositiveRate = (matrix.legit.hold + matrix.legit.review) / legits;

const describeMiss = (i: number): string => {
	const v = verdicts[i];
	const reasons = v.reasons.map((r) => `${r.rule}(${r.weight})`).join(' ');
	return `  ${fixtures[i].id} [${fixtures[i].kind}] -> ${v.action} score ${v.score}: ${reasons}\n    ${fixtures[i].text}`;
};

describe('classifier on the labelled fixtures', () => {
	it('prints the confusion matrix', () => {
		const pad = (s: string | number, n = 8) => String(s).padStart(n);
		const lines = [
			`Comment guard confusion matrix (${fixtures.length} synthetic comments; hold at ${HOLD_AT}, review at ${REVIEW_AT})`,
			`${pad('label', 10)}${ACTIONS.map((a) => pad(a)).join('')}${pad('total')}`,
			...(['scam', 'legit'] as const).map(
				(label) => `${pad(label, 10)}${ACTIONS.map((a) => pad(matrix[label][a])).join('')}${pad(label === 'scam' ? scams : legits)}`,
			),
			`recall (hold or review) ${recall.toFixed(3)} | hold-only recall ${holdRecall.toFixed(3)} | false-positive rate (legit held or flagged) ${falsePositiveRate.toFixed(3)}`,
			...[0, 1, 2, 3].map((round) => {
				const rows = fixtures.map((f, i) => ({f, v: verdicts[i]})).filter(({f}) => f.round === round);
				const count = (label: string, ok: (a: Action) => boolean) => rows.filter(({f, v}) => f.label === label && ok(v.action)).length;
				return `  round ${round}: scams flagged ${count('scam', (a) => a !== 'allow')}/${count('scam', () => true)} (held ${count('scam', (a) => a === 'hold')}), legit flagged ${count('legit', (a) => a !== 'allow')}/${count('legit', () => true)}`;
			}),
		];
		const misses = fixtures.flatMap((f, i) =>
			(f.label === 'scam' && verdicts[i].action === 'allow') || (f.label === 'legit' && verdicts[i].action !== 'allow') ? [describeMiss(i)] : [],
		);
		if (misses.length) lines.push('Misclassified:', ...misses);
		console.log(lines.join('\n'));
		assert.equal(fixtures.length >= 80, true);
	});

	it('has at least 80 comments with both labels and the required hard negatives', () => {
		assert.ok(fixtures.length >= 80);
		assert.ok(scams >= 30 && legits >= 30);
		for (const kind of ['telegram-question', 'wallet-security', 'warning-quoting-scam', 'non-english-es', 'non-english-ru', 'non-english-hi']) {
			assert.ok(fixtures.some((f) => f.label === 'legit' && f.kind === kind), `missing hard negative kind ${kind}`);
		}
	});

	it('catches at least 95% of scams (held or flagged for review)', () => {
		assert.ok(recall >= 0.95, `recall ${recall.toFixed(3)} is below 0.95`);
	});

	it('flags at most 2% of legitimate comments, and never holds one', () => {
		assert.ok(falsePositiveRate <= 0.02, `false-positive rate ${falsePositiveRate.toFixed(3)} is above 0.02`);
		assert.equal(matrix.legit.hold, 0, 'a legitimate comment would be held');
	});

	it('holds most scams outright, so "guard apply" is useful', () => {
		assert.ok(holdRecall >= 0.85, `hold-only recall ${holdRecall.toFixed(3)} is below 0.85`);
	});

	it('explains every non-allow verdict with at least one positive reason', () => {
		verdicts.forEach((v, i) => {
			if (v.action === 'allow') return;
			assert.ok(v.reasons.some((r) => r.weight > 0 && r.explanation && r.evidence), fixtures[i].id);
			assert.equal(v.score, Math.max(0, v.reasons.reduce((sum, r) => sum + r.weight, 0)));
		});
	});
});

describe('rules', () => {
	const scam = (text: string, authorName = '@someone', authorChannelId = 'UCsomeoneelse000000000001') =>
		classify({id: 'x', text, authorName, authorChannelId}, identity);

	it('every rule has an id, a weight and an explanation, and ids are unique', () => {
		const ids = new Set<string>();
		for (const rule of RULES) {
			assert.match(rule.id, /^[a-z]+(?:-[a-z]+)*$/);
			assert.ok(Number.isInteger(rule.weight) && rule.weight !== 0, rule.id);
			assert.ok(rule.explanation.length > 20, rule.id);
			assert.ok(!ids.has(rule.id), rule.id);
			ids.add(rule.id);
		}
	});

	it('finds phone numbers in disguise', () => {
		for (const text of [
			'call +1 (213) 555-0147',
			'number: 2 1 3 5 5 5 0 1 4 7 0',
			'＋１ ２１３ ５５５ ０１４７ now',
			'𝟐𝟏𝟑 𝟓𝟓𝟓 𝟎𝟏𝟒𝟕 𝟎𝟎',
			'reach +١ ٢١٣ ٥٥٥ ٠١٤٧',
			'number +९१ ९८७६५ ४३२१०',
			'1️⃣2️⃣1️⃣3️⃣5️⃣5️⃣5️⃣0️⃣1️⃣4️⃣7️⃣',
			'+1 213 555 O147',
			'+44 7700 900 123',
		]) {
			assert.ok(scam(text).reasons.some((r) => r.rule === 'phone-number'), text);
		}
	});

	it('does not mistake numbers for phone numbers', () => {
		for (const text of [
			'bought at 0.00001234 and sold at 0.0005',
			'supply 1000000000000 tokens',
			'since 2017, 2018 and 2021',
			'event on 24.11.2026 15.30',
			'2026-11-24 10:30 UTC',
			'timestamps 1:15 3:40 6:02',
			'I hold 1,250,000 BONK',
		]) {
			assert.ok(!scam(text).reasons.some((r) => r.rule === 'phone-number'), text);
		}
	});

	it('detects impersonation by look-alike names only when the channel id is not ours', () => {
		const impostors = ['Zoora AI Official', '@Z0ora_AI-Support', 'ZOORA AI TEAM', '@ZooraTechnoIogies', 'Zooora AI', '@zoora_ai_helpdesk'];
		for (const name of impostors) {
			const v = scam('Thanks for watching', name);
			assert.ok(v.reasons.some((r) => r.rule.startsWith('impersonation')), name);
		}
		const own = classify({id: 'o', text: 'Thanks for watching', authorName: 'Zoora AI', authorChannelId: identity.channelIds[0]}, identity);
		assert.equal(own.action, 'allow');
		assert.equal(own.reasons[0].rule, 'own-channel');
		for (const name of ['Zora', 'Zoo Fan Club', 'Zora Collective', '@AI_daily', 'Badger Lover']) {
			assert.ok(!scam('Thanks for watching', name).reasons.some((r) => r.rule.startsWith('impersonation')), name);
		}
	});

	it('holds seed-phrase requests but not seed-phrase advice', () => {
		assert.equal(scam('Send your recovery phrase to support to unlock the wallet').action, 'hold');
		assert.equal(scam('Please DM me your 24 words so I can fix it').action, 'hold');
		for (const text of [
			'Never share your seed phrase with anyone.',
			"Don't ever send your recovery phrase to 'support'.",
			'Share your seed phrase with no one, ever.',
			'Is it safe to share the seed phrase with my wife?',
			'What happens if you share your seed phrase by accident?',
		]) {
			assert.equal(scam(text).action, 'allow', text);
		}
	});

	it('still counts "don\'t hesitate to contact her" as a request', () => {
		const v = scam("Don't hesitate to contact her on WhatsApp +1 213 555 0147");
		assert.ok(v.reasons.some((r) => r.rule === 'contact-them'));
		assert.equal(v.action, 'hold');
	});

	it('ignores scam text quoted inside a warning, and counts quoted text half otherwise', () => {
		const warned = scam("Report anyone who writes 'text me on WhatsApp +1 213 555 0147', it's a scam.");
		assert.equal(warned.action, 'allow');
		const quoted = scam('"text me on WhatsApp +1 213 555 0147"');
		const phone = quoted.reasons.find((r) => r.rule === 'phone-number');
		assert.equal(phone?.weight, 2);
	});

	it("ignores the channel's own handles", () => {
		const v = scam('Is @ZooraExampleBot on Telegram the official bot?');
		assert.ok(!v.reasons.some((r) => r.rule === 'messaging-handle'));
		assert.equal(v.action, 'allow');
	});
});

describe('robustness', () => {
	it('stays fast on hostile input (no catastrophic regex backtracking)', () => {
		const hostile = ['a '.repeat(5000), '9'.repeat(10000), '1 '.repeat(5000), "'a".repeat(5000), '"'.repeat(10000), 'w h a t s '.repeat(1000), '+1 '.repeat(3000), 'mrs '.repeat(2500)];
		for (const text of hostile) {
			const started = performance.now();
			classifyAll([{id: 'h', text, authorName: text.slice(0, 200), authorChannelId: 'UChostile'}], identity);
			assert.ok(performance.now() - started < 500, `slow on ${JSON.stringify(text.slice(0, 20))}`);
		}
	});

	it('scores 2,000 comments in well under ten seconds', () => {
		const many = Array.from({length: 2000}, (_, i) => ({id: String(i), text: `Comment ${i}: great video about wallets and the Telegram bot ${i % 40}`, authorName: `@user${i}`, authorChannelId: `UC${i}`}));
		const started = performance.now();
		classifyAll(many, identity);
		assert.ok(performance.now() - started < 10_000);
	});
});

describe('copy-paste bursts', () => {
	const make = (id: string, text: string, author: string): CommentInput => ({id, text, authorName: author, authorChannelId: `UC${author}`});
	const long = 'Everyone should check out the signals group my friend runs, it changed everything for me this year';

	it('flags near-identical text from three or more accounts', () => {
		const comments = [make('a', long, 'a'), make('b', `${long}!!`, 'b'), make('c', `${long} 🙏`, 'c'), make('d', 'Nice one', 'd')];
		const bursts = findBursts(comments);
		assert.deepEqual([...bursts.keys()].sort(), [0, 1, 2]);
		const verdicts = classifyAll(comments, identity);
		assert.ok(verdicts[0].reasons.some((r) => r.rule === 'copy-paste-burst' && r.evidence.includes('3 accounts')));
		assert.ok(!verdicts[3].reasons.some((r) => r.rule === 'copy-paste-burst'));
	});

	it('does not count one account repeating itself, or short generic praise', () => {
		assert.equal(findBursts([make('a', long, 'a'), make('b', long, 'a'), make('c', long, 'a')]).size, 0);
		const praise = ['x', 'y', 'z', 'w'].map((a) => make(a, 'Great video, thanks Zoo!', a));
		assert.equal(findBursts(praise).size, 0);
	});
});
