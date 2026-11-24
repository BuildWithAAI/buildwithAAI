/**
 * Prints an scrypt hash for ADMIN_PASSWORD_HASH.
 *
 *   node src/server/hash-password.ts                       (asks twice, input hidden)
 *   printf '%s' "$PASSWORD" | node src/server/hash-password.ts   (reads the first line of stdin)
 *
 * The hash is printed on stdout; it contains no "$", so it is safe in shells and .env files.
 * The password is never accepted as a command-line argument (it would end up in shell history).
 */
import {hashPassword} from './auth.ts';

const MIN_LENGTH = 12;

const readHidden = (prompt: string): Promise<string> =>
	new Promise((resolve, reject) => {
		const {stdin} = process;
		process.stderr.write(prompt);
		stdin.setRawMode(true);
		stdin.setEncoding('utf8');
		stdin.resume();
		let value = '';
		const finish = (): void => {
			stdin.off('data', onData);
			stdin.setRawMode(false);
			stdin.pause();
			process.stderr.write('\n');
		};
		const onData = (chunk: string): void => {
			for (const ch of chunk) {
				if (ch === '\r' || ch === '\n') {
					finish();
					resolve(value);
					return;
				}
				if (ch === '\u0003' || ch === '\u0004') {
					finish();
					reject(new Error('cancelled'));
					return;
				}
				if (ch === '\u007f' || ch === '\b') value = value.slice(0, -1);
				else if (ch >= ' ') value += ch;
			}
		};
		stdin.on('data', onData);
	});

const readStdin = async (): Promise<string> => {
	const chunks: Buffer[] = [];
	for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
	return Buffer.concat(chunks).toString('utf8').split(/\r?\n/)[0] ?? '';
};

const fail = (message: string): never => {
	process.stderr.write(`${message}\n`);
	process.exit(1);
};

let password: string;
if (process.stdin.isTTY) {
	password = await readHidden('New admin password: ').catch(() => fail('Cancelled.'));
	const again = await readHidden('Repeat the password: ').catch(() => fail('Cancelled.'));
	if (password !== again) fail('The passwords do not match.');
} else {
	password = await readStdin();
}
if (password.length < MIN_LENGTH) fail(`Use at least ${MIN_LENGTH} characters (a passphrase of 4+ random words is best).`);

process.stdout.write(`${await hashPassword(password)}\n`);
process.stderr.write('Set this as ADMIN_PASSWORD_HASH, e.g. fly secrets set ADMIN_PASSWORD_HASH=<hash>\n');
