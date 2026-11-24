#!/usr/bin/env node
/**
 * Dubbing tools: node scripts/dub/cli.ts prepare|import|validate content/<channel>/<slug> --lang <lang>; --help for more.
 * Thin entry point: it hides Node's MODULE_TYPELESS_PACKAGE_JSON warning for src/episode/*.ts (the studio's
 * package.json has no "type" field and is not ours to change), then loads lib/main.ts.
 */
import {quietTypelessWarning} from '../claims/lib/quiet.ts';

quietTypelessWarning();
const {main} = await import('./lib/main.ts');
process.exitCode = await main(process.argv.slice(2));
