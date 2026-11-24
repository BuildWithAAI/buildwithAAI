/**
 * Bundling for QA: the target entry point, unchanged, with every project `import ... from 'remotion'` swapped
 * for src/qa/runtime/shim.tsx (probe injected into each composition, QaRef-<id> registered next to it).
 * Node only.
 */
import {existsSync, readdirSync} from 'node:fs';
import {dirname, join, resolve, sep} from 'node:path';
import {bundle, webpack} from '@remotion/bundler';

export const PROJECT_ROOT = resolve(import.meta.dirname, '..', '..', '..');
export const RUNTIME_DIR = join(PROJECT_ROOT, 'src', 'qa', 'runtime');
export const SHIM = join(RUNTIME_DIR, 'shim.tsx');

/** True when `issuer` is project code that should see the shim instead of the real package. */
export const shouldSwap = (issuer: string | undefined): boolean => {
	if (!issuer) return false;
	if (issuer.includes(`${sep}node_modules${sep}`)) return false;
	if (issuer.startsWith(RUNTIME_DIR + sep)) return false;
	return true;
};

type WebpackConfig = {plugins?: unknown[]; resolve?: {modules?: string[]} & Record<string, unknown>} & Record<string, unknown>;

/** The webpack override: swap 'remotion' for the shim; let files outside the project resolve its node_modules. */
export const qaWebpackOverride = (config: WebpackConfig): WebpackConfig => {
	const plugin = new webpack.NormalModuleReplacementPlugin(/^remotion$/, (res: {request: string; contextInfo?: {issuer?: string}}) => {
		if (shouldSwap(res.contextInfo?.issuer)) res.request = SHIM;
	});
	return {
		...config,
		plugins: [...(config.plugins ?? []), plugin],
		resolve: {...(config.resolve ?? {}), modules: [...(config.resolve?.modules ?? ['node_modules']), join(PROJECT_ROOT, 'node_modules')]},
	};
};

export const bundleForQa = async (entryPoint: string, onProgress?: (p: number) => void): Promise<string> => {
	const entry = resolve(entryPoint);
	if (!existsSync(entry)) throw new Error(`entry point not found: ${entryPoint}`);
	return bundle({
		entryPoint: entry,
		rootDir: PROJECT_ROOT,
		publicDir: join(PROJECT_ROOT, 'public'),
		webpackOverride: qaWebpackOverride as never,
		onProgress: onProgress ?? (() => undefined),
		enableCaching: true,
	});
};

/** Same browser choice as remotion.config.ts (the programmatic API does not read that file). */
export const browserExecutable = (): string | null => {
	if (process.env.REMOTION_BROWSER_EXECUTABLE) return process.env.REMOTION_BROWSER_EXECUTABLE;
	const pw = '/opt/pw-browsers';
	if (!existsSync(pw)) return null;
	const dir = readdirSync(pw)
		.filter((d) => /^chromium_headless_shell-\d+$/.test(d))
		.sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]))[0];
	const bin = dir ? join(pw, dir, 'chrome-headless-shell-linux64', 'chrome-headless-shell') : '';
	return bin && existsSync(bin) ? bin : null;
};

export const relToRoot = (p: string): string => (p.startsWith(PROJECT_ROOT + sep) ? p.slice(PROJECT_ROOT.length + 1) : p);
export {dirname};
