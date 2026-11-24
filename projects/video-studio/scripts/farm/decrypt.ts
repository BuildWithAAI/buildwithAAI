#!/usr/bin/env node
/**
 * Decrypt render-farm artifacts (docs/RENDER_FARM.md, "Getting the files").
 *
 *   node scripts/farm/decrypt.ts --key ~/.zoora/farm-owner.key [--out DIR] [--force] INPUT...
 *
 * INPUT is a folder (an unzipped artifact, or `gh run download`'s output) or .enc files; scripts/farm/decrypt.sh
 * unzips artifact .zip files first. Every *.enc file is decrypted into DIR (default ./decrypted), keeping its folder
 * layout and dropping ".enc"; then every decrypted *.sha256 file is checked. Outputs and logs are encrypted to the
 * owner's public key, so --key is the owner's PRIVATE key (an encrypted PEM reads its passphrase from
 * FARM_KEY_PASSPHRASE). Narration hand-off files (kept 1 day, needed only inside CI) decrypt with RENDER_HANDOFF_KEY.
 *
 * Exit codes: 0 all decrypted and verified; 1 a file failed or a checksum did not match; 2 bad usage.
 */
import {createHash} from 'node:crypto';
import {createReadStream, existsSync, mkdirSync, readdirSync, readFileSync, statSync} from 'node:fs';
import {basename, dirname, join, relative, resolve, sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {FarmError, HANDOFF_ENV, decryptHandoff, decryptWithPrivateKey, formatOf, loadPrivateKey, recipientFingerprint} from './crypto.ts';
import type {KeyObject} from 'node:crypto';

const USAGE = `usage: node scripts/farm/decrypt.ts --key <private key .pem> [--out DIR] [--force] INPUT...
  INPUT   folders (unzipped artifacts) or .enc files; scripts/farm/decrypt.sh also takes the .zip files
  --key   the owner's private key (outputs and logs are encrypted to the owner's public key)
  --out   where the decrypted files go (default: ./decrypted)
  --force replace files that already exist`;

type Args = {key: string | null; out: string; force: boolean; inputs: string[]};

export const parseArgs = (argv: string[]): Args | string => {
	const a: Args = {key: null, out: 'decrypted', force: false, inputs: []};
	for (let i = 0; i < argv.length; i++) {
		const k = argv[i];
		const value = () => {
			const v = argv[++i];
			if (v === undefined) throw new Error(`${k} needs a value`);
			return v;
		};
		try {
			if (k === '--key') a.key = value();
			else if (k.startsWith('--key=')) a.key = k.slice(6);
			else if (k === '--out') a.out = value();
			else if (k.startsWith('--out=')) a.out = k.slice(6);
			else if (k === '--force') a.force = true;
			else if (k === '-h' || k === '--help') return USAGE;
			else if (k === '--') a.inputs.push(...argv.slice(i + 1)), (i = argv.length);
			else if (k.startsWith('-')) return `unknown option ${k}\n${USAGE}`;
			else a.inputs.push(k);
		} catch (e) {
			return `${(e as Error).message}\n${USAGE}`;
		}
	}
	return a.inputs.length ? a : USAGE;
};

const walk = (root: string): string[] => {
	const out: string[] = [];
	const visit = (dir: string) => {
		for (const d of readdirSync(dir, {withFileTypes: true})) {
			const p = join(dir, d.name);
			if (d.isDirectory()) visit(p);
			else if (d.isFile() && d.name.endsWith('.enc')) out.push(p);
		}
	};
	visit(root);
	return out.sort();
};

const sha256File = (path: string): Promise<string> =>
	new Promise((res, rej) => {
		const h = createHash('sha256');
		createReadStream(path)
			.on('data', (b) => h.update(b))
			.on('error', rej)
			.on('end', () => res(h.digest('hex')));
	});

/** Checks "<sha256>  <path>" lines against files relative to the checksum file's folder. */
export const verifyChecksums = async (sumsFile: string): Promise<string[]> => {
	const problems: string[] = [];
	const base = dirname(sumsFile);
	for (const line of readFileSync(sumsFile, 'utf8').split('\n').filter((l) => l.trim())) {
		const m = /^([0-9a-f]{64}) [ *](.+)$/.exec(line.trim());
		if (!m) {
			problems.push(`${sumsFile}: a line is not "<sha256>  <path>"`);
			continue;
		}
		const target = resolve(base, m[2]);
		if (!target.startsWith(resolve(base) + sep)) {
			problems.push(`${sumsFile}: ${m[2]} points outside its folder`);
			continue;
		}
		if (!existsSync(target)) problems.push(`${m[2]} is missing`);
		else if ((await sha256File(target)) !== m[1]) problems.push(`${m[2]} does not match its checksum`);
	}
	return problems;
};

export const run = async (argv: string[], env: NodeJS.ProcessEnv, log: (s: string) => void, err: (s: string) => void): Promise<number> => {
	const a = parseArgs(argv);
	if (typeof a === 'string') {
		(a === USAGE ? log : err)(a);
		return a === USAGE ? 0 : 2;
	}
	let privateKey: KeyObject | null = null;
	if (a.key) {
		if (!existsSync(a.key)) {
			err(`decrypt: cannot read ${a.key}`);
			return 2;
		}
		try {
			privateKey = loadPrivateKey(readFileSync(a.key, 'utf8'), env.FARM_KEY_PASSPHRASE || undefined);
		} catch (e) {
			err(`decrypt: ${(e as Error).message}`);
			return 2;
		}
	}
	const files: Array<{src: string; rel: string}> = [];
	for (const input of a.inputs) {
		if (!existsSync(input)) {
			err(`decrypt: ${input} does not exist`);
			return 2;
		}
		if (statSync(input).isDirectory()) for (const f of walk(input)) files.push({src: f, rel: relative(input, f)});
		else if (input.endsWith('.enc')) files.push({src: input, rel: basename(input)});
		else {
			err(`decrypt: ${input} is not a folder or a .enc file (unzip artifacts with scripts/farm/decrypt.sh)`);
			return 2;
		}
	}
	if (!files.length) {
		err('decrypt: no .enc files found (unencrypted test artifacts need no decrypting)');
		return 1;
	}
	let failed = 0;
	const sums: string[] = [];
	for (const f of files) {
		const dst = join(a.out, f.rel.replace(/\.enc$/, ''));
		if (existsSync(dst) && !a.force) {
			err(`SKIP  ${dst} exists (use --force to replace it)`);
			failed++;
			continue;
		}
		mkdirSync(dirname(dst), {recursive: true});
		try {
			const format = formatOf(f.src);
			if (format === 'public-key') {
				if (!privateKey) throw new FarmError(`it is encrypted to a public key (fingerprint ${recipientFingerprint(f.src)?.slice(0, 16)}…): pass --key <private key>`);
				await decryptWithPrivateKey(f.src, dst, privateKey);
			} else if (format === 'handoff') {
				const secret = env[HANDOFF_ENV];
				if (!secret) throw new FarmError(`it is a narration hand-off file: set ${HANDOFF_ENV}`);
				await decryptHandoff(f.src, dst, secret);
			} else throw new FarmError('it is not a render-farm encrypted file');
			log(`ok    ${dst}`);
			if (dst.endsWith('.sha256')) sums.push(dst);
		} catch (e) {
			failed++;
			err(`FAIL  ${f.src}: ${e instanceof Error ? e.message : String(e)}`);
		}
	}
	for (const s of sums) {
		const problems = await verifyChecksums(s);
		if (problems.length) {
			failed++;
			for (const p of problems) err(`FAIL  ${p}`);
		} else log(`ok    checksums in ${s}`);
	}
	if (failed) {
		err('decrypt: finished with errors');
		return 1;
	}
	log(`decrypt: ${files.length} file(s) decrypted into ${a.out}`);
	return 0;
};

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	run(process.argv.slice(2), process.env, (s) => console.log(s), (s) => console.error(s)).then((code) => {
		process.exitCode = code;
	});
}
