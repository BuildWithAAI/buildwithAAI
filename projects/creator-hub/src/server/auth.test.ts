import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import {checkCredentials, csrfToken, hashPassword, parseBasicAuth, parseHash, readCookie, validCsrf, verifyPassword} from './auth.ts';

describe('scrypt password hashes', () => {
	it('round-trips, rejects wrong passwords and contains no shell-special "$"', async () => {
		const hash = await hashPassword('correct horse battery staple', 16384);
		assert.match(hash, /^scrypt:16384:8:1:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+$/);
		assert.equal(await verifyPassword('correct horse battery staple', hash), true);
		assert.equal(await verifyPassword('correct horse battery stapl', hash), false);
		assert.ok(parseHash(hash));
	});

	it('rejects malformed or weak hash strings', async () => {
		assert.equal(parseHash('plaintext'), null);
		assert.equal(parseHash('scrypt:1024:8:1:AAAAAAAAAAAAAAAAAAAAAA:AAAAAAAAAAAAAAAAAAAAAA'), null, 'N too small');
		assert.equal(parseHash('scrypt:16384:8:1:AA:AAAAAAAAAAAAAAAAAAAAAA'), null, 'salt too short');
		assert.equal(await verifyPassword('x', 'garbage'), false);
	});

	it('checks user and password together', async () => {
		const hash = await hashPassword('a long admin password', 16384);
		assert.equal(await checkCredentials({user: 'owner', password: 'a long admin password'}, 'owner', hash), true);
		assert.equal(await checkCredentials({user: 'other', password: 'a long admin password'}, 'owner', hash), false);
	});
});

describe('Basic auth, cookies and CSRF', () => {
	it('parses Basic credentials, including colons in the password', () => {
		const header = `Basic ${Buffer.from('owner:pa:ss').toString('base64')}`;
		assert.deepEqual(parseBasicAuth(header), {user: 'owner', password: 'pa:ss'});
		assert.equal(parseBasicAuth('Bearer abc'), null);
		assert.equal(parseBasicAuth(undefined), null);
	});

	it('reads a named cookie', () => {
		assert.equal(readCookie('a=1; hub_csrf=abc; b=2', 'hub_csrf'), 'abc');
		assert.equal(readCookie('xhub_csrf=abc', 'hub_csrf'), null);
	});

	it('accepts only the token signed for the cookie nonce', () => {
		const nonce = 'a'.repeat(64);
		const token = csrfToken('secret', nonce);
		assert.equal(validCsrf('secret', nonce, token), true);
		assert.equal(validCsrf('secret', 'b'.repeat(64), token), false);
		assert.equal(validCsrf('other-secret', nonce, token), false);
		assert.equal(validCsrf('secret', nonce, null), false);
		assert.equal(validCsrf('secret', null, token), false);
	});
});
