/**
 * Drop exactly one Node warning, MODULE_TYPELESS_PACKAGE_JSON. Node prints it when this tool loads the news gate's
 * sentence splitter, which imports src/episode/markup.ts (an ES module under the studio package.json, which has no
 * "type" field and is not ours to change). Every other warning still prints. Call it before the dynamic import.
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
