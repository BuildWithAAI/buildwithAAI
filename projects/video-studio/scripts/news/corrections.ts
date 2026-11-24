#!/usr/bin/env node
/**
 * Corrections for channel 2 (owner rule: "pin corrections"): node scripts/news/corrections.ts <command>; --help.
 * Thin entry point: it hides Node's MODULE_TYPELESS_PACKAGE_JSON warning for src/episode/markup.ts (the studio's
 * package.json has no "type" field and is not ours to change), then loads lib/cli-corrections.ts.
 */
import {quietTypelessWarning} from './lib/quiet.ts';

quietTypelessWarning();
const {main} = await import('./lib/cli-corrections.ts');
process.exitCode = main(process.argv.slice(2));
