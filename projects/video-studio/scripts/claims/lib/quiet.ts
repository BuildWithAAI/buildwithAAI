/**
 * Drop exactly one Node warning: MODULE_TYPELESS_PACKAGE_JSON, which Node prints when it loads src/episode/*.ts (ES
 * modules under the studio's package.json, which has no "type" field and is not ours to change). Every other warning
 * still prints. Must run before the module graph that contains src/episode is loaded, so the entry points
 * (scripts/claims/check.ts, scripts/dub/cli.ts) import their implementation dynamically.
 */
export const quietTypelessWarning = (): void => {
	const original = process.emitWarning;
	process.emitWarning = function (this: unknown, warning: string | Error, ...rest: unknown[]) {
		const opt = rest[0];
		const code = typeof opt === 'object' && opt !== null ? (opt as {code?: string}).code : rest[1];
		if (code === 'MODULE_TYPELESS_PACKAGE_JSON') return;
		return (original as (...a: unknown[]) => void).call(process, warning, ...rest);
	} as typeof process.emitWarning;
};
