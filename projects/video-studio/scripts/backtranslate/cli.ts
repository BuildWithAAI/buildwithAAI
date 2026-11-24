#!/usr/bin/env node
/**
 * Back-translation check: node scripts/backtranslate/cli.ts <prepare|import|compare> <episode> --lang es|pt-br.
 * --help for options. Thin entry point: it hides Node's MODULE_TYPELESS_PACKAGE_JSON warning (the tool reads the
 * episode engine's markup parser in src/episode, whose package.json has no "type" field and is not ours to change),
 * then loads lib/main.ts.
 */
const original = process.emitWarning;
process.emitWarning = function (this: unknown, warning: string | Error, ...rest: unknown[]) {
	const opt = rest[0];
	const code = typeof opt === 'object' && opt !== null ? (opt as {code?: string}).code : rest[1];
	if (code === 'MODULE_TYPELESS_PACKAGE_JSON') return;
	return (original as (...a: unknown[]) => void).call(process, warning, ...rest);
} as typeof process.emitWarning;

const {main} = await import('./lib/main.ts');
process.exitCode = await main(process.argv.slice(2));

export {};
