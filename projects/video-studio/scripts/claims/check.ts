#!/usr/bin/env node
/**
 * Claim gate: node scripts/claims/check.ts content/<channel>/<slug> [--lang <lang>]; --help for options.
 * Thin entry point: it hides Node's MODULE_TYPELESS_PACKAGE_JSON warning for src/episode/*.ts (the studio's
 * package.json has no "type" field and is not ours to change), then loads lib/cli.ts.
 */
import {quietTypelessWarning} from './lib/quiet.ts';

quietTypelessWarning();
const {main} = await import('./lib/cli.ts');
process.exitCode = main(process.argv.slice(2));
