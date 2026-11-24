// node --test scripts/farm/tests/crypto.test.ts   (needs openssl; the decrypt.sh tests also need bash)
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {after, test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {decryptFile, encryptFile, FarmError, isEncrypted, keyProblem, KEY_ENV, MIN_KEY_CHARS, requireKey} from '../crypto.ts';

const DECRYPT_SH = join(dirname(fileURLToPath(import.meta.url)), '..', 'decrypt.sh');
const KEY = 'k3y-For-Tests-Only-0123456789-abcdefghij+/=';
const tmp = mkdtempSync(join(tmpdir(), 'farm-crypto-'));
after(() => rmSync(tmp, {recursive: true, force: true}));

const sample = (name: string, bytes = 70_001) => {
	const p = join(tmp, name);
	mkdirSync(dirname(p), {recursive: true});
	const buf = Buffer.alloc(bytes);
	for (let i = 0; i < bytes; i++) buf[i] = (i * 31 + 7) % 251;
	writeFileSync(p, buf);
	return p;
};

test('keyProblem: missing, short, or padded keys are refused, and the message never contains the key', () => {
	assert.match(keyProblem(undefined) ?? '', /RENDER_ARTIFACT_KEY is not set.*Settings > Secrets and variables > Actions/);
	assert.match(keyProblem('') ?? '', /not set/);
	assert.match(keyProblem('short') ?? '', new RegExp(`shorter than ${MIN_KEY_CHARS}`));
	assert.match(keyProblem(`${KEY}\n`) ?? '', /line break/);
	assert.match(keyProblem(` ${KEY}`) ?? '', /whitespace/);
	assert.equal(keyProblem(KEY), null);
	assert.throws(() => requireKey({}), FarmError);
	assert.equal(requireKey({[KEY_ENV]: KEY}), KEY);
	for (const bad of ['short-but-secret-value', `${KEY} `]) assert.ok(!(keyProblem(bad) ?? '').includes(bad.trim()));
});

test('encrypt -> decrypt round-trips; the ciphertext is salted and differs every time', () => {
	const src = sample('a.bin');
	encryptFile(src, join(tmp, 'a1.enc'), KEY);
	encryptFile(src, join(tmp, 'a2.enc'), KEY);
	assert.ok(isEncrypted(join(tmp, 'a1.enc')));
	assert.notDeepEqual(readFileSync(join(tmp, 'a1.enc')), readFileSync(join(tmp, 'a2.enc')));
	assert.equal(readFileSync(join(tmp, 'a1.enc')).indexOf(readFileSync(src).subarray(0, 64)), -1);
	decryptFile(join(tmp, 'a1.enc'), join(tmp, 'a1.out'), KEY);
	assert.deepEqual(readFileSync(join(tmp, 'a1.out')), readFileSync(src));
});

test('a wrong key fails and leaves no output; plaintext is not mistaken for ciphertext', () => {
	const src = sample('b.bin');
	encryptFile(src, join(tmp, 'b.enc'), KEY);
	assert.throws(() => decryptFile(join(tmp, 'b.enc'), join(tmp, 'b.out'), `${KEY}-wrong-wrong`), /wrong key or damaged/);
	assert.equal(existsSync(join(tmp, 'b.out')), false);
	assert.equal(isEncrypted(src), false);
	assert.throws(() => decryptFile(src, join(tmp, 'c.out'), KEY), /not an openssl-salted ciphertext/);
	assert.throws(() => encryptFile(src, join(tmp, 'd.enc'), 'too-short'), /shorter than/);
	assert.equal(existsSync(join(tmp, 'd.enc')), false);
});

test("the documented openssl command (the task's exact flags, OpenSSL 3 defaults) decrypts the farm's files", () => {
	const src = sample('e.bin', 1234);
	encryptFile(src, join(tmp, 'e.enc'), KEY);
	const r = spawnSync('openssl', ['enc', '-d', '-aes-256-cbc', '-pbkdf2', '-iter', '200000', '-in', join(tmp, 'e.enc'), '-out', join(tmp, 'e.out'), '-pass', 'env:K'], {env: {...process.env, K: KEY}});
	assert.equal(r.status, 0, String(r.stderr));
	assert.deepEqual(readFileSync(join(tmp, 'e.out')), readFileSync(src));
});

// ---- decrypt.sh ------------------------------------------------------------------------------------------------

const decryptSh = (args: string[], env: NodeJS.ProcessEnv = {[KEY_ENV]: KEY}, cwd = tmp) =>
	spawnSync('bash', [DECRYPT_SH, ...args], {cwd, encoding: 'utf8', env: {PATH: process.env.PATH, HOME: process.env.HOME, ...env}, input: ''});

/** Lays out an artifact the way the render job stages one: the output, its checksum file and a log, all encrypted. */
const artifact = (dir: string, opts: {badSum?: boolean} = {}) => {
	const plain = join(tmp, `${dir}-plain`);
	const out = sample(`${dir}-plain/out/episodes/ep/es/episode.mp4`, 50_000);
	const sha = spawnSync('sha256sum', [out], {encoding: 'utf8'}).stdout.split(' ')[0];
	const sums = join(plain, 'render_ep_0_Episode_es.sha256');
	writeFileSync(sums, `${opts.badSum ? '0'.repeat(64) : sha}  out/episodes/ep/es/episode.mp4\n`);
	const log = join(plain, 'tool.log');
	writeFileSync(log, 'Rendered 1/1\n');
	const art = join(tmp, dir);
	mkdirSync(join(art, 'out/episodes/ep/es'), {recursive: true});
	mkdirSync(join(art, 'logs'), {recursive: true});
	encryptFile(out, join(art, 'out/episodes/ep/es/episode.mp4.enc'), KEY);
	encryptFile(sums, join(art, 'render_ep_0_Episode_es.sha256.enc'), KEY);
	encryptFile(log, join(art, 'logs/render_ep_0_Episode_es.log.enc'), KEY);
	return {art, out};
};

test('decrypt.sh: a downloaded artifact folder decrypts with its layout, and the checksums verify', () => {
	const {art, out} = artifact('art1');
	const r = decryptSh([art, '--out', join(tmp, 'dec1')]);
	assert.equal(r.status, 0, r.stderr + r.stdout);
	assert.deepEqual(readFileSync(join(tmp, 'dec1/out/episodes/ep/es/episode.mp4')), readFileSync(out));
	assert.ok(existsSync(join(tmp, 'dec1/logs/render_ep_0_Episode_es.log')));
	assert.match(r.stdout, /ok {4}checksums in/);
	assert.ok(!r.stdout.includes(KEY) && !r.stderr.includes(KEY));
	// Without --force it refuses to overwrite.
	const again = decryptSh([art, '--out', join(tmp, 'dec1')]);
	assert.equal(again.status, 1);
	assert.match(again.stderr, /exists \(use --force/);
	assert.equal(decryptSh([art, '--out', join(tmp, 'dec1'), '--force']).status, 0);
});

test('decrypt.sh: the key can come from --key-file; a wrong key fails and leaves no plaintext', () => {
	const {art} = artifact('art2');
	const keyFile = join(tmp, 'key.txt');
	writeFileSync(keyFile, `${KEY}\n`, {mode: 0o600});
	assert.equal(decryptSh([art, '--out', join(tmp, 'dec2'), '--key-file', keyFile], {}).status, 0);
	const bad = decryptSh([art, '--out', join(tmp, 'dec3')], {[KEY_ENV]: `${KEY}-wrong`});
	assert.equal(bad.status, 1);
	assert.match(bad.stderr, /FAIL .*wrong key or damaged file/);
	assert.equal(existsSync(join(tmp, 'dec3/out/episodes/ep/es/episode.mp4')), false);
	const none = decryptSh([art, '--out', join(tmp, 'dec4')], {});
	assert.equal(none.status, 2);
	assert.match(none.stderr, /no key/);
});

test('decrypt.sh: a checksum mismatch fails', () => {
	const {art} = artifact('art3', {badSum: true});
	const r = decryptSh([art, '--out', join(tmp, 'dec5')]);
	assert.equal(r.status, 1);
	assert.match(r.stderr, /checksums in .* do not match/);
});

test('decrypt.sh: a zipped artifact (as the run page downloads it) and single .enc files work', (t) => {
	const {art, out} = artifact('art4');
	const zip = join(tmp, 'art4.zip');
	const z = spawnSync('python3', ['-I', '-c', 'import shutil,sys; shutil.make_archive(sys.argv[1][:-4], "zip", sys.argv[2])', zip, art]);
	if (z.status !== 0) {
		t.skip('python3 is needed to build the zip fixture');
		return;
	}
	const r = decryptSh([zip, '--out', join(tmp, 'dec6')]);
	assert.equal(r.status, 0, r.stderr);
	assert.deepEqual(readFileSync(join(tmp, 'dec6/out/episodes/ep/es/episode.mp4')), readFileSync(out));
	const one = decryptSh([join(art, 'out/episodes/ep/es/episode.mp4.enc'), '--out', join(tmp, 'dec7')]);
	assert.equal(one.status, 0, one.stderr);
	assert.deepEqual(readFileSync(join(tmp, 'dec7/episode.mp4')), readFileSync(out));
	assert.equal(decryptSh([join(tmp, 'nothing-here')]).status, 2);
	assert.equal(decryptSh([]).status, 2);
});
