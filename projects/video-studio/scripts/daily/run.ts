#!/usr/bin/env node
/**
 * Daily orchestrator for channel 2 (zoora-security): node scripts/daily/run.ts <prepare|build|approve|status> ...
 * Run from projects/video-studio. The runbook is docs/DAILY_BRIEF.md; `--help` lists the options.
 * Thin entry point: it hides Node's MODULE_TYPELESS_PACKAGE_JSON warning (the news gate's sentence splitter imports
 * src/episode/markup.ts, under a package.json without "type"), then loads lib/cli.ts.
 */
import {quietTypelessWarning} from './lib/quiet.ts';

quietTypelessWarning();
const {main} = await import('./lib/cli.ts');
process.exitCode = await main(process.argv.slice(2));
