/**
 * Artifact encryption. The repository is public, so every artifact is downloadable by anyone signed in to GitHub:
 * outputs of an encrypted request are encrypted BEFORE upload, with
 *
 *   openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -md sha256 -salt -pass env:RENDER_ARTIFACT_KEY
 *
 * (-md sha256 is OpenSSL 3's default; it is spelled out so LibreSSL and older builds derive the same key).
 * scripts/farm/decrypt.sh reverses it. The key comes from the repository secret RENDER_ARTIFACT_KEY and is passed to
 * openssl through the environment, never on a command line.
 */
import {spawnSync} from 'node:child_process';
import {closeSync, existsSync, openSync, readSync, rmSync, statSync} from 'node:fs';

export const KEY_ENV = 'RENDER_ARTIFACT_KEY';
export const MIN_KEY_CHARS = 32;
export const OPENSSL_CIPHER = ['-aes-256-cbc', '-pbkdf2', '-iter', '200000', '-md', 'sha256'] as const;
const MAGIC = 'Salted__';

export class FarmError extends Error {}

/** Why a key is unusable, or null. Never includes the key. */
export const keyProblem = (key: string | undefined): string | null => {
	if (!key) {
		return `the repository secret ${KEY_ENV} is not set. Add it in GitHub: the repository's Settings > Secrets and variables > Actions > New repository secret (generate one with: openssl rand -base64 48). Nothing was uploaded.`;
	}
	if (/[\r\n]/.test(key) || key !== key.trim()) return `${KEY_ENV} contains a line break or starts or ends with whitespace; set it again without it. Nothing was uploaded.`;
	if (key.length < MIN_KEY_CHARS) return `${KEY_ENV} is shorter than ${MIN_KEY_CHARS} characters; replace it with: openssl rand -base64 48. Nothing was uploaded.`;
	return null;
};

/** Returns the key from the environment or throws a FarmError that explains how to set it. */
export const requireKey = (env: NodeJS.ProcessEnv): string => {
	const key = env[KEY_ENV];
	const problem = keyProblem(key);
	if (problem) throw new FarmError(problem);
	return key as string;
};

/** True when the file starts with openssl's salted header and holds at least one cipher block. */
export const isEncrypted = (path: string): boolean => {
	if (!existsSync(path) || statSync(path).size < MAGIC.length + 8 + 16) return false;
	const fd = openSync(path, 'r');
	try {
		const buf = Buffer.alloc(MAGIC.length);
		readSync(fd, buf, 0, MAGIC.length, 0);
		return buf.toString('latin1') === MAGIC;
	} finally {
		closeSync(fd);
	}
};

const openssl = (args: string[], key: string, what: string, dst: string): void => {
	const r = spawnSync('openssl', ['enc', ...args, '-pass', `env:${KEY_ENV}`], {
		env: {...process.env, [KEY_ENV]: key},
		stdio: ['ignore', 'ignore', 'pipe'],
		encoding: 'utf8',
	});
	if (r.error || r.status !== 0) {
		rmSync(dst, {force: true});
		const reason = r.error ? r.error.message : (r.stderr || '').split('\n').find((l) => l.trim()) || `exit ${r.status}`;
		throw new FarmError(`openssl could not ${what} (${reason.slice(0, 200)})`);
	}
};

export const encryptFile = (src: string, dst: string, key: string): void => {
	if (keyProblem(key)) throw new FarmError(keyProblem(key) as string);
	openssl([...OPENSSL_CIPHER, '-salt', '-in', src, '-out', dst], key, 'encrypt a file', dst);
	if (!isEncrypted(dst)) {
		rmSync(dst, {force: true});
		throw new FarmError('openssl wrote no salted ciphertext');
	}
};

/** Decrypts; a wrong key or a damaged file throws (openssl's padding check), and no output is left behind. */
export const decryptFile = (src: string, dst: string, key: string): void => {
	if (!isEncrypted(src)) throw new FarmError('the file is not an openssl-salted ciphertext');
	openssl(['-d', ...OPENSSL_CIPHER, '-in', src, '-out', dst], key, 'decrypt a file (wrong key or damaged file)', dst);
};
