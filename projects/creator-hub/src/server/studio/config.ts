/**
 * Shape and validation of config/studio.json (HubConfig.studio). Owned by routes/studio.ts.
 * Keys that start with "_" are ignored at every level, so the file can carry notes. Any other
 * unknown key is an error, which catches typos such as "priceUSD".
 *
 * Honesty checks: package, FAQ and portfolio text may not promise income, returns, prices or results
 * (the shared rules in src/claims.ts; a denied claim or a question, such as "Do you guarantee views? No.",
 * is fine), and a Stripe payment link needs a decided price.
 */
import {findClaims, RESULT_PROMISES} from '../../claims.ts';

export type StudioPackage = {
	id: string; // slug [a-z0-9-], 2-40 chars, no leading/trailing hyphen; "custom" is reserved
	name: string;
	summary?: string;
	deliverables: string[];
	/** Whole days from an approved brief to delivery. null shows "Agreed after the brief". */
	turnaroundDays: number | null;
	/** null shows "Contact for a quote". Only ever enter a price the owner has decided on. */
	priceUsd: number | null;
	/** Revision rounds included. null shows "Agreed in your quote". */
	revisions: number | null;
};

export type StudioFaq = {q: string; a: string};

/** Real, published work the owner may show. Never list invented clients. */
export type PortfolioItem = {title: string; url: string; description?: string; client?: string};

export type StudioConfig = {
	version: 1;
	packages: StudioPackage[];
	budgetRanges: string[]; // options for the form's budget select ("Not sure yet" is always added)
	faq: StudioFaq[];
	portfolio: PortfolioItem[]; // empty hides the section
	stripePaymentLinks?: Record<string, string>; // packageId -> https Stripe Payment Link; a button shows only when set
};

/** Package id used by the form's "Not sure yet / something else" option. */
export const CUSTOM_PACKAGE_ID = 'custom';

export class StudioConfigError extends Error {
	name = 'StudioConfigError';
}

type Obj = Record<string, unknown>;

const SLUG = /^[a-z0-9][a-z0-9-]{0,38}[a-z0-9]$/;
const MONEY = /^\d+(\.\d{1,2})?$/;

const fail = (path: string, problem: string): never => {
	throw new StudioConfigError(`studio config: ${path} ${problem}`);
};

const object = (value: unknown, path: string, allowed: readonly string[]): Obj => {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) return fail(path, 'must be an object');
	for (const key of Object.keys(value)) {
		if (!key.startsWith('_') && !allowed.includes(key)) fail(`${path}.${key}`, 'is not a known setting');
	}
	return value as Obj;
};

const text = (value: unknown, path: string, max: number): string => {
	if (typeof value !== 'string' || value.trim() === '') return fail(path, 'must be a non-empty string');
	const trimmed = value.trim();
	if (trimmed.length > max) fail(path, `must be at most ${max} characters`);
	return trimmed;
};

const optionalText = (value: unknown, path: string, max: number): string | undefined =>
	value === undefined ? undefined : text(value, path, max);

const list = (value: unknown, path: string, min: number, max: number): unknown[] => {
	if (!Array.isArray(value)) return fail(path, 'must be an array');
	if (value.length < min || value.length > max) fail(path, `must have ${min} to ${max} entries`);
	return value;
};

const wholeOrNull = (value: unknown, path: string, min: number, max: number): number | null => {
	if (value === null) return null;
	if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
		return fail(path, `must be null or a whole number from ${min} to ${max}`);
	}
	return value;
};

const priceOrNull = (value: unknown, path: string): number | null => {
	if (value === null) return null;
	if (typeof value !== 'number' || !(value > 0) || value > 1_000_000 || !MONEY.test(String(value))) {
		return fail(path, 'must be null ("Contact for a quote") or a positive USD amount with at most 2 decimals');
	}
	return value;
};

export const httpsUrl = (value: unknown, path: string): string => {
	const raw = text(value, path, 500);
	let url: URL;
	try {
		url = new URL(raw);
	} catch {
		return fail(path, 'must be a valid URL');
	}
	if (url.protocol !== 'https:' || url.username !== '' || url.password !== '') {
		fail(path, 'must be an https URL without a username or password');
	}
	return url.href;
};

const unique = (values: string[], path: string): void => {
	const seen = new Set<string>();
	for (const value of values) {
		if (seen.has(value)) fail(path, `has a duplicate entry "${value}"`);
		seen.add(value);
	}
};

const parsePackage = (value: unknown, path: string): StudioPackage => {
	const o = object(value, path, ['id', 'name', 'summary', 'deliverables', 'turnaroundDays', 'priceUsd', 'revisions']);
	const id = text(o.id, `${path}.id`, 40);
	if (!SLUG.test(id)) fail(`${path}.id`, 'must be 2-40 characters of a-z, 0-9 and "-", not starting or ending with "-"');
	if (id === CUSTOM_PACKAGE_ID) fail(`${path}.id`, `"${CUSTOM_PACKAGE_ID}" is reserved for the "Not sure yet" option`);
	for (const key of ['turnaroundDays', 'priceUsd', 'revisions']) {
		if (!(key in o)) fail(`${path}.${key}`, 'is required (use null if it is not decided yet)');
	}
	const summary = optionalText(o.summary, `${path}.summary`, 300);
	return {
		id,
		name: text(o.name, `${path}.name`, 80),
		...(summary === undefined ? {} : {summary}),
		deliverables: list(o.deliverables, `${path}.deliverables`, 1, 15).map((d, i) => text(d, `${path}.deliverables[${i}]`, 200)),
		turnaroundDays: wholeOrNull(o.turnaroundDays, `${path}.turnaroundDays`, 1, 365),
		priceUsd: priceOrNull(o.priceUsd, `${path}.priceUsd`),
		revisions: wholeOrNull(o.revisions, `${path}.revisions`, 0, 10),
	};
};

const parsePortfolioItem = (value: unknown, path: string): PortfolioItem => {
	const o = object(value, path, ['title', 'url', 'description', 'client']);
	const description = optionalText(o.description, `${path}.description`, 400);
	const client = optionalText(o.client, `${path}.client`, 80);
	return {
		title: text(o.title, `${path}.title`, 120),
		url: httpsUrl(o.url, `${path}.url`),
		...(description === undefined ? {} : {description}),
		...(client === undefined ? {} : {client}),
	};
};

/** Validates parsed JSON. Throws StudioConfigError naming the first bad setting. */
export const loadStudioConfig = (value: unknown): StudioConfig => {
	if (value === null || value === undefined) {
		return fail('', 'is missing: copy config/studio.example.json to config/studio.json and edit it');
	}
	const o = object(value, 'root', ['version', 'packages', 'budgetRanges', 'faq', 'portfolio', 'stripePaymentLinks']);
	if (o.version !== 1) fail('version', 'must be 1');

	const packages = list(o.packages, 'packages', 1, 12).map((p, i) => parsePackage(p, `packages[${i}]`));
	unique(packages.map((p) => p.id), 'packages (id)');

	const budgetRanges = list(o.budgetRanges, 'budgetRanges', 1, 12).map((b, i) => text(b, `budgetRanges[${i}]`, 60));
	unique(budgetRanges, 'budgetRanges');

	const faq = list(o.faq, 'faq', 0, 30).map((entry, i) => {
		const f = object(entry, `faq[${i}]`, ['q', 'a']);
		return {q: text(f.q, `faq[${i}].q`, 200), a: text(f.a, `faq[${i}].a`, 2000)};
	});

	const portfolio = list(o.portfolio, 'portfolio', 0, 24).map((p, i) => parsePortfolioItem(p, `portfolio[${i}]`));

	const config: StudioConfig = {version: 1, packages, budgetRanges, faq, portfolio};
	if (o.stripePaymentLinks !== undefined) {
		const links = object(o.stripePaymentLinks, 'stripePaymentLinks', packages.map((p) => p.id));
		const stripePaymentLinks: Record<string, string> = {};
		for (const [id, url] of Object.entries(links)) {
			if (id.startsWith('_')) continue;
			stripePaymentLinks[id] = httpsUrl(url, `stripePaymentLinks.${id}`);
			const index = packages.findIndex((p) => p.id === id);
			if (packages[index]?.priceUsd === null) {
				fail(`stripePaymentLinks.${id}`, `needs a decided price: set packages[${index}].priceUsd first, so the pay button never sits next to "Contact for a quote"`);
			}
		}
		config.stripePaymentLinks = stripePaymentLinks;
	}
	checkClaims(config);
	return config;
};

/** Package, FAQ and portfolio text must not promise income, returns, prices or audience numbers. */
const checkClaims = (config: StudioConfig): void => {
	const texts: [string, string][] = [
		...config.packages.flatMap((p, i): [string, string][] => [
			[`packages[${i}].name`, p.name],
			...(p.summary === undefined ? [] : [[`packages[${i}].summary`, p.summary] as [string, string]]),
			...p.deliverables.map((d, j): [string, string] => [`packages[${i}].deliverables[${j}]`, d]),
		]),
		...config.faq.flatMap((f, i): [string, string][] => [
			[`faq[${i}].q`, f.q],
			[`faq[${i}].a`, f.a],
		]),
		...config.portfolio.flatMap((p, i): [string, string][] => [
			[`portfolio[${i}].title`, p.title],
			...(p.description === undefined ? [] : [[`portfolio[${i}].description`, p.description] as [string, string]]),
			...(p.client === undefined ? [] : [[`portfolio[${i}].client`, p.client] as [string, string]]),
		]),
		...config.budgetRanges.map((b, i): [string, string] => [`budgetRanges[${i}]`, b]),
	];
	for (const [path, text] of texts) {
		const hit = findClaims(text, {allowDenied: true})[0] ?? findClaims(text, {rules: RESULT_PROMISES, allowDenied: true})[0];
		if (hit) fail(path, `makes a claim the studio never makes (${hit.label}: "${hit.match}"). Describe the work, not results, returns or prices`);
	}
};
