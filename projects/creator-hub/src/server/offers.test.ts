import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {describe, it} from 'node:test';
import type {Offer} from '../types.ts';
import {checkRegistry, destinationUrl, disclosureLines, hubPagePath, hubPath, isLive, isRestricted, regionDecision, RISK_LINE, topDisclosure} from './offers.ts';
import {testRegistry} from './test-helpers.ts';

const base = (): Record<string, unknown> => ({...testRegistry().offers[0]});
const errorsFor = (...offers: Record<string, unknown>[]): string[] => checkRegistry({version: 1, offers}).errors;
const offer = (fields: Partial<Offer>): Offer => ({...(testRegistry().offers[0] as unknown as Offer), ...fields});

describe('offer registry validation', () => {
	it('accepts the test registry and the shipped example', () => {
		assert.deepEqual(checkRegistry(testRegistry()).errors, []);
		const example = JSON.parse(readFileSync(new URL('../../config/offers.example.json', import.meta.url), 'utf8'));
		const check = checkRegistry(example);
		assert.deepEqual(check.errors, []);
		assert.ok(check.registry.offers.every((o) => !o.active), 'example offers must all be inactive');
	});

	it('rejects duplicate ids and bad slugs', () => {
		assert.match(errorsFor(base(), base()).join('\n'), /duplicate id/);
		assert.match(errorsFor({...base(), id: 'Bad_Id'}).join('\n'), /"id" must be a slug/);
	});

	it('requires https destination and terms URLs without credentials', () => {
		assert.match(errorsFor({...base(), url: 'http://shop.wallet.test/'}).join('\n'), /"url" must use https/);
		assert.match(errorsFor({...base(), url: 'javascript:alert(1)'}).join('\n'), /"url" must use https/);
		assert.match(errorsFor({...base(), url: 'https://user:pw@shop.test/'}).join('\n'), /credentials/);
		assert.match(errorsFor({...base(), termsUrl: 'ftp://x.test/'}).join('\n'), /"termsUrl" must use https/);
	});

	it('requires ISO 3166-1 alpha-2 codes and explains UK and lower case', () => {
		const uk = errorsFor({...base(), blockedCountries: ['UK'], unknownCountry: 'block'}).join('\n');
		assert.match(uk, /use "GB" for the United Kingdom/);
		const lower = errorsFor({...base(), blockedCountries: ['gb'], unknownCountry: 'block'}).join('\n');
		assert.match(lower, /use upper case "GB"/);
		assert.match(errorsFor({...base(), allowedCountries: ['ZZ'], unknownCountry: 'block'}).join('\n'), /"ZZ"/);
	});

	it('forces restricted and exchange offers to block unknown countries', () => {
		assert.match(errorsFor({...base(), category: 'exchange'}).join('\n'), /exchange" must use unknownCountry "block"/);
		assert.match(errorsFor({...base(), blockedCountries: ['GB']}).join('\n'), /restricted by country must use unknownCountry "block"/);
		assert.match(errorsFor({...base(), allowedCountries: ['DE']}).join('\n'), /restricted by country/);
	});

	it('treats exchanges and "financialPromotion" offers as financial promotions that must be region-restricted', () => {
		const yieldApp = {...base(), id: 'yield-app', category: 'tools', relationship: 'referral', disclosure: 'Referral link: I earn a fee if you deposit.'};
		// filed as "tools" with no country rules: accepted, but the owner is warned
		const loose = checkRegistry({version: 1, offers: [yieldApp]});
		assert.deepEqual(loose.errors, []);
		assert.match(loose.warnings.join('\n'), /mentions "deposit".*"financialPromotion": true/);
		const flagged = errorsFor({...yieldApp, financialPromotion: true}).join('\n');
		assert.match(flagged, /financial promotion \("financialPromotion": true\) must use unknownCountry "block"/);
		assert.match(flagged, /must list the countries/);
		assert.match(errorsFor({...base(), category: 'exchange', unknownCountry: 'block'}).join('\n'), /must list the countries/);
		const ok = checkRegistry({version: 1, offers: [{...yieldApp, financialPromotion: true, blockedCountries: ['GB', 'US'], unknownCountry: 'block'}]});
		assert.deepEqual(ok.errors, []);
		assert.equal(ok.registry.offers[0]?.financialPromotion, true);
		assert.equal(regionDecision(ok.registry.offers[0]!, 'GB'), 'blocked_region');
		assert.equal(regionDecision(ok.registry.offers[0]!, null), 'blocked_unknown_region');
		assert.match(errorsFor({...base(), financialPromotion: 'yes'}).join('\n'), /"financialPromotion" must be true or false/);
		// an ordinary affiliate disclosure ("I may earn a commission") is not a financial word
		assert.deepEqual(checkRegistry(testRegistry()).warnings, []);
	});

	it('requires alternatives to exist and not point at the offer itself', () => {
		assert.match(errorsFor({...base(), alternatives: ['missing']}).join('\n'), /alternative "missing" does not exist/);
		assert.match(errorsFor({...base(), alternatives: ['wallet']}).join('\n'), /must not include the offer itself/);
	});

	it('never accepts a memecoin launchpad and never activates a placeholder URL', () => {
		assert.match(errorsFor({...base(), url: 'https://pump.fun/board'}).join('\n'), /launchpads are never offers/);
		assert.match(errorsFor({...base(), url: 'https://www.pump.fun/x'}).join('\n'), /launchpads/);
		// behind an affiliate-network tracking link, by name, by notes, and other launchpads
		for (const fields of [
			{name: 'Pump.fun', url: 'https://track.affnetwork.io/c/123?u=https%3A%2F%2Fpump.fun%2Fboard'},
			{url: 'https://track.affnetwork.io/c/123?u=https%253A%252F%252Fpump.fun%252Fboard'},
			{name: 'Pump fun bonus'},
			{url: 'https://bags.fm/?ref=abc'},
			{url: 'https://moonshot.money/?ref=abc'},
			{url: 'https://www.clanker.world/'},
			{url: 'https://app.virtuals.io/'},
			{notes: 'Token launchpad, new partner'},
		]) {
			assert.match(errorsFor({...base(), ...fields}).join('\n'), /launchpads are never offers/, JSON.stringify(fields));
		}
		assert.match(errorsFor({...base(), url: 'https://example.com/?ref=REPLACE'}).join('\n'), /replace the placeholder URL/);
		assert.deepEqual(errorsFor({...base(), url: 'https://example.com/?ref=REPLACE', active: false}), []);
	});

	it('rejects near-miss field names and warns about unknown ones', () => {
		assert.match(errorsFor({...base(), allowedCountry: ['DE']}).join('\n'), /did you mean "allowedCountries"/);
		const check = checkRegistry({version: 1, offers: [{...base(), shortName: 'W'}]});
		assert.deepEqual(check.errors, []);
		assert.match(check.warnings.join('\n'), /unknown field "shortName" is ignored/);
	});

	it('validates enums, booleans, dates and sub-ID parameter names', () => {
		const errors = errorsFor({...base(), relationship: 'friend', active: 'yes', expires: '2026-02-30', subIdParam: 'a b'}).join('\n');
		assert.match(errors, /"relationship" must be one of/);
		assert.match(errors, /"active" must be true or false/);
		assert.match(errors, /"expires" must be an ISO date/);
		assert.match(errors, /"subIdParam"/);
		assert.match(checkRegistry({version: 2, offers: []}).errors.join('\n'), /"version" must be 1/);
	});
});

describe('region policy', () => {
	const exchange = offer({blockedCountries: ['US', 'GB'], unknownCountry: 'block', category: 'exchange'});
	const euOnly = offer({allowedCountries: ['DE', 'FR'], unknownCountry: 'block'});
	const open = offer({});

	it('blocks listed countries and unknown countries for restricted offers', () => {
		assert.equal(regionDecision(exchange, 'GB'), 'blocked_region');
		assert.equal(regionDecision(exchange, 'US'), 'blocked_region');
		assert.equal(regionDecision(exchange, 'DE'), 'allow');
		assert.equal(regionDecision(exchange, null), 'blocked_unknown_region');
	});

	it('only allows listed countries when allowedCountries is set', () => {
		assert.equal(regionDecision(euOnly, 'DE'), 'allow');
		assert.equal(regionDecision(euOnly, 'GB'), 'blocked_region');
		assert.equal(regionDecision(euOnly, null), 'blocked_unknown_region');
	});

	it('allows unrestricted offers everywhere, including unknown countries', () => {
		assert.equal(regionDecision(open, 'GB'), 'allow');
		assert.equal(regionDecision(open, null), 'allow');
	});

	it('fails safe for a restricted offer even if unknownCountry says allow', () => {
		assert.equal(regionDecision(offer({blockedCountries: ['GB'], unknownCountry: 'allow'}), null), 'blocked_unknown_region');
	});

	it('treats inactive and expired offers as not live; a date-only expiry lasts the whole UTC day', () => {
		const end = Date.parse('2026-12-31T00:00:00Z');
		assert.equal(isLive(offer({active: false}), end), false);
		assert.equal(isLive(offer({expires: '2026-12-31'}), end + 23 * 3_600_000), true);
		assert.equal(isLive(offer({expires: '2026-12-31'}), end + 24 * 3_600_000), false);
		assert.equal(isLive(offer({expires: '2026-12-31T12:00:00Z'}), end + 13 * 3_600_000), false);
	});
});

describe('links and disclosures', () => {
	it('appends the sub-ID and keeps the rest of the registry URL byte for byte', () => {
		const o = offer({url: 'https://shop.test/p?ref=abc%20def&x=1#top', subIdParam: 'subid'});
		assert.equal(destinationUrl(o, 'dQw4w9WgXcQ', 'yt'), 'https://shop.test/p?ref=abc%20def&x=1&subid=dQw4w9WgXcQ.yt#top');
		assert.equal(destinationUrl(o, null, 'bio'), 'https://shop.test/p?ref=abc%20def&x=1&subid=none.bio#top');
		assert.equal(destinationUrl(o, null, null), 'https://shop.test/p?ref=abc%20def&x=1#top');
		assert.equal(destinationUrl(offer({url: 'https://shop.test/', subIdParam: 'sid'}), 'v1', 'x'), 'https://shop.test/?sid=v1.x');
		assert.equal(destinationUrl(offer({url: 'https://shop.test/?', subIdParam: 'sid'}), 'v1', 'x'), 'https://shop.test/?sid=v1.x');
		assert.equal(destinationUrl(offer({url: 'https://shop.test/?sid=old', subIdParam: 'sid'}), 'v1', 'x'), 'https://shop.test/?sid=v1.x');
		assert.equal(destinationUrl(offer({url: 'https://shop.test/?a=1', subIdParam: undefined}), 'v1', 'x'), 'https://shop.test/?a=1');
	});

	it('fills an existing empty sub-ID placeholder without re-encoding the rest of the URL', () => {
		const o = offer({url: 'https://x.test/buy?ref=abc%20def&subid=&sig=AB%2BC~d*e&flag#frag', subIdParam: 'subid'});
		assert.equal(destinationUrl(o, 'vidA', 'yt'), 'https://x.test/buy?ref=abc%20def&subid=vidA.yt&sig=AB%2BC~d*e&flag#frag');
		const twice = offer({url: 'https://x.test/?subid=a&subid=b', subIdParam: 'subid'});
		assert.equal(destinationUrl(twice, 'v', 'x'), 'https://x.test/?subid=v.x&subid=b');
	});

	it('marks offers that text visible everywhere must not name, and words the opening disclosure like the publish kit', () => {
		assert.equal(isRestricted(offer({})), false);
		assert.equal(isRestricted(offer({unknownCountry: 'block'})), true);
		assert.equal(isRestricted(offer({blockedCountries: ['GB'], unknownCountry: 'block'})), true);
		assert.equal(topDisclosure([]), null);
		assert.equal(
			topDisclosure([offer({relationship: 'affiliate'}), offer({relationship: 'referral'})]),
			'Disclosure: some links for this video are affiliate or referral links. If you use them, I may earn money. Each one is labelled next to the link.',
		);
		assert.match(topDisclosure([offer({relationship: 'own-product'})]) ?? '', /some links for this video go to my own products/);
		assert.equal(hubPagePath('abc', 'yt'), '/?v=abc&s=yt');
		assert.equal(hubPagePath(null, null), '/');
	});

	it('builds hub paths with encoded attribution', () => {
		assert.equal(hubPath('wallet', 'abc', 'yt'), '/go/wallet?v=abc&s=yt');
		assert.equal(hubPath('wallet', null, null), '/go/wallet');
	});

	it('adds a risk line to exchange disclosures that lack one', () => {
		assert.deepEqual(disclosureLines(offer({category: 'exchange', disclosure: 'Referral link.'})), ['Referral link.', RISK_LINE]);
		assert.deepEqual(disclosureLines(offer({category: 'exchange', disclosure: 'Referral link. High risk.'})), ['Referral link. High risk.']);
		assert.deepEqual(disclosureLines(offer({category: 'security', disclosure: 'Affiliate link.'})), ['Affiliate link.']);
	});
});
