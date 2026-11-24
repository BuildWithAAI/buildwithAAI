/** content/zoora-security/channel.json: read, validated, with the owner's binding decisions enforced. */
import {readJson, isRecord, str} from './util.ts';

/** Owner decision, 2026-11-24 (CLAUDE.md): Kokoro im_nicola for Zoo in every language. Not configurable here. */
export const ZOO_VOICE = 'im_nicola';

export type Evergreen = {title: string; url: string | null; status: string};

export type ChannelConfig = {
	channel: 'zoora-security';
	displayName: string;
	displayNameTbd: boolean;
	showName: string;
	handle: string | null;
	timezone: string;
	voice: string;
	speed: number;
	lengthSec: [number, number];
	ctaDefault: string;
	ctaSpoken: string;
	evergreen: Record<string, Evergreen>;
	offers: string[];
	hashtags: string[];
	madeForKids: {value: boolean; reason: string};
	containsSyntheticMedia: {value: boolean; reason: string};
	announcerCredentialEnv: string[];
	threatBriefCredentialEnv: string[];
	ownerRules: string[];
	accuracyRules: string[];
	badgerReactions: string[];
	badgerShowBeats: string[];
	badgerSoundsSupplied: boolean;
	segments: Array<{id: string; name: string; sceneType: string; showSegment: string | null; seconds: [number, number]; required: boolean; what: string}>;
};

export class ChannelError extends Error {}

const strList = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && !!x.trim()) : []);

const pair = (v: unknown, fallback: [number, number]): [number, number] =>
	Array.isArray(v) && v.length === 2 && v.every((n) => typeof n === 'number' && n > 0) && v[0] <= v[1] ? [v[0], v[1]] : fallback;

export const parseChannel = (raw: unknown): ChannelConfig => {
	if (!isRecord(raw)) throw new ChannelError('channel.json must be a JSON object');
	const problems: string[] = [];
	if (raw.channel !== 'zoora-security') problems.push('"channel" must be "zoora-security"');
	const zv = isRecord(raw.zooVoice) ? raw.zooVoice : {};
	const voice = str(zv.default) ?? ZOO_VOICE;
	if (voice !== ZOO_VOICE) problems.push(`zooVoice.default is "${voice}", but the owner decided "${ZOO_VOICE}" for every language (CLAUDE.md, 2026-11-24)`);
	if (isRecord(zv.byLang)) for (const [lang, v] of Object.entries(zv.byLang)) if (v !== ZOO_VOICE) problems.push(`zooVoice.byLang.${lang} must be "${ZOO_VOICE}"`);
	const tz = str(raw.timezone) ?? 'America/Chicago';
	try {
		new Intl.DateTimeFormat('en-US', {timeZone: tz});
	} catch {
		problems.push(`timezone "${tz}" is not an IANA time zone`);
	}
	const cadence = isRecord(raw.cadence) ? raw.cadence : {};
	const daily = isRecord(cadence.dailyShort) ? cadence.dailyShort : {};
	const cta = isRecord(raw.cta) ? raw.cta : {};
	const evergreen: Record<string, Evergreen> = {};
	if (isRecord(raw.evergreen))
		for (const [topic, v] of Object.entries(raw.evergreen)) {
			if (!isRecord(v)) continue;
			const url = str(v.url) ?? null;
			if (url && !/^https:\/\//.test(url)) problems.push(`evergreen.${topic}.url must be an https URL or null`);
			evergreen[topic] = {title: str(v.title) ?? topic, url, status: str(v.status) ?? (url ? 'published' : 'planned')};
		}
	const offers = strList(raw.offers);
	const publish = isRecord(raw.publish) ? raw.publish : {};
	const decision = (v: unknown, fallback: {value: boolean; reason: string}) =>
		isRecord(v) && typeof v.value === 'boolean' && typeof v.reason === 'string' && v.reason.trim() ? {value: v.value, reason: v.reason.trim()} : fallback;
	const madeForKids = decision(publish.madeForKids, {value: false, reason: 'Adult crypto and AI security news; not child-directed.'});
	if (madeForKids.value) problems.push('publish.madeForKids must stay false for this channel (adult security news; owner default)');
	const post = isRecord(raw.postApproval) ? raw.postApproval : {};
	const ann = isRecord(post.announcer) ? post.announcer : {};
	const tb = isRecord(post.threatBrief) ? post.threatBrief : {};
	const rules = isRecord(raw.rules) ? raw.rules : {};
	const badger = isRecord(raw.badger) ? raw.badger : {};
	const sounds = isRecord(badger.sounds) ? badger.sounds : {};
	const segments: ChannelConfig['segments'] = [];
	for (const s of Array.isArray(raw.segments) ? raw.segments : []) {
		if (!isRecord(s) || !str(s.id)) continue;
		segments.push({id: str(s.id)!, name: str(s.name) ?? str(s.id)!, sceneType: str(s.sceneType) ?? 'talk', showSegment: str(s.showSegment) ?? null, seconds: pair(s.seconds, [4, 10]), required: s.required === true, what: str(s.what) ?? ''});
	}
	if (problems.length) throw new ChannelError(`channel.json: ${problems.join('; ')}`);
	const showName = str(raw.showName) ?? 'The Zoo & Badger Show';
	return {
		channel: 'zoora-security',
		displayName: str(raw.displayName) ?? showName,
		displayNameTbd: /tbd|placeholder/i.test(String(raw.displayNameStatus ?? '')) || !str(raw.displayName),
		showName,
		handle: typeof raw.handle === 'string' && /^@[A-Za-z0-9._-]{3,30}$/.test(raw.handle) ? raw.handle : null,
		timezone: tz,
		voice,
		speed: typeof zv.speed === 'number' && zv.speed > 0.5 && zv.speed < 2 ? zv.speed : 1,
		lengthSec: pair(daily.lengthSec, [45, 60]),
		ctaDefault: str(cta.default) ?? "Subscribe for tomorrow's Threat Brief.",
		ctaSpoken: str(cta.spoken) ?? str(cta.default) ?? "Subscribe for tomorrow's Threat Brief.",
		evergreen,
		offers,
		hashtags: strList(raw.hashtags).map((h) => h.replace(/^#/, '')).filter((h) => /^[\p{L}\p{N}_]+$/u.test(h)),
		madeForKids,
		containsSyntheticMedia: decision(publish.containsSyntheticMedia, {value: false, reason: 'Clearly animated show with a generic synthetic voice for a fictional host.'}),
		announcerCredentialEnv: strList(ann.credentialEnv),
		threatBriefCredentialEnv: strList(tb.credentialEnv),
		ownerRules: strList(rules.owner),
		accuracyRules: strList(rules.accuracy),
		badgerReactions: strList(badger.reactions).length ? strList(badger.reactions) : ['neutral', 'happy', 'worried', 'shocked', 'judge', 'lookUp'],
		badgerShowBeats: strList(badger.showBeats),
		badgerSoundsSupplied: str(sounds.status) === 'supplied',
		segments,
	};
};

export const loadChannel = (path: string): ChannelConfig => {
	const r = readJson(path);
	if (!r.ok) throw new ChannelError(r.missing ? `channel.json not found at ${path}` : r.error);
	return parseChannel(r.data);
};
