/**
 * Channel rule: no memecoin launchpad is ever an offer. One shared list for every tool that reads the offer
 * registry (the hub checks it at startup; the publish kit can import it instead of keeping its own copy).
 *
 * A launchpad is recognised by its destination host, by a launchpad host hidden inside a tracking link
 * (https://track.network/c/1?u=https%3A%2F%2Fpump.fun%2F...), or by its name, link or notes mentioning one.
 * Extend both lists when new launchpads appear.
 */
export const LAUNCHPAD_HOSTS: readonly string[] = [
	'pump.fun',
	'letsbonk.fun',
	'four.meme',
	'sunpump.meme',
	'believe.app',
	'bags.fm',
	'moonshot.money',
	'clanker.world',
	'virtuals.io',
];

/** Launchpad names and the word itself, in names, links and notes ("Pump.fun", "pump fun", "launch pad"). */
export const LAUNCHPAD_WORDS =
	/pump\s*\.?\s*fun|launch\s*-?\s*pad|letsbonk|four\s*\.\s*meme|sunpump|believe\s*\.\s*app|bags\s*\.\s*fm|moonshot|clanker|virtuals/i;

const isLaunchpadHost = (host: string): boolean => LAUNCHPAD_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));

/** Percent-decodes up to three times (tracking links often double-encode their target). */
const decodeAll = (text: string): string => {
	let out = text;
	for (let i = 0; i < 3; i++) {
		let next: string;
		try {
			next = decodeURIComponent(out.replace(/\+/g, ' '));
		} catch {
			break;
		}
		if (next === out) break;
		out = next;
	}
	return out;
};

/** Why an offer counts as a memecoin launchpad, or null when nothing points to one. */
export const launchpadEvidence = (offer: {name?: string; url?: string; notes?: string}): string | null => {
	const url = offer.url ?? '';
	const decoded = decodeAll(url);
	for (const match of [url, decoded].flatMap((text) => [...text.matchAll(/https?:\/\/([^/?#\s:@]+)/gi)])) {
		const host = (match[1] ?? '').toLowerCase();
		if (isLaunchpadHost(host)) return `its link goes to ${host}`;
	}
	for (const [label, text] of [
		['name', offer.name],
		['link', decoded],
		['notes', offer.notes],
	] as const) {
		const match = text ? LAUNCHPAD_WORDS.exec(text) : null;
		if (match) return `its ${label} mentions "${match[0]}"`;
	}
	return null;
};
