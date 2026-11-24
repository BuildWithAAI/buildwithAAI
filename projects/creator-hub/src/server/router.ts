/**
 * Router implementing the http.ts contract: exact paths plus ":param" segments.
 * A trailing slash is ignored. When several routes match, the one with more literal segments wins,
 * so "/admin/links" beats "/admin/:page" regardless of registration order.
 */
import type {Handler, Router} from './http.ts';

type Method = 'GET' | 'POST';
type Route = {method: Method; path: string; parts: string[]; literals: number; handler: Handler};

export type RouteMatch = {handler: Handler; params: Record<string, string>};

export type HubRouter = Router & {
	match(method: string, pathname: string): RouteMatch | null;
	/** Methods registered for a path (for 405 responses). */
	methodsFor(pathname: string): Method[];
};

const segments = (pathname: string): string[] => {
	const trimmed = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
	return trimmed.split('/').slice(1);
};

const decode = (segment: string): string | null => {
	try {
		return decodeURIComponent(segment);
	} catch {
		return null;
	}
};

const matchRoute = (route: Route, parts: string[]): Record<string, string> | null => {
	if (route.parts.length !== parts.length) return null;
	const params: Record<string, string> = {};
	for (let i = 0; i < parts.length; i++) {
		const expected = route.parts[i] ?? '';
		const actual = parts[i] ?? '';
		if (expected.startsWith(':')) {
			const value = decode(actual);
			if (value === null || value === '') return null;
			params[expected.slice(1)] = value;
		} else if (expected !== actual) {
			return null;
		}
	}
	return params;
};

export const createRouter = (): HubRouter => {
	const routes: Route[] = [];
	const add = (method: Method, path: string, handler: Handler): void => {
		if (!path.startsWith('/')) throw new Error(`route path must start with "/": ${path}`);
		const parts = segments(path);
		const shape = parts.map((p) => (p.startsWith(':') ? ':' : p)).join('/');
		const clash = routes.find((r) => r.method === method && r.parts.map((p) => (p.startsWith(':') ? ':' : p)).join('/') === shape);
		if (clash) throw new Error(`route ${method} ${path} conflicts with ${clash.method} ${clash.path}`);
		routes.push({method, path, parts, literals: parts.filter((p) => !p.startsWith(':')).length, handler});
	};
	const candidates = (pathname: string): {route: Route; params: Record<string, string>}[] => {
		const parts = segments(pathname);
		return routes.flatMap((route) => {
			const params = matchRoute(route, parts);
			return params ? [{route, params}] : [];
		});
	};
	return {
		get: (path, handler) => add('GET', path, handler),
		post: (path, handler) => add('POST', path, handler),
		match(method, pathname) {
			let best: {route: Route; params: Record<string, string>} | null = null;
			for (const candidate of candidates(pathname)) {
				if (candidate.route.method !== method) continue;
				if (!best || candidate.route.literals > best.route.literals) best = candidate;
			}
			return best ? {handler: best.route.handler, params: best.params} : null;
		},
		methodsFor: (pathname) => [...new Set(candidates(pathname).map((c) => c.route.method))],
	};
};
