/**
 * Checks a studio config file before deploying it.
 * Usage (from projects/creator-hub): node src/server/studio/check-config.ts [config/studio.json]
 */
import {readFileSync} from 'node:fs';
import {loadStudioConfig} from './config.ts';

const path = process.argv[2] ?? 'config/studio.json';
try {
	const config = loadStudioConfig(JSON.parse(readFileSync(path, 'utf8')) as unknown);
	const unpriced = config.packages.filter((p) => p.priceUsd === null).map((p) => p.id);
	const payLinks = Object.keys(config.stripePaymentLinks ?? {});
	console.log(`${path}: OK`);
	console.log(`  packages: ${config.packages.map((p) => p.id).join(', ')}`);
	console.log(`  shown as "Contact for a quote": ${unpriced.length > 0 ? unpriced.join(', ') : 'none'}`);
	console.log(`  Stripe pay buttons: ${payLinks.length > 0 ? payLinks.join(', ') : 'none'}`);
	console.log(`  FAQ entries: ${config.faq.length}; portfolio items: ${config.portfolio.length} (section ${config.portfolio.length > 0 ? 'shown' : 'hidden'})`);
} catch (error) {
	console.error(`${path}: ${error instanceof Error ? error.message : String(error)}`);
	process.exitCode = 1;
}
