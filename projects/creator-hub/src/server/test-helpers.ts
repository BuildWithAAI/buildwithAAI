/** Test support: a real hub on an ephemeral port with a temporary DATA_DIR and CONFIG_DIR. */
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {SQLOutputValue} from 'node:sqlite';
import {createHub, type Hub} from './app.ts';
import {loadSettings} from './config.ts';

export const HUMAN_UA =
	'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
export const TEST_SECRET = 'test-hash-secret-0123456789abcdef0123456789';

export const testRegistry = (): {version: 1; offers: Record<string, unknown>[]} => ({
	version: 1,
	offers: [
		{
			id: 'wallet',
			name: 'Test Wallet',
			url: 'https://shop.wallet.test/buy?ref=abc%20def',
			category: 'security',
			relationship: 'affiliate',
			disclosure: 'Affiliate link: I may earn a commission if you buy.',
			blockedCountries: [],
			unknownCountry: 'allow',
			active: true,
			subIdParam: 'subid',
		},
		{
			id: 'exchange',
			name: 'Test Exchange',
			url: 'https://exchange.test/invite?code=xyz',
			category: 'exchange',
			relationship: 'referral',
			disclosure: 'Referral link: I earn a share of fees if you sign up and trade.',
			blockedCountries: ['US', 'GB'],
			unknownCountry: 'block',
			active: true,
			restrictedReason: 'This exchange does not serve your country.',
			alternatives: ['wallet', 'eu-course'],
			subIdParam: 'sub',
		},
		{
			id: 'eu-course',
			name: 'EU Course',
			url: 'https://course.test/learn',
			category: 'education',
			relationship: 'affiliate',
			disclosure: 'Affiliate link: I may earn a commission.',
			blockedCountries: [],
			allowedCountries: ['DE', 'FR', 'NL'],
			unknownCountry: 'block',
			active: true,
		},
		{
			id: 'old-deal',
			name: 'Old Deal',
			url: 'https://old.test/',
			category: 'tools',
			relationship: 'affiliate',
			disclosure: 'Affiliate link.',
			blockedCountries: [],
			unknownCountry: 'allow',
			active: true,
			expires: '2020-01-31',
			alternatives: ['wallet'],
		},
		{
			id: 'paused',
			name: 'Paused Tool',
			url: 'https://paused.test/',
			category: 'tools',
			relationship: 'sponsor',
			disclosure: 'Sponsored.',
			blockedCountries: [],
			unknownCountry: 'allow',
			active: false,
		},
	],
});

export type TestHub = {
	base: string;
	hub: Hub;
	/** fetch relative to the hub, never following redirects, as a human browser unless overridden. */
	request(path: string, init?: RequestInit): Promise<Response>;
	lastClick(): Record<string, SQLOutputValue> | undefined;
	close(): Promise<void>;
};

export const startTestHub = async (options: {env?: Record<string, string>; registry?: unknown; configFiles?: Record<string, unknown>} = {}): Promise<TestHub> => {
	const dir = mkdtempSync(join(tmpdir(), 'creator-hub-test-'));
	const configDir = join(dir, 'config');
	mkdirSync(configDir);
	writeFileSync(join(configDir, 'offers.json'), JSON.stringify(options.registry ?? testRegistry()));
	for (const [name, value] of Object.entries(options.configFiles ?? {})) writeFileSync(join(configDir, name), JSON.stringify(value));
	const settings = loadSettings({
		NODE_ENV: 'test',
		HOST: '127.0.0.1',
		PORT: '0',
		DATA_DIR: join(dir, 'data'),
		CONFIG_DIR: configDir,
		HASH_SECRET: TEST_SECRET,
		PUBLIC_BASE_URL: 'http://hub.test',
		CONTACT_EMAIL: 'hello@hub.test',
		RATE_LIMIT_BURST: '10000',
		...options.env,
	});
	const hub = createHub(settings);
	const base = await hub.listen();
	return {
		base,
		hub,
		request: (path, init = {}) => {
			const headers = new Headers(init.headers);
			if (!headers.has('user-agent')) headers.set('user-agent', HUMAN_UA);
			return fetch(base + path, {redirect: 'manual', ...init, headers});
		},
		lastClick: () => hub.db.prepare('SELECT * FROM clicks ORDER BY id DESC LIMIT 1').get(),
		close: async () => {
			await hub.close();
			rmSync(dir, {recursive: true, force: true});
		},
	};
};
