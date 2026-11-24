import assert from 'node:assert/strict';
import type {IncomingMessage} from 'node:http';
import {describe, it} from 'node:test';
import {COUNTRY_CODES} from './countries.ts';
import {ipKey, proxyTrusted, resolveCountry, resolveIpKey, visitorHash, type GeoSettings} from './geo.ts';

const fakeReq = (headers: Record<string, string>, remoteAddress = '203.0.113.9'): IncomingMessage =>
	({headers: Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v])), socket: {remoteAddress}}) as unknown as IncomingMessage;

const geo = (fields: Partial<GeoSettings>): GeoSettings => ({
	trustProxy: 'none',
	geoHeader: null,
	ipHeader: null,
	proxySecret: null,
	proxySecretHeader: 'X-Origin-Secret',
	...fields,
});

const country = (settings: GeoSettings, headers: Record<string, string>): string | null => {
	const req = fakeReq(headers);
	return resolveCountry(req, settings, proxyTrusted(req, settings));
};

describe('country resolution', () => {
	it('ignores every header when TRUST_PROXY=none', () => {
		assert.equal(country(geo({}), {'CF-IPCountry': 'DE', 'X-Country': 'DE'}), null);
	});

	it('reads CF-IPCountry in cloudflare mode; XX and T1 mean unknown', () => {
		const cf = geo({trustProxy: 'cloudflare'});
		assert.equal(country(cf, {'CF-IPCountry': 'GB'}), 'GB');
		assert.equal(country(cf, {'CF-IPCountry': 'gb'}), 'GB');
		assert.equal(country(cf, {'CF-IPCountry': 'XX'}), null);
		assert.equal(country(cf, {'CF-IPCountry': 'T1'}), null);
		assert.equal(country(cf, {'CF-IPCountry': 'UK'}), null, 'UK is not an ISO code');
		assert.equal(country(cf, {'X-Country': 'DE'}), null);
		assert.equal(country(cf, {}), null);
	});

	it('reads only GEO_HEADER in header mode', () => {
		const header = geo({trustProxy: 'header', geoHeader: 'X-Country'});
		assert.equal(country(header, {'X-Country': 'FR'}), 'FR');
		assert.equal(country(header, {'CF-IPCountry': 'FR'}), null);
	});

	it('requires the shared proxy secret when PROXY_SECRET is set', () => {
		const secret = 's'.repeat(40);
		const cf = geo({trustProxy: 'cloudflare', proxySecret: secret});
		assert.equal(country(cf, {'CF-IPCountry': 'DE'}), null);
		assert.equal(country(cf, {'CF-IPCountry': 'DE', 'X-Origin-Secret': 'wrong'}), null);
		assert.equal(country(cf, {'CF-IPCountry': 'DE', 'X-Origin-Secret': secret}), 'DE');
	});
});

describe('client IP key', () => {
	it('uses the socket unless a trusted proxy header is present', () => {
		const req = fakeReq({'CF-Connecting-IP': '198.51.100.1'}, '::ffff:10.0.0.1');
		assert.equal(resolveIpKey(req, geo({}), false), '10.0.0.1');
		assert.equal(resolveIpKey(req, geo({trustProxy: 'cloudflare'}), true), '198.51.100.1');
		const xff = fakeReq({'X-Forwarded-For': '6.6.6.6, 198.51.100.7'}, '10.0.0.1');
		assert.equal(resolveIpKey(xff, geo({trustProxy: 'header', geoHeader: 'X-C', ipHeader: 'X-Forwarded-For'}), true), '198.51.100.7');
	});

	it('keys IPv6 visitors by their /64 prefix', () => {
		assert.equal(ipKey('2001:db8:aa:bb:1:2:3:4'), '2001:db8:aa:bb::/64');
		assert.equal(ipKey('2001:0db8::1'), '2001:db8:0:0::/64');
		assert.equal(ipKey('fe80::1%eth0'), 'fe80:0:0:0::/64');
		assert.equal(ipKey('192.0.2.1'), '192.0.2.1');
		assert.equal(ipKey('not-an-ip'), null);
	});
});

describe('visitor hash', () => {
	const day = new Date('2026-11-24T10:00:00Z');
	it('is 16 hex characters, stable within a UTC day and different across days, IPs, agents and secrets', () => {
		const h = visitorHash('secret-a', '192.0.2.1', 'UA', day);
		assert.match(h, /^[0-9a-f]{16}$/);
		assert.equal(visitorHash('secret-a', '192.0.2.1', 'UA', new Date('2026-11-24T23:59:59Z')), h);
		assert.notEqual(visitorHash('secret-a', '192.0.2.1', 'UA', new Date('2026-11-25T00:00:00Z')), h);
		assert.notEqual(visitorHash('secret-a', '192.0.2.2', 'UA', day), h);
		assert.notEqual(visitorHash('secret-a', '192.0.2.1', 'UA2', day), h);
		assert.notEqual(visitorHash('secret-b', '192.0.2.1', 'UA', day), h);
	});
});

describe('country list', () => {
	it('has the 249 ISO 3166-1 codes plus XK', () => {
		assert.equal(COUNTRY_CODES.size, 250);
		for (const code of ['GB', 'US', 'DE', 'XK', 'AQ']) assert.ok(COUNTRY_CODES.has(code), code);
		for (const code of ['UK', 'EU', 'XX', 'T1']) assert.ok(!COUNTRY_CODES.has(code), code);
	});
});
