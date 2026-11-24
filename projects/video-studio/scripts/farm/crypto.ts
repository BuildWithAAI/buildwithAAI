/**
 * Artifact encryption (docs/RENDER_FARM.md, "Keys and secrets"). The repository is public, so anyone signed in to GitHub can
 * download its artifacts: an encrypted request never uploads plaintext. Two schemes, both in-process with node:crypto
 * (no openssl binary is looked up through PATH while a key is in memory):
 *
 * 1. Outputs (renders, their checksums, tool logs): hybrid public-key encryption to a recipient whose PUBLIC key is
 *    committed at scripts/farm/keys/<recipient>.pub.pem ("owner" by default). Each file gets a random 256-bit key and
 *    a random 96-bit IV for AES-256-GCM; the file key is wrapped with RSA-OAEP (SHA-256). CI never holds a key that
 *    can decrypt an output: only the owner's private key, kept on his own computer, can. GCM authenticates every byte.
 * 2. The narration hand-off between the voice and render jobs of one run (artifacts kept 1 day): AES-256-GCM with a
 *    key derived by HKDF-SHA256 (random salt per file) from the RENDER_HANDOFF_KEY secret. That secret decrypts
 *    nothing else, and nobody needs it outside CI.
 *
 * File formats (integers big-endian); the whole header is the GCM additional data, so no part of it can be swapped:
 *   outputs   "ZFARMPK1" | sha256(recipient SPKI DER) 32 B | wrapped-key length u16 | wrapped key | IV 12 B | ciphertext | tag 16 B
 *   hand-off  "ZFARMHO1" | salt 16 B | IV 12 B | ciphertext | tag 16 B
 * scripts/farm/decrypt.ts (and decrypt.sh, which unzips first) reverses both.
 */
import {
	constants,
	createCipheriv,
	createDecipheriv,
	createHash,
	createPrivateKey,
	createPublicKey,
	hkdfSync,
	privateDecrypt,
	publicEncrypt,
	randomBytes,
	type KeyObject,
} from 'node:crypto';
import {appendFileSync, closeSync, createReadStream, createWriteStream, existsSync, openSync, readFileSync, readSync, renameSync, rmSync, statSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {pipeline} from 'node:stream/promises';

export const HANDOFF_ENV = 'RENDER_HANDOFF_KEY';
export const MIN_KEY_CHARS = 32;
/** RSA moduli below this are refused (NIST SP 800-57: 3072 bits for use beyond 2030). */
export const MIN_RSA_BITS = 3072;
export const KEYS_DIR = 'scripts/farm/keys';
export const RECIPIENT_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;

const MAGIC_PK = Buffer.from('ZFARMPK1', 'latin1');
const MAGIC_HO = Buffer.from('ZFARMHO1', 'latin1');
const IV_BYTES = 12;
const TAG_BYTES = 16;
const SALT_BYTES = 16;
const FP_BYTES = 32;
const HKDF_INFO = Buffer.from('zoora-render-farm handoff v1', 'utf8');

export class FarmError extends Error {}

/** Why a hand-off secret is unusable, or null. Never includes the secret. */
export const keyProblem = (key: string | undefined): string | null => {
	if (!key) {
		return `the secret ${HANDOFF_ENV} is not set. It encrypts the narration the voice jobs hand to the render jobs (kept 1 day); nobody needs to know its value. Set it once in GitHub (docs/RENDER_FARM.md, "Keys and secrets"): openssl rand -base64 48 | gh secret set ${HANDOFF_ENV} --env render-farm. Nothing was uploaded.`;
	}
	if (/[\r\n]/.test(key) || key !== key.trim()) return `${HANDOFF_ENV} contains a line break or starts or ends with whitespace; set it again without it. Nothing was uploaded.`;
	if (key.length < MIN_KEY_CHARS) return `${HANDOFF_ENV} is shorter than ${MIN_KEY_CHARS} characters; replace it with the output of: openssl rand -base64 48. Nothing was uploaded.`;
	return null;
};

/** The hand-off secret from the environment, or a FarmError that says how to set it. */
export const requireHandoffKey = (env: NodeJS.ProcessEnv): string => {
	const key = env[HANDOFF_ENV];
	const problem = keyProblem(key);
	if (problem) throw new FarmError(problem);
	return key as string;
};

// ---------------------------------------------------------------------------------------------------------------
// Recipients (public keys)

export type Recipient = {name: string; key: KeyObject; fingerprint: Buffer};

export const recipientPath = (project: string, name: string): string => join(project, KEYS_DIR, `${name}.pub.pem`);

export const fingerprintOf = (publicKey: KeyObject): Buffer => createHash('sha256').update(publicKey.export({type: 'spki', format: 'der'})).digest();

/** Checks a PEM public key: RSA, at least MIN_RSA_BITS. Returns the key object or the reason it is refused. */
export const parseRecipientPem = (pem: string): {ok: true; key: KeyObject} | {ok: false; problem: string} => {
	let key: KeyObject;
	try {
		key = createPublicKey(pem);
	} catch {
		return {ok: false, problem: 'is not a PEM public key'};
	}
	if (key.asymmetricKeyType !== 'rsa') return {ok: false, problem: `is a ${key.asymmetricKeyType ?? 'non-RSA'} key; the farm wraps file keys with RSA-OAEP, so it needs an RSA key`};
	const bits = key.asymmetricKeyDetails?.modulusLength ?? 0;
	if (bits < MIN_RSA_BITS) return {ok: false, problem: `is ${bits}-bit RSA; use at least ${MIN_RSA_BITS} bits (4096 recommended)`};
	return {ok: true, key};
};

/** Why a recipient cannot be used, or null. */
export const recipientProblem = (project: string, name: string): string | null => {
	if (!RECIPIENT_RE.test(name)) return 'the recipient must be 1-32 lowercase letters, digits and dashes';
	const path = recipientPath(project, name);
	if (!existsSync(path)) {
		return `${KEYS_DIR}/${name}.pub.pem is not in this commit. ${name === 'owner' ? 'The owner creates his key pair once and commits only the public key (docs/RENDER_FARM.md, "Keys and secrets"); until then encrypted requests cannot run.' : 'Commit that public key, or use the default recipient "owner".'}`;
	}
	const parsed = parseRecipientPem(readFileSync(path, 'utf8'));
	return parsed.ok ? null : `${KEYS_DIR}/${name}.pub.pem ${parsed.problem}`;
};

export const loadRecipient = (project: string, name: string): Recipient => {
	const problem = recipientProblem(project, name);
	if (problem) throw new FarmError(problem);
	const parsed = parseRecipientPem(readFileSync(recipientPath(project, name), 'utf8'));
	if (!parsed.ok) throw new FarmError(parsed.problem);
	return {name, key: parsed.key, fingerprint: fingerprintOf(parsed.key)};
};

// ---------------------------------------------------------------------------------------------------------------
// Streaming AES-256-GCM

const encryptStream = async (src: string, dst: string, header: Buffer, key: Buffer, iv: Buffer): Promise<void> => {
	const tmp = `${dst}.part-${process.pid}`;
	const cipher = createCipheriv('aes-256-gcm', key, iv);
	cipher.setAAD(header);
	try {
		writeFileSync(tmp, header, {mode: 0o600});
		await pipeline(createReadStream(src), cipher, createWriteStream(tmp, {flags: 'a', mode: 0o600}));
		appendFileSync(tmp, cipher.getAuthTag());
		renameSync(tmp, dst);
	} catch (e) {
		rmSync(tmp, {force: true});
		throw new FarmError(`could not encrypt a file (${e instanceof Error ? e.message.slice(0, 160) : 'unknown error'})`);
	}
};

const readAt = (path: string, position: number, length: number): Buffer => {
	const fd = openSync(path, 'r');
	try {
		const buf = Buffer.alloc(length);
		const n = readSync(fd, buf, 0, length, position);
		return buf.subarray(0, n);
	} finally {
		closeSync(fd);
	}
};

/** Decrypts [bodyStart, size - TAG) of src into dst. A wrong key or any changed byte throws, and nothing is left. */
const decryptStream = async (src: string, dst: string, bodyStart: number, header: Buffer, key: Buffer, iv: Buffer): Promise<void> => {
	const size = statSync(src).size;
	if (size < bodyStart + TAG_BYTES) throw new FarmError('the file is truncated');
	const tag = readAt(src, size - TAG_BYTES, TAG_BYTES);
	const decipher = createDecipheriv('aes-256-gcm', key, iv);
	decipher.setAAD(header);
	decipher.setAuthTag(tag);
	const tmp = `${dst}.part-${process.pid}`;
	try {
		if (size === bodyStart + TAG_BYTES) {
			decipher.final();
			writeFileSync(tmp, Buffer.alloc(0), {mode: 0o600});
		} else {
			await pipeline(createReadStream(src, {start: bodyStart, end: size - TAG_BYTES - 1}), decipher, createWriteStream(tmp, {mode: 0o600}));
		}
		renameSync(tmp, dst);
	} catch {
		rmSync(tmp, {force: true});
		throw new FarmError('the file did not decrypt: wrong key, or the file was changed or damaged');
	}
};

// ---------------------------------------------------------------------------------------------------------------
// Outputs: public-key encryption

export type EncFormat = 'public-key' | 'handoff';

/** The format of an encrypted file (by its magic), or null when it is not one of the farm's. */
export const formatOf = (path: string): EncFormat | null => {
	if (!existsSync(path)) return null;
	const head = readAt(path, 0, 8);
	if (head.equals(MAGIC_PK)) return statSync(path).size >= 8 + FP_BYTES + 2 + IV_BYTES + TAG_BYTES ? 'public-key' : null;
	if (head.equals(MAGIC_HO)) return statSync(path).size >= 8 + SALT_BYTES + IV_BYTES + TAG_BYTES ? 'handoff' : null;
	return null;
};

export const isEncrypted = (path: string): boolean => formatOf(path) !== null;

/** Encrypts src to the recipient's public key. Only that recipient's private key can decrypt dst. */
export const encryptToRecipient = async (src: string, dst: string, recipient: Recipient): Promise<void> => {
	const fileKey = randomBytes(32);
	const iv = randomBytes(IV_BYTES);
	const wrapped = publicEncrypt({key: recipient.key, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256'}, fileKey);
	const len = Buffer.alloc(2);
	len.writeUInt16BE(wrapped.length);
	const header = Buffer.concat([MAGIC_PK, recipient.fingerprint, len, wrapped, iv]);
	try {
		await encryptStream(src, dst, header, fileKey, iv);
	} finally {
		fileKey.fill(0);
	}
	if (formatOf(dst) !== 'public-key') {
		rmSync(dst, {force: true});
		throw new FarmError('the encrypted file is not in the expected format');
	}
};

/** Reads a private key (PEM; an encrypted PEM needs its passphrase). */
export const loadPrivateKey = (pem: string, passphrase?: string): KeyObject => {
	const encrypted = /-----BEGIN ENCRYPTED PRIVATE KEY-----|Proc-Type: 4,ENCRYPTED/.test(pem);
	if (encrypted && !passphrase) throw new FarmError('the private key is protected by a passphrase: set FARM_KEY_PASSPHRASE');
	try {
		return createPrivateKey(passphrase ? {key: pem, passphrase} : pem);
	} catch {
		throw new FarmError(encrypted ? 'the private key did not open: wrong FARM_KEY_PASSPHRASE' : 'the private key file is not a PEM private key');
	}
};

/** The hex sha256 fingerprint a .enc file was encrypted for (to tell which key it needs). */
export const recipientFingerprint = (path: string): string | null => (formatOf(path) === 'public-key' ? readAt(path, 8, FP_BYTES).toString('hex') : null);

export const decryptWithPrivateKey = async (src: string, dst: string, privateKey: KeyObject): Promise<void> => {
	if (formatOf(src) !== 'public-key') throw new FarmError('the file is not a public-key encrypted farm file');
	const mine = fingerprintOf(createPublicKey(privateKey));
	const fp = readAt(src, 8, FP_BYTES);
	if (!fp.equals(mine)) throw new FarmError(`the file was encrypted for another key (fingerprint ${fp.toString('hex').slice(0, 16)}…, this key is ${mine.toString('hex').slice(0, 16)}…)`);
	const lenBuf = readAt(src, 8 + FP_BYTES, 2);
	const wrappedLen = lenBuf.readUInt16BE(0);
	const headerLen = 8 + FP_BYTES + 2 + wrappedLen + IV_BYTES;
	const header = readAt(src, 0, headerLen);
	if (header.length !== headerLen) throw new FarmError('the file is truncated');
	const wrapped = header.subarray(8 + FP_BYTES + 2, 8 + FP_BYTES + 2 + wrappedLen);
	const iv = header.subarray(headerLen - IV_BYTES);
	let fileKey: Buffer;
	try {
		fileKey = privateDecrypt({key: privateKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256'}, wrapped);
	} catch {
		throw new FarmError('the file key did not unwrap: wrong private key, or a damaged file');
	}
	if (fileKey.length !== 32) throw new FarmError('the file key has the wrong length');
	try {
		await decryptStream(src, dst, headerLen, header, fileKey, iv);
	} finally {
		fileKey.fill(0);
	}
};

// ---------------------------------------------------------------------------------------------------------------
// Narration hand-off: symmetric

const handoffKey = (secret: string, salt: Buffer): Buffer => Buffer.from(hkdfSync('sha256', Buffer.from(secret, 'utf8'), salt, HKDF_INFO, 32));

export const encryptHandoff = async (src: string, dst: string, secret: string): Promise<void> => {
	const problem = keyProblem(secret);
	if (problem) throw new FarmError(problem);
	const salt = randomBytes(SALT_BYTES);
	const iv = randomBytes(IV_BYTES);
	const header = Buffer.concat([MAGIC_HO, salt, iv]);
	const key = handoffKey(secret, salt);
	try {
		await encryptStream(src, dst, header, key, iv);
	} finally {
		key.fill(0);
	}
};

export const decryptHandoff = async (src: string, dst: string, secret: string): Promise<void> => {
	if (formatOf(src) !== 'handoff') throw new FarmError('the file is not a hand-off encrypted farm file');
	const headerLen = 8 + SALT_BYTES + IV_BYTES;
	const header = readAt(src, 0, headerLen);
	const salt = header.subarray(8, 8 + SALT_BYTES);
	const iv = header.subarray(8 + SALT_BYTES);
	const key = handoffKey(secret, salt);
	try {
		await decryptStream(src, dst, headerLen, header, key, iv);
	} finally {
		key.fill(0);
	}
};
