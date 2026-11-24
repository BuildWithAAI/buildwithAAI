/**
 * Creator hub server entry point: node src/server/main.ts
 * Configuration: see config.ts (environment variables) and config/offers.json.
 */
import {createHub} from './app.ts';
import {ConfigError, loadSettings, type ServerSettings} from './config.ts';

let settings: ServerSettings;
try {
	settings = loadSettings(process.env);
} catch (err) {
	if (!(err instanceof ConfigError)) throw err;
	console.error(`[hub] ${err.message}`);
	process.exit(1);
}

for (const warning of settings.warnings) console.warn(`[hub] warning: ${warning}`);

const hub = createHub(settings);
const address = await hub.listen();
const {offers} = settings.hub.offers;
console.log(
	`[hub] listening on ${address} for ${settings.hub.publicBaseUrl}; ` +
		`${offers.filter((o) => o.active).length}/${offers.length} offers active (${settings.offersFile}); ` +
		`TRUST_PROXY=${settings.geo.trustProxy}; data in ${settings.dataDir}`,
);

const shutdown = (signal: string): void => {
	console.log(`[hub] ${signal} received, shutting down`);
	setTimeout(() => process.exit(1), 10_000).unref();
	hub.close().then(
		() => process.exit(0),
		(err: unknown) => {
			console.error('[hub] shutdown failed', err);
			process.exit(1);
		},
	);
};
process.once('SIGTERM', () => shutdown('SIGTERM'));
process.once('SIGINT', () => shutdown('SIGINT'));
