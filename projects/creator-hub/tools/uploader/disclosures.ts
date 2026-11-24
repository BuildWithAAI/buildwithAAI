/**
 * Same-language disclosures next to offer links in localized descriptions. FTC 16 CFR 255 wants a disclosure the
 * audience understands, so a Spanish description that keeps the hub's affiliate link needs the owner-approved Spanish
 * disclosure right next to it, not the English one and not a translation nobody approved.
 *
 * Owner-approved translations live in ONE place, the asset tools' config (video-studio docs/ASSETS.md, "offer
 * disclosures"): video-studio/scripts/assets/config/channels.json, "offerDisclosures": {"<offer id>": {"<lang>":
 * "<text>"}} under "defaults" and per channel (the channel's entry wins). The uploader only reads that file, through
 * this adapter. An offer with no approved translation for a language cannot keep its link in that language.
 */
import {existsSync, readFileSync} from 'node:fs';
import {join} from 'node:path';
import type {PublishKit} from '../../src/types.ts';
import {LANGUAGE_TAGS} from './contracts.ts';
import {bcp47, isRecord} from './util.ts';

/** Where the owner records approved translations of offer disclosures, relative to projects/video-studio. */
export const ASSETS_CONFIG = 'scripts/assets/config/channels.json';
/** How far (in lines, either way) a disclosure may sit from its link: "next to it", as the publish kit writes them. */
export const DISCLOSURE_NEAR_LINES = 3;

export type ApprovedDisclosures = {
	/** The config file as named in messages (relative to projects/video-studio). */
	source: string;
	/** Why the file could not be used (missing, not JSON, wrong shape); null when it was read. */
	problem: string | null;
	/** offer id -> BCP-47 language tag -> the approved disclosure text. */
	byOffer: Record<string, Record<string, string>>;
};

const primary = (tag: string): string => tag.toLowerCase().split('-')[0] ?? tag.toLowerCase();
const squash = (text: string): string => text.normalize('NFC').replace(/\s+/g, ' ').trim();
/** The pipeline's code for a tag (pt-BR -> pt-br, zh-Hans -> zh), as the asset config writes it. */
const pipelineCode = (tag: string): string => Object.entries(LANGUAGE_TAGS).find(([, t]) => t === tag)?.[0] ?? tag.toLowerCase();

/** Reads the approved translations for one channel (defaults, then the channel's own entries on top). */
export const loadApprovedDisclosures = (root: string, channel: string): ApprovedDisclosures => {
	const path = join(root, ASSETS_CONFIG);
	const out: ApprovedDisclosures = {source: `video-studio/${ASSETS_CONFIG}`, problem: null, byOffer: {}};
	if (!existsSync(path)) return {...out, problem: 'the file does not exist'};
	let data: unknown;
	try {
		data = JSON.parse(readFileSync(path, 'utf8'));
	} catch (error) {
		return {...out, problem: `it is not valid JSON (${(error as Error).message})`};
	}
	if (!isRecord(data)) return {...out, problem: 'it is not a JSON object'};
	const defaults = isRecord(data.defaults) ? data.defaults.offerDisclosures : undefined;
	const own = isRecord(data.channels) && isRecord(data.channels[channel]) ? (data.channels[channel] as Record<string, unknown>).offerDisclosures : undefined;
	for (const section of [defaults, own]) {
		if (!isRecord(section)) continue;
		for (const [offer, byLang] of Object.entries(section)) {
			if (!isRecord(byLang)) continue;
			for (const [code, text] of Object.entries(byLang)) {
				const tag = bcp47(code, LANGUAGE_TAGS);
				if (!tag || typeof text !== 'string' || !text.trim()) continue;
				(out.byOffer[offer] ??= {})[tag] = text.trim();
			}
		}
	}
	return out;
};

/** The approved disclosure for an offer in a language: exact tag first, then the same language (es-419 -> es). */
export const approvedDisclosure = (approved: ApprovedDisclosures, offer: {id: string; disclosure: string}, tag: string): string | null => {
	// English: the registry's own disclosure (the publish kit already carries it) is the approved text
	if (primary(tag) === 'en' && offer.disclosure.trim()) return offer.disclosure.trim();
	const forOffer = approved.byOffer[offer.id] ?? {};
	if (forOffer[tag]) return forOffer[tag];
	const same = Object.entries(forOffer).find(([t]) => primary(t) === primary(tag));
	return same ? same[1] : null;
};

const hubPath = (url: string): string | null => {
	try {
		const parsed = new URL(url);
		return parsed.pathname.startsWith('/go/') ? `${parsed.origin}${parsed.pathname}` : null;
	} catch {
		return null;
	}
};

/**
 * Problems with the offer links of one localized description: every hub /go/ link must be one of the kit's offers,
 * and that offer's approved disclosure in this language must sit within DISCLOSURE_NEAR_LINES lines of the link.
 */
export const localizedDisclosureProblems = (text: string, where: string, tag: string, kit: Pick<PublishKit, 'offers'>, approved: ApprovedDisclosures, urlsIn: (text: string) => string[]): string[] => {
	const problems: string[] = [];
	const lines = text.split(/\r?\n/);
	const offers = Array.isArray(kit.offers) ? kit.offers : [];
	const seen = new Set<string>();
	lines.forEach((line, i) => {
		for (const url of urlsIn(line)) {
			const path = hubPath(url);
			if (!path || seen.has(`${i}|${url}`)) continue;
			seen.add(`${i}|${url}`);
			const offer = offers.find((o) => hubPath(o.hubUrl) === path);
			if (!offer) {
				problems.push(`${where}: ${url} is an offer link that is not one of the kit's offers, so its disclosure cannot be checked`);
				continue;
			}
			const disclosure = approvedDisclosure(approved, offer, tag);
			if (!disclosure) {
				problems.push(
					`${where}: the "${offer.id}" link needs its disclosure in ${tag}, and there is no owner-approved ${tag} translation of it. ` +
						`Add one under "offerDisclosures" > "${offer.id}" > "${pipelineCode(tag)}" in ${approved.source}${approved.problem ? ` (it could not be read: ${approved.problem})` : ''}, or remove the link from this translation`,
				);
				continue;
			}
			const near = lines.slice(Math.max(0, i - DISCLOSURE_NEAR_LINES), i + DISCLOSURE_NEAR_LINES + 1).map(squash).join('\n');
			if (!near.includes(squash(disclosure))) {
				problems.push(`${where}: the "${offer.id}" link is not next to its owner-approved ${tag} disclosure ("${disclosure}"). Put that exact line within ${DISCLOSURE_NEAR_LINES} lines of the link`);
			}
		}
	});
	return problems;
};
