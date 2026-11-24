// node --test scripts/farm/tests/crypto.test.ts   (the decrypt.sh tests also need bash; the zip test needs python3)
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash, generateKeyPairSync, type KeyObject} from 'node:crypto';
import {existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {after, test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {
	decryptHandoff,
	decryptWithPrivateKey,
	encryptHandoff,
	encryptToRecipient,
	FarmError,
	fingerprintOf,
	formatOf,
	HANDOFF_ENV,
	isEncrypted,
	keyProblem,
	loadPrivateKey,
	loadRecipient,
	MIN_KEY_CHARS,
	parseRecipientPem,
	recipientProblem,
	requireHandoffKey,
	type Recipient,
} from '../crypto.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const FARM = join(HERE, '..');
const DECRYPT_SH = join(FARM, 'decrypt.sh');
const SECRET = 'h4ndoff-For-Tests-Only-0123456789-abcdefghij+/=';
const tmp = mkdtempSync(join(tmpdir(), 'farm-crypto-'));
after(() => rmSync(tmp, {recursive: true, force: true}));

/** A throwaway project folder with scripts/farm/keys/<name>.pub.pem for each key pair. */
const project = join(tmp, 'project');
const pair = (name: string, bits = 3072) => {
	const {publicKey, privateKey} = generateKeyPairSync('rsa', {modulusLength: bits});
	mkdirSync(join(project, 'scripts/farm/keys'), {recursive: true});
	writeFileSync(join(project, 'scripts/farm/keys', `${name}.pub.pem`), publicKey.export({type: 'spki', format: 'pem'}));
	const keyFile = join(tmp, `${name}.key`);
	writeFileSync(keyFile, privateKey.export({type: 'pkcs8', format: 'pem'}), {mode: 0o600});
	return {publicKey, privateKey, keyFile};
};
const owner = pair('owner');
const other = pair('other');
const OWNER: Recipient = loadRecipient(project, 'owner');

const sample = (name: string, bytes = 200_003) => {
	const p = join(tmp, name);
	mkdirSync(dirname(p), {recursive: true});
	const buf = Buffer.alloc(bytes);
	for (let i = 0; i < bytes; i++) buf[i] = (i * 31 + 7) % 251;
	writeFileSync(p, buf);
	return p;
};

test('the hand-off key: missing, short or padded secrets are refused, and no message contains the secret', () => {
	assert.match(keyProblem(undefined) ?? '', /RENDER_HANDOFF_KEY is not set.*openssl rand -base64 48 \| gh secret set RENDER_HANDOFF_KEY --env render-farm/);
	assert.match(keyProblem('short') ?? '', new RegExp(`shorter than ${MIN_KEY_CHARS}`));
	assert.match(keyProblem(`${SECRET}\n`) ?? '', /line break/);
	assert.match(keyProblem(` ${SECRET}`) ?? '', /whitespace/);
	assert.equal(keyProblem(SECRET), null);
	assert.throws(() => requireHandoffKey({}), FarmError);
	assert.equal(requireHandoffKey({[HANDOFF_ENV]: SECRET}), SECRET);
	for (const bad of ['short-but-secret-value', `${SECRET} `]) assert.ok(!(keyProblem(bad) ?? '').includes(bad.trim()));
});

test('recipients: only committed RSA public keys of 3072+ bits are accepted', () => {
	assert.equal(recipientProblem(project, 'owner'), null);
	assert.match(recipientProblem(project, 'nobody') ?? '', /nobody\.pub\.pem is not in this commit/);
	assert.match(recipientProblem(join(tmp, 'empty'), 'owner') ?? '', /The owner creates his key pair once and commits only the public key/);
	assert.match(recipientProblem(project, '../x') ?? '', /1-32 lowercase/);
	const small = generateKeyPairSync('rsa', {modulusLength: 2048}).publicKey.export({type: 'spki', format: 'pem'}) as string;
	assert.match(parseRecipientPem(small).ok ? '' : (parseRecipientPem(small) as {problem: string}).problem, /2048-bit RSA; use at least 3072/);
	const ec = generateKeyPairSync('ec', {namedCurve: 'P-256'}).publicKey.export({type: 'spki', format: 'pem'}) as string;
	assert.match((parseRecipientPem(ec) as {problem: string}).problem, /ec key; the farm wraps file keys with RSA-OAEP/);
	assert.match((parseRecipientPem('not a key') as {problem: string}).problem, /not a PEM public key/);
	assert.deepEqual(OWNER.fingerprint, fingerprintOf(owner.publicKey));
});

test('outputs: encrypted to the public key, decrypted only with the matching private key; streaming round-trip', async () => {
	const src = sample('a.bin');
	await encryptToRecipient(src, join(tmp, 'a1.enc'), OWNER);
	await encryptToRecipient(src, join(tmp, 'a2.enc'), OWNER);
	assert.equal(formatOf(join(tmp, 'a1.enc')), 'public-key');
	assert.notDeepEqual(readFileSync(join(tmp, 'a1.enc')), readFileSync(join(tmp, 'a2.enc')), 'a fresh file key and IV every time');
	assert.equal(readFileSync(join(tmp, 'a1.enc')).indexOf(readFileSync(src).subarray(0, 64)), -1, 'no plaintext in the ciphertext');
	await decryptWithPrivateKey(join(tmp, 'a1.enc'), join(tmp, 'a1.out'), owner.privateKey);
	assert.deepEqual(readFileSync(join(tmp, 'a1.out')), readFileSync(src));
	// an empty file round-trips too
	const empty = join(tmp, 'empty.bin');
	writeFileSync(empty, '');
	await encryptToRecipient(empty, join(tmp, 'empty.enc'), OWNER);
	await decryptWithPrivateKey(join(tmp, 'empty.enc'), join(tmp, 'empty.out'), owner.privateKey);
	assert.equal(readFileSync(join(tmp, 'empty.out')).length, 0);
});

test('outputs: another private key, a changed byte or a truncated file fails and leaves no plaintext', async () => {
	const src = sample('b.bin', 70_001);
	const enc = join(tmp, 'b.enc');
	await encryptToRecipient(src, enc, OWNER);
	await assert.rejects(decryptWithPrivateKey(enc, join(tmp, 'b.out'), other.privateKey), /encrypted for another key/);
	const bytes = readFileSync(enc);
	for (const [name, at] of [
		['body', bytes.length - 500],
		['tag', bytes.length - 3],
		['iv', 8 + 32 + 2 + 384 + 2],
		['wrapped key', 8 + 32 + 2 + 10],
	] as const) {
		const bad = Buffer.from(bytes);
		bad[at] ^= 0x01;
		const p = join(tmp, `b-${name.replace(' ', '-')}.enc`);
		writeFileSync(p, bad);
		await assert.rejects(decryptWithPrivateKey(p, join(tmp, 'b-bad.out'), owner.privateKey), /did not (decrypt|unwrap)/, name);
		assert.equal(existsSync(join(tmp, 'b-bad.out')), false, `no output after a changed ${name}`);
	}
	writeFileSync(join(tmp, 'b-cut.enc'), bytes.subarray(0, bytes.length - 20));
	await assert.rejects(decryptWithPrivateKey(join(tmp, 'b-cut.enc'), join(tmp, 'b-cut.out'), owner.privateKey), /did not decrypt/);
	assert.equal(isEncrypted(src), false, 'plaintext is not mistaken for ciphertext');
	await assert.rejects(decryptWithPrivateKey(src, join(tmp, 'c.out'), owner.privateKey), /not a public-key encrypted farm file/);
});

test('the hand-off cipher: round-trips with the secret; a wrong secret or a changed byte fails', async () => {
	const src = sample('h.bin', 150_000);
	await encryptHandoff(src, join(tmp, 'h.enc'), SECRET);
	assert.equal(formatOf(join(tmp, 'h.enc')), 'handoff');
	await decryptHandoff(join(tmp, 'h.enc'), join(tmp, 'h.out'), SECRET);
	assert.deepEqual(readFileSync(join(tmp, 'h.out')), readFileSync(src));
	await assert.rejects(decryptHandoff(join(tmp, 'h.enc'), join(tmp, 'h2.out'), `${SECRET}-wrong`), /did not decrypt/);
	assert.equal(existsSync(join(tmp, 'h2.out')), false);
	const bad = readFileSync(join(tmp, 'h.enc'));
	bad[20] ^= 0x80; // the salt: a different derived key
	writeFileSync(join(tmp, 'h-bad.enc'), bad);
	await assert.rejects(decryptHandoff(join(tmp, 'h-bad.enc'), join(tmp, 'h3.out'), SECRET), /did not decrypt/);
	await assert.rejects(encryptHandoff(src, join(tmp, 'h4.enc'), 'too-short'), /shorter than/);
	assert.equal(existsSync(join(tmp, 'h4.enc')), false);
	await assert.rejects(decryptHandoff(join(tmp, 'a1.enc'), join(tmp, 'h5.out'), SECRET), /not a hand-off encrypted/);
});

test('no key ever reaches a child process: the cipher runs in this process (an openssl planted on PATH is never run)', async () => {
	const source = readFileSync(join(FARM, 'crypto.ts'), 'utf8');
	assert.doesNotMatch(source, /child_process|spawn|exec/, 'crypto.ts must not start processes');
	const bin = join(tmp, 'evil-bin');
	mkdirSync(bin, {recursive: true});
	const marker = join(tmp, 'evil-ran');
	writeFileSync(join(bin, 'openssl'), `#!/bin/sh\necho ran > ${JSON.stringify(marker)}\nexit 0\n`, {mode: 0o755});
	const saved = process.env.PATH;
	process.env.PATH = `${bin}:${saved ?? ''}`;
	try {
		await encryptHandoff(sample('p.bin', 1000), join(tmp, 'p.enc'), SECRET);
		await encryptToRecipient(join(tmp, 'p.bin'), join(tmp, 'p2.enc'), OWNER);
	} finally {
		process.env.PATH = saved;
	}
	assert.equal(existsSync(marker), false);
});

test('private keys: a passphrase-protected PEM needs FARM_KEY_PASSPHRASE; garbage is refused', () => {
	const pem = owner.privateKey.export({type: 'pkcs8', format: 'pem', cipher: 'aes-256-cbc', passphrase: 'pass phrase'}) as string;
	assert.throws(() => loadPrivateKey(pem), /FARM_KEY_PASSPHRASE/);
	const k: KeyObject = loadPrivateKey(pem, 'pass phrase');
	assert.equal(k.asymmetricKeyType, 'rsa');
	assert.throws(() => loadPrivateKey('nope'), /not a PEM private key/);
});

// ---- decrypt.sh / decrypt.ts -----------------------------------------------------------------------------------

const decryptSh = (args: string[], env: NodeJS.ProcessEnv = {}, cwd = tmp) =>
	spawnSync('bash', [DECRYPT_SH, ...args], {cwd, encoding: 'utf8', env: {PATH: process.env.PATH, HOME: process.env.HOME, ...env}, input: ''});

/** Lays out an artifact the way the render job stages one: the output, its checksum file and a log, all encrypted. */
const artifact = async (dir: string, opts: {badSum?: boolean} = {}) => {
	const plain = join(tmp, `${dir}-plain`);
	const out = sample(`${dir}-plain/out/episodes/ep/es/episode.mp4`, 50_000);
	const sha = createHash('sha256').update(readFileSync(out)).digest('hex');
	const sums = join(plain, 'render_ep_0_Episode_es.sha256');
	writeFileSync(sums, `${opts.badSum ? '0'.repeat(64) : sha}  out/episodes/ep/es/episode.mp4\n`);
	const log = join(plain, 'tool.log');
	writeFileSync(log, 'Rendered 1/1\n');
	const art = join(tmp, dir);
	mkdirSync(join(art, 'out/episodes/ep/es'), {recursive: true});
	mkdirSync(join(art, 'logs'), {recursive: true});
	await encryptToRecipient(out, join(art, 'out/episodes/ep/es/episode.mp4.enc'), OWNER);
	await encryptToRecipient(sums, join(art, 'render_ep_0_Episode_es.sha256.enc'), OWNER);
	await encryptToRecipient(log, join(art, 'logs/render_ep_0_Episode_es.log.enc'), OWNER);
	return {art, out};
};

test('decrypt.sh: an artifact folder decrypts with its layout using the owner\'s private key, and the checksums verify', async () => {
	const {art, out} = await artifact('art1');
	const r = decryptSh(['--key', owner.keyFile, art, '--out', join(tmp, 'dec1')]);
	assert.equal(r.status, 0, r.stderr + r.stdout);
	assert.deepEqual(readFileSync(join(tmp, 'dec1/out/episodes/ep/es/episode.mp4')), readFileSync(out));
	assert.ok(existsSync(join(tmp, 'dec1/logs/render_ep_0_Episode_es.log')));
	assert.match(r.stdout, /ok {4}checksums in/);
	const again = decryptSh(['--key', owner.keyFile, art, '--out', join(tmp, 'dec1')]);
	assert.equal(again.status, 1);
	assert.match(again.stderr, /exists \(use --force/);
	assert.equal(decryptSh(['--key', owner.keyFile, art, '--out', join(tmp, 'dec1'), '--force']).status, 0);
});

test('decrypt.sh: another key or no key fails and leaves no plaintext; a checksum mismatch fails', async () => {
	const {art} = await artifact('art2');
	const wrong = decryptSh(['--key', other.keyFile, art, '--out', join(tmp, 'dec2')]);
	assert.equal(wrong.status, 1);
	assert.match(wrong.stderr, /FAIL .*encrypted for another key/);
	assert.equal(existsSync(join(tmp, 'dec2/out/episodes/ep/es/episode.mp4')), false);
	const none = decryptSh([art, '--out', join(tmp, 'dec3')]);
	assert.equal(none.status, 1);
	assert.match(none.stderr, /pass --key <private key>/);
	const {art: art3} = await artifact('art3', {badSum: true});
	const bad = decryptSh(['--key', owner.keyFile, art3, '--out', join(tmp, 'dec4')]);
	assert.equal(bad.status, 1);
	assert.match(bad.stderr, /does not match its checksum/);
});

test('decrypt.sh: a zipped artifact (as the run page downloads it), single .enc files and hand-off files work', async (t) => {
	const {art, out} = await artifact('art4');
	const zip = join(tmp, 'art4.zip');
	const z = spawnSync('python3', ['-I', '-c', 'import shutil,sys; shutil.make_archive(sys.argv[1][:-4], "zip", sys.argv[2])', zip, art]);
	if (z.status !== 0) {
		t.skip('python3 is needed to build the zip fixture');
		return;
	}
	const r = decryptSh(['--key', owner.keyFile, zip, '--out', join(tmp, 'dec6')]);
	assert.equal(r.status, 0, r.stderr);
	assert.deepEqual(readFileSync(join(tmp, 'dec6/out/episodes/ep/es/episode.mp4')), readFileSync(out));
	const one = decryptSh(['--key', owner.keyFile, join(art, 'out/episodes/ep/es/episode.mp4.enc'), '--out', join(tmp, 'dec7')]);
	assert.equal(one.status, 0, one.stderr);
	assert.deepEqual(readFileSync(join(tmp, 'dec7/episode.mp4')), readFileSync(out));
	const ho = join(tmp, 'ho');
	mkdirSync(ho, {recursive: true});
	await encryptHandoff(sample('ho-plain.tar', 999), join(ho, 'voice_x_0.tar.enc'), SECRET);
	assert.equal(decryptSh([ho, '--out', join(tmp, 'dec8')]).status, 1, 'a hand-off file needs the hand-off secret');
	assert.equal(decryptSh([ho, '--out', join(tmp, 'dec8')], {[HANDOFF_ENV]: SECRET}).status, 0);
	assert.equal(decryptSh([join(tmp, 'nothing-here')]).status, 2);
	assert.equal(decryptSh([]).status, 0, 'no input prints the usage');
});
