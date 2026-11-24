/**
 * Minimal routing contract shared by all route modules. The server core (main.ts, router.ts,
 * geo.ts, db.ts) implements it; route modules only depend on these types.
 */
import type {IncomingMessage, ServerResponse} from 'node:http';
import type {DatabaseSync} from 'node:sqlite';
import type {CountryCode, OfferRegistry} from '../types.ts';

export type HubConfig = {
	publicBaseUrl: string; // e.g. https://go.zoora.ai
	brandName: string; // "Zoora AI"
	offers: OfferRegistry;
	studio: unknown; // parsed config/studio.json (shape owned by routes/studio.ts)
	kitFormAction: string; // Kit form POST URL, e.g. https://app.kit.com/forms/10168331/subscriptions
	contactEmail: string; // public business contact shown on pages
	adminUser: string;
	adminPasswordHash: string; // scrypt hash string, never a plain password
	hashSecret: string; // server secret for visitor hashing (rotated daily salt derives from it)
	/** Added 2026-11-24 (optional): the person or business that runs the site, named on /privacy (OPERATOR_NAME). */
	operatorName?: string;
};

export type Ctx = {
	req: IncomingMessage;
	res: ServerResponse;
	url: URL;
	params: Record<string, string>;
	country: CountryCode | null; // resolved by geo.ts from trusted proxy headers only
	visitorHash: string;
	isBot: boolean;
	db: DatabaseSync;
	config: HubConfig;
	/** Read and parse an application/x-www-form-urlencoded body (size-limited by the core). */
	form(): Promise<URLSearchParams>;
	html(status: number, body: string): void;
	json(status: number, body: unknown): void;
	redirect(status: 302 | 303, location: string): void;
};

export type Handler = (ctx: Ctx) => Promise<void> | void;

export interface Router {
	get(path: string, handler: Handler): void; // path supports ":param" segments
	post(path: string, handler: Handler): void;
}

export type RouteModule = {register(router: Router): void};
