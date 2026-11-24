#!/usr/bin/env node
/**
 * News claim gate (channel 2, zoora-security): node scripts/news/gate.ts <slug> [options]; --help for more.
 * Thin entry point: it hides Node's MODULE_TYPELESS_PACKAGE_JSON warning for src/episode/markup.ts (the studio's
 * package.json has no "type" field and is not ours to change), then loads lib/cli-gate.ts.
 */
import {quietTypelessWarning} from './lib/quiet.ts';

quietTypelessWarning();
const {main} = await import('./lib/cli-gate.ts');
process.exitCode = main(process.argv.slice(2));
