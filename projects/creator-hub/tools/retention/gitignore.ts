/**
 * Would git commit this file? This repository is public, so secrets (OAuth tokens, a Google client-secret JSON) must
 * only ever sit where git ignores them, or outside the work tree. Shared by the retention tool and the uploader.
 * No dependencies besides node: and the git command (when git is missing, the answer is "no-repo").
 */
import {execFileSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import {dirname, resolve} from 'node:path';

/** 'ignored', 'tracked' (git would commit it) or 'no-repo' (not in a git work tree, or git is missing). */
export const gitIgnoreStatus = (path: string): 'ignored' | 'tracked' | 'no-repo' => {
	let dir = dirname(resolve(path));
	while (!existsSync(dir) && dirname(dir) !== dir) dir = dirname(dir); // git needs an existing folder to run in
	try {
		execFileSync('git', ['rev-parse', '--is-inside-work-tree'], {cwd: dir, stdio: 'ignore'});
	} catch {
		return 'no-repo';
	}
	try {
		execFileSync('git', ['check-ignore', '-q', resolve(path)], {cwd: dir, stdio: 'ignore'});
		return 'ignored';
	} catch (err) {
		return (err as {status?: number}).status === 1 ? 'tracked' : 'no-repo';
	}
};

/**
 * A warning for a Google OAuth client-secret file that sits where git would commit it (null when it is safe). The
 * client secret of a "Desktop app" client is not a strong secret on its own, but with it and a leaked refresh token
 * anyone can act as the channel, and a public repository is crawled for both.
 */
export const clientSecretsWarning = (path: string): string | null =>
	gitIgnoreStatus(path) === 'tracked'
		? `Warning: ${path} is inside a git work tree and git would commit it, and this repository is public. ` +
			'Move the client-secret JSON out of the repository (for example to ~/Downloads, or a password manager) or delete it after this sign-in; never commit it.'
		: null;
