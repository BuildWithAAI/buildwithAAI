import assert from 'node:assert/strict';
import {mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {after, describe, it} from 'node:test';
import {checkRegistry, hubBase, hubLink, hubPage, isLive, isRestricted, loadRegistry, offerDisclosure, resolveOffers, RISK_LINE} from './offers.ts';
import {PROJECT, testRegistry} from './test-helpers.ts';
import type {Offer} from './types.ts';
import {InputError} from './util.ts';

const offer = (over: Partial<Offer> = {}): Offer => ({
	id: 'wallet',
	name: 'Wallet',
	url: 'https://shop.wallet.test/?aff=1',
	category: 'security',
	relationship: 'affiliate',
	disclosure: 'Affiliate link: I may earn a commission.',
	blockedCountries: [],
	unknownCountry: 'allow',
	active: true,
	...over,
});

describe('checkRegistry', () => {
	it('accepts a valid registry', () => {
		const {registry, errors} = checkRegistry({version: 1, offers: [offer()]});
		assert.deepEqual(errors, []);
		assert.equal(registry.offers.length, 1);
	});
	it('rejects memecoin launchpads, bad fields and duplicates', () => {
		const {errors} = checkRegistry({
			version: 1,
			offers: [offer({id: 'pad', url: 'https://www.pump.fun/x'}), offer({id: 'Bad Id'}), offer({disclosure: ''}), offer(), offer(), offer({id: 'uk', blockedCountries: ['UK' as string, 'gb']})],
		});
		const all = errors.join('\n');
		assert.match(all, /"pad": memecoin launchpads are never offers/);
		assert.match(all, /"id" must be 2-40 characters/);
		assert.match(all, /"disclosure" must be a non-empty string/);
		assert.match(all, /duplicate id/);
		assert.match(all, /"uk": "blockedCountries" must be a list of ISO country codes/);
		assert.deepEqual(checkRegistry({offers: []}).errors, ['expected {"version": 1, "offers": [...]}']);
	});
	it('refuses a disclosure that discloses nothing, and claims in published offer text (review 2026-11-24)', () => {
		const {errors} = checkRegistry({
			version: 1,
			offers: [
				offer({id: 'weak', disclosure: 'Great wallet, I use it every day. Get 20% off today only!'}),
				offer({id: 'own', relationship: 'own-product', category: 'own-product', disclosure: 'Affiliate link: I may earn a commission.'}),
				offer({id: 'hype', name: 'Wallet that will hit $1,000', restrictedReason: 'Not available here, but you cannot lose.'}),
			],
		});
		const all = errors.join('\n');
		assert.match(all, /"weak": "disclosure" does not disclose: it must name the relationship/);
		assert.match(all, /"own": "disclosure" does not disclose: it must say it is your own product/);
		assert.match(all, /"hype": "name" contains a price prediction/);
		assert.match(all, /"hype": "restrictedReason" contains a no-lose promise/);
	});
	it('the shared example registry and the test registry pass the wording rules', () => {
		assert.deepEqual(checkRegistry(JSON.parse(readFileSync(join(PROJECT, '../creator-hub/config/offers.example.json'), 'utf8'))).errors, []);
		assert.deepEqual(checkRegistry(testRegistry()).errors, []);
	});
});

describe('offer rules', () => {
	it('isLive: inactive offers and a date-only expiry that has passed (end of that UTC day)', () => {
		assert.equal(isLive(offer({active: false}), new Date('2026-11-24T00:00:00Z')), false);
		assert.equal(isLive(offer({expires: '2026-11-24'}), new Date('2026-11-24T23:59:59Z')), true);
		assert.equal(isLive(offer({expires: '2026-11-24'}), new Date('2026-11-25T00:00:00Z')), false);
	});
	it('isRestricted: blocked or allow-listed countries, or unknown countries blocked', () => {
		assert.equal(isRestricted(offer()), false);
		assert.equal(isRestricted(offer({blockedCountries: ['GB'], unknownCountry: 'block'})), true);
		assert.equal(isRestricted(offer({allowedCountries: ['DE']})), true);
		assert.equal(isRestricted(offer({unknownCountry: 'block'})), true);
	});
	it('adds the risk line to exchange disclosures that lack one', () => {
		assert.equal(offerDisclosure(offer({category: 'exchange', disclosure: 'Referral link: I earn fees.'})), `Referral link: I earn fees. ${RISK_LINE}`);
		assert.equal(offerDisclosure(offer({category: 'exchange', disclosure: 'Referral link. Crypto is high risk.'})), 'Referral link. Crypto is high risk.');
		assert.equal(offerDisclosure(offer()), 'Affiliate link: I may earn a commission.');
	});
	it('resolveOffers reports ids missing from the registry', () => {
		const {resolved, missing} = resolveOffers(['wallet', 'nope'], {version: 1, offers: [offer()]}, new Date());
		assert.deepEqual(resolved.map((r) => r.id), ['wallet']);
		assert.deepEqual(missing, ['nope']);
	});
});

describe('hub links', () => {
	it('builds /go/<offer>?v=<slug>&s=<source> and the link page', () => {
		assert.equal(hubLink('https://go.zoora.ai', 'hardware-wallet', '_example', 'yt'), 'https://go.zoora.ai/go/hardware-wallet?v=_example&s=yt');
		assert.equal(hubPage('https://go.zoora.ai', 'ep-1', 'x'), 'https://go.zoora.ai/?v=ep-1&s=x');
		assert.equal(hubPage('https://go.zoora.ai', null, 'tiktok'), 'https://go.zoora.ai/?s=tiktok');
	});
	it('hubBase accepts an https origin only', () => {
		assert.equal(hubBase('https://go.zoora.ai/'), 'https://go.zoora.ai');
		for (const bad of ['http://go.zoora.ai', 'https://zoora.ai/hub', 'https://u:p@go.zoora.ai', 'not a url', 'https://go.zoora.ai/?a=1']) {
			assert.throws(() => hubBase(bad), InputError, bad);
		}
	});
});

describe('loadRegistry', () => {
	const dir = mkdtempSync(join(tmpdir(), 'publish-kit-offers-'));
	after(() => rmSync(dir, {recursive: true, force: true}));
	mkdirSync(join(dir, 'config'));
	writeFileSync(join(dir, 'config', 'offers.example.json'), JSON.stringify({version: 1, offers: [offer({active: false})]}));

	it('falls back to offers.example.json and says so', () => {
		const load = loadRegistry(dir);
		assert.equal(load.isExample, true);
		assert.equal(load.registry.offers[0].active, false);
	});
	it('prefers offers.json, and refuses an invalid registry', () => {
		writeFileSync(join(dir, 'config', 'offers.json'), JSON.stringify({version: 1, offers: [offer()]}));
		assert.equal(loadRegistry(dir).isExample, false);
		writeFileSync(join(dir, 'config', 'offers.json'), JSON.stringify({version: 1, offers: [offer({url: 'http://insecure.test'})]}));
		assert.throws(() => loadRegistry(dir), /"url" must use https/);
		assert.throws(() => loadRegistry(dir, join(dir, 'missing.json')), /offer registry not found/);
	});
});
