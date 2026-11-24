import assert from 'node:assert/strict';
import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {after, describe, it} from 'node:test';
import {ConfigError, DEFAULT_KIT_FORM_ACTION, loadSettings} from './config.ts';
import {testRegistry} from './test-helpers.ts';

const dir = mkdtempSync(join(tmpdir(), 'hub-config-'));
after(() => rmSync(dir, {recursive: true, force: true}));

const withOffers = (registry: unknown): string => {
	const configDir = mkdtempSync(join(dir, 'config-'));
	writeFileSync(join(configDir, 'offers.json'), JSON.stringify(registry));
	return configDir;
};

const issues = (env: Record<string, string>): string => {
	try {
		loadSettings({DATA_DIR: join(dir, 'data'), CONFIG_DIR: withOffers(testRegistry()), ...env});
	} catch (err) {
		assert.ok(err instanceof ConfigError);
		return err.issues.join('\n');
	}
	assert.fail('expected a ConfigError');
};

describe('loadSettings', () => {
	it('builds a development config with safe defaults', () => {
		const settings = loadSettings({DATA_DIR: join(dir, 'data'), CONFIG_DIR: withOffers(testRegistry()), PORT: '9000'});
		assert.equal(settings.hub.publicBaseUrl, 'http://localhost:9000');
		assert.equal(settings.hub.kitFormAction, DEFAULT_KIT_FORM_ACTION);
		assert.equal(settings.hub.brandName, 'Zoora AI');
		assert.equal(settings.geo.trustProxy, 'none');
		assert.ok(settings.hub.hashSecret.length >= 32);
		assert.equal(settings.hub.offers.offers.length, 5);
	});

	it('requires https PUBLIC_BASE_URL and HASH_SECRET in production', () => {
		const text = issues({NODE_ENV: 'production', PUBLIC_BASE_URL: 'http://go.zoora.ai'});
		assert.match(text, /must use https in production/);
		assert.match(text, /HASH_SECRET is required in production/);
		assert.match(issues({PUBLIC_BASE_URL: 'https://go.zoora.ai/hub'}), /origin only/);
	});

	it('validates admin, proxy and contact settings, listing every problem at once', () => {
		const text = issues({
			ADMIN_USER: 'owner',
			ADMIN_PASSWORD_HASH: 'plain-password',
			TRUST_PROXY: 'header',
			HASH_SECRET: 'short',
			CONTACT_EMAIL: 'not-an-email',
			PROXY_SECRET: 'short',
			KIT_FORM_ACTION: 'http://app.kit.com/forms/1/subscriptions',
		});
		for (const expected of [/ADMIN_PASSWORD_HASH is not a valid scrypt hash/, /needs GEO_HEADER .*and\/or IP_HEADER/, /HASH_SECRET must be at least 32/, /CONTACT_EMAIL/, /PROXY_SECRET must be at least 32/, /KIT_FORM_ACTION must be an https URL/]) {
			assert.match(text, expected);
		}
		assert.match(issues({ADMIN_USER: 'owner'}), /set both ADMIN_USER and ADMIN_PASSWORD_HASH/);
		assert.match(issues({TRUST_PROXY: 'yes'}), /TRUST_PROXY must be/);
	});

	it('fails fast on an invalid registry and names the file', () => {
		const configDir = withOffers({version: 1, offers: [{...testRegistry().offers[1], blockedCountries: ['UK']}]});
		assert.throws(() => loadSettings({DATA_DIR: join(dir, 'data'), CONFIG_DIR: configDir}), (err: unknown) => {
			assert.ok(err instanceof ConfigError);
			assert.match(err.message, /offers\.json: .*use "GB" for the United Kingdom/);
			return true;
		});
	});

	it('falls back to offers.example.json with every offer forced inactive', () => {
		const configDir = mkdtempSync(join(dir, 'example-'));
		writeFileSync(join(configDir, 'offers.example.json'), JSON.stringify(testRegistry()));
		const settings = loadSettings({DATA_DIR: join(dir, 'data'), CONFIG_DIR: configDir});
		assert.ok(settings.offersFile.endsWith('offers.example.json'));
		assert.ok(settings.hub.offers.offers.every((o) => !o.active));
		assert.match(settings.warnings.join('\n'), /every offer inactive/);
	});

	it('warns when proxy headers are trusted without a shared secret', () => {
		const settings = loadSettings({DATA_DIR: join(dir, 'data'), CONFIG_DIR: withOffers(testRegistry()), TRUST_PROXY: 'cloudflare'});
		assert.match(settings.warnings.join('\n'), /without PROXY_SECRET/);
	});

	it('allows extra https form-action origins and rejects anything else', () => {
		const settings = loadSettings({
			DATA_DIR: join(dir, 'data'),
			CONFIG_DIR: withOffers(testRegistry()),
			FORM_ACTION_ORIGINS: 'https://zoora.ai https://app.kit.com',
		});
		assert.deepEqual(settings.formOrigins, ['https://app.kit.com', 'https://zoora.ai']);
		assert.match(issues({FORM_ACTION_ORIGINS: 'http://zoora.ai'}), /must be an https origin/);
		assert.match(issues({FORM_ACTION_ORIGINS: 'https://zoora.ai/thanks'}), /must be an https origin/);
		assert.match(issues({FORM_ACTION_ORIGINS: "https://a.test 'unsafe-inline'"}), /must be an https origin/);
	});

	it('supports a proxy that only reports the client IP (Fly.io without a CDN)', () => {
		const settings = loadSettings({
			DATA_DIR: join(dir, 'data'),
			CONFIG_DIR: withOffers(testRegistry()),
			TRUST_PROXY: 'header',
			IP_HEADER: 'Fly-Client-IP',
		});
		assert.equal(settings.geo.ipHeader, 'Fly-Client-IP');
		assert.equal(settings.geo.geoHeader, null);
		assert.match(settings.warnings.join('\n'), /visitor country is unknown/);
		assert.doesNotMatch(settings.warnings.join('\n'), /without PROXY_SECRET/);
	});
});
