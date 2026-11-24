/**
 * The approval packet's model: everything the owner reviews in about 5 minutes, gathered from the storyboard, the
 * brief, the news gate's JSON report, the build steps, the render and the publish kit. Pure; html.ts and md.ts render
 * it. Readiness is decided here: any blocker means NOT READY, and approve refuses a packet that is not ready.
 */
import type {ChannelConfig} from './channel.ts';
import {beatsOf, type SbLite} from './kit-adapter.ts';
import type {Sentence, Splitter} from './narration.ts';
import type {PostInput} from './postapproval.ts';
import {buildAnnouncements, buildThreatBrief} from './postapproval.ts';
import type {BriefSource, DailyBrief, PacketSummary, StepResult} from './types.ts';
import {isRecord} from './util.ts';

// ---- the news gate's JSON report (scripts/news, out/claims/news-<slug>.json), read defensively ----

export type GateFinding = {rule: string; code: string; severity: 'error' | 'warning' | 'info'; where: {surface?: string; scene?: string; text?: string}; message: string; fix: string; evidence?: string};
export type GateClaim = {scene: string; sentence: number; text: string; sourceIds: string[]; factId: string | null; ok: boolean; developing: boolean};
export type GateJson = {
	verdict: 'pass' | 'fail';
	counts: {errors: number; warnings: number; claims: number; claimsOk: number};
	rules: Array<{rule: string; title: string; status: 'pass' | 'fail' | 'warn'; errors: number; warnings: number}>;
	findings: GateFinding[];
	claims: GateClaim[];
	developing: {incidents: string[]; label: string | null; labelVia: string | null; spokenIn: string | null};
	analysis: Array<{id: string; kind: string; basis: string; detail: string; sourceIds: string[]; presentedIn: string[]}>;
	corrections: {applicable: string[]; pinnedComments: Array<{id: string; status: 'pending' | 'pinned'; text: string}>};
	inputs: Record<string, {path: string; sha256: string | null}>;
};

export const readGate = (raw: unknown): GateJson | null => {
	if (!isRecord(raw) || (raw.verdict !== 'pass' && raw.verdict !== 'fail') || raw.gate !== 'news-claim-gate') return null;
	const arr = <T>(v: unknown) => (Array.isArray(v) ? (v.filter(isRecord) as unknown as T[]) : []);
	const counts = isRecord(raw.counts) ? raw.counts : {};
	const dev = isRecord(raw.developing) ? raw.developing : {};
	const cor = isRecord(raw.corrections) ? raw.corrections : {};
	return {
		verdict: raw.verdict,
		counts: {errors: Number(counts.errors ?? 0), warnings: Number(counts.warnings ?? 0), claims: Number(counts.claims ?? 0), claimsOk: Number(counts.claimsOk ?? 0)},
		rules: arr(raw.rules),
		findings: arr<GateFinding>(raw.findings).map((f) => ({...f, where: isRecord(f.where) ? f.where : {}})),
		claims: arr(raw.claims),
		developing: {incidents: Array.isArray(dev.incidents) ? (dev.incidents as string[]) : [], label: (dev.label as string) ?? null, labelVia: (dev.labelVia as string) ?? null, spokenIn: (dev.spokenIn as string) ?? null},
		analysis: arr(raw.analysis),
		corrections: {applicable: Array.isArray(cor.applicable) ? (cor.applicable as string[]) : [], pinnedComments: arr(cor.pinnedComments)},
		inputs: isRecord(raw.inputs) ? (raw.inputs as GateJson['inputs']) : {},
	};
};

// ---- the model ----

export type ExcerptView = {sourceId: string; publisher: string; tier: string; title: string; url: string; text: string};
export type ClaimView = {text: string; ok: boolean | null; srcIds: string[]; factId: string | null; excerpts: ExcerptView[]};
export type SentenceView = {display: string; claims: ClaimView[]};
export type SceneView = {id: string; type: string; segment: string; title: string | null; bullets: string[]; badger: string | null; sentences: SentenceView[]; analysisIds: string[]; error?: string};

export type Thumb = {label: string; rel: string | null; dataUri: string | null; sha256: string | null};

export type PacketModel = {
	slug: string;
	date: string;
	builtAt: string;
	builtAtLocal: string;
	showName: string;
	title: string;
	shortTitle: string;
	format: string;
	ready: boolean;
	blockers: string[];
	warnings: string[];
	developing: boolean;
	developingInfo: {labelVia: string | null; spokenIn: string | null; asOf: string | null};
	incident: {protocol: string; type: string; status: string; dateUtc: string; evergreen: string | null};
	preview: {rel: string | null; bytes: number | null; durationSec: number | null; sha256: string | null; note: string; posterDataUri?: string | null};
	thumbnails: Thumb[];
	scenes: SceneView[];
	analysis: Array<{id: string; kind: string; basis: string; detail: string; method: string | null; presentedIn: string[]}>;
	steps: StepResult[];
	gate: GateJson | null;
	checklist: {
		title: string;
		madeForKids: string;
		paidPromotion: string;
		synthetic: string;
		pinnedComment: string;
		corrections: Array<{id: string; status: string; text: string}>;
		description: string | null;
		kitFailing: Array<{id: string; detail: string}>;
		kitNotApplicable: Array<{id: string; why: string}>;
		upload: string[];
	};
	post: {x: string; telegram: string; community: string; email: {subject: string; preview: string; text: string}};
	versions: PacketSummary['versions'];
	reply: string;
	splitter: string;
};

/** Each sentence of a scene with its claims, the gate's verdict per claim and the stored excerpts that back it. */
export const sceneView = (sc: SbLite['scenes'][number], split: Splitter, gate: GateJson | null, brief: DailyBrief | null, analysisIds: string[]): SceneView => {
	const onScreen = sc.onScreen ?? {};
	const title = typeof onScreen.title === 'string' ? onScreen.title : null;
	const bullets = Array.isArray(onScreen.bullets) ? onScreen.bullets.map(String) : Array.isArray(onScreen.steps) ? onScreen.steps.map(String) : [];
	const beats = beatsOf(sc);
	const extra = ['loss', 'lossAlt', 'flag', 'fix', 'detail', 'kicker'].map((k) => onScreen[k]).filter((v): v is string => typeof v === 'string' && !!v.trim());
	const nodes = Array.isArray(onScreen.nodes) ? onScreen.nodes.map(String) : [];
	const base: SceneView = {
		id: sc.id,
		type: sc.type,
		segment: sc.segment ? `${sc.segment}${title ? `: ${title}` : ''}` : title ?? sc.type,
		title,
		bullets: [...bullets, ...extra, ...(nodes.length ? [`diagram: ${nodes.join(' → ')}`] : [])],
		badger: beats.length ? beats.join(', ') : sc.badger?.present ? 'present' : null,
		sentences: [],
		analysisIds,
	};
	let sentences: Sentence[];
	try {
		sentences = split(sc.narration);
	} catch (err) {
		return {...base, error: `Narration markup: ${err instanceof Error ? err.message : String(err)}`, sentences: [{display: sc.narration, claims: []}]};
	}
	const srcById = new Map<string, BriefSource>((brief?.sources ?? []).map((s) => [s.id, s]));
	const norm = (s: string) => s.replace(/[\s.!?…"'”’]+$/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
	base.sentences = sentences.map((s, k) => ({
		display: s.display,
		claims: s.claims.map((c) => {
			const g = gate?.claims.find((x) => x.scene === sc.id && x.sentence === k && norm(x.text) === norm(c.display)) ?? gate?.claims.find((x) => x.scene === sc.id && x.sentence === k && x.sourceIds.join() === c.srcIds.join());
			const fact = g?.factId ? brief?.facts.find((f) => f.id === g.factId) : undefined;
			const excerpts: ExcerptView[] = [];
			const push = (sid: string, text: string) => {
				const src = srcById.get(sid);
				if (!excerpts.some((e) => e.sourceId === sid && e.text === text)) excerpts.push({sourceId: sid, publisher: src?.publisher ?? sid, tier: src?.tier ?? '?', title: src?.title ?? '', url: src?.url ?? '', text});
			};
			if (fact) for (const e of fact.excerpts) push(e.sourceId, e.text);
			for (const sid of c.srcIds) {
				if (excerpts.some((e) => e.sourceId === sid)) continue;
				const src = srcById.get(sid);
				const all = src ? [...(src.excerpt ? [src.excerpt] : []), ...(src.excerpts ?? [])] : [];
				const words = c.display.toLowerCase().match(/[a-z0-9$.,]{4,}/g) ?? [];
				const best = all.find((t) => words.some((w) => t.toLowerCase().includes(w))) ?? all[0] ?? src?.title;
				if (best) push(sid, best);
			}
			return {text: c.display, ok: g ? g.ok : null, srcIds: c.srcIds, factId: g?.factId ?? null, excerpts};
		}),
	}));
	return base;
};

export const DEFAULT_SAFETY = (name: string) => `${name} will never DM you first, ask for your seed phrase or ask you to connect a wallet. Anyone who does is an impersonator: please report them.`;

/** The pinned comment: corrections first (copy exactly), then the developing note, then the safety line. */
export const pinnedComment = (o: {corrections: GateJson['corrections']['pinnedComments']; developing: boolean; kitPinned: string | null; displayName: string}): string => {
	const parts: string[] = [];
	for (const c of o.corrections) parts.push(c.text.trim());
	if (o.developing) parts.push('DEVELOPING STORY: details may change. We pin every correction here.');
	const kit = (o.kitPinned ?? '').trim();
	parts.push(kit || DEFAULT_SAFETY(o.displayName));
	return parts.join('\n\n');
};

export type ModelInput = {
	slug: string;
	date: string;
	builtAt: string;
	builtAtLocal: string;
	sb: SbLite;
	brief: DailyBrief | null;
	gate: GateJson | null;
	steps: StepResult[];
	channel: ChannelConfig;
	split: Splitter;
	splitter: string;
	preChecks: {blockers: string[]; warnings: string[]};
	developing: boolean;
	preview: PacketModel['preview'];
	thumbnails: Thumb[];
	kit: {pinned: string | null; description: string | null; failing: Array<{id: string; detail: string}>; notApplicable: Array<{id: string; why: string}>} | null;
	post: PostInput;
	versions: PacketSummary['versions'];
};

export const buildModel = (m: ModelInput): PacketModel => {
	const {sb, gate, brief, channel} = m;
	const blockers = [...m.preChecks.blockers];
	const warnings = [...m.preChecks.warnings];
	for (const s of m.steps) {
		if (s.blocking) blockers.push(`${s.title}: ${s.note}`);
		else if (s.status === 'missing' || s.status === 'failed' || s.status === 'warning') warnings.push(`${s.title}: ${s.note}`);
	}
	const analysisOf = (sceneId: string) => (gate?.analysis ?? []).filter((a) => a.presentedIn.includes(sceneId)).map((a) => a.id);
	const scenes = sb.scenes.map((sc) => sceneView(sc, m.split, gate, brief, analysisOf(sc.id)));
	const analysis = (sb.analysis ?? []).map((a, i) => {
		const g = gate?.analysis.find((x) => x.id === (a.id ?? `analysis[${i}]`));
		return {id: a.id ?? `analysis[${i}]`, kind: String(a.kind ?? '?'), basis: String(a.basis ?? '?'), detail: String(a.detail ?? ''), method: typeof a.method === 'string' ? a.method : null, presentedIn: g?.presentedIn ?? a.sceneIds ?? []};
	});
	const corrections = gate?.corrections.pinnedComments ?? [];
	const offers = channel.offers.length ? channel.offers : sb.offers;
	const ann = buildAnnouncements(m.post);
	const email = buildThreatBrief(m.post);
	const devRaw = sb.news.developing;
	const asOf = isRecord(devRaw) && typeof devRaw.asOf === 'string' ? devRaw.asOf : null;
	return {
		slug: m.slug,
		date: m.date,
		builtAt: m.builtAt,
		builtAtLocal: m.builtAtLocal,
		showName: channel.showName,
		title: sb.title,
		shortTitle: sb.shorts[0]?.title ?? sb.title,
		format: String(sb.news.format ?? brief?.format ?? 'daily-short'),
		ready: blockers.length === 0,
		blockers,
		warnings,
		developing: m.developing,
		developingInfo: {labelVia: gate?.developing.labelVia ?? null, spokenIn: gate?.developing.spokenIn ?? null, asOf},
		incident: {protocol: brief?.incident.protocol ?? '?', type: brief?.incident.type ?? '?', status: brief?.incident.status ?? '?', dateUtc: brief?.incident.dateUtc ?? '?', evergreen: brief?.evergreen ? `${brief.evergreen.title}${brief.evergreen.url ? '' : ' (explainer not published yet)'}` : null},
		preview: m.preview,
		thumbnails: m.thumbnails,
		scenes,
		analysis,
		steps: m.steps,
		gate,
		checklist: {
			title: sb.title,
			madeForKids: `No, not made for kids. ${channel.madeForKids.reason}`,
			paidPromotion: offers.length ? `Yes: tick "paid promotion" (offers: ${offers.join(', ')}). Say and show the disclosure.` : 'No: this video has no offers, sponsors or free products.',
			synthetic: `${channel.containsSyntheticMedia.value ? 'Yes' : 'No'}: ${channel.containsSyntheticMedia.reason}`,
			pinnedComment: pinnedComment({corrections, developing: m.developing, kitPinned: m.kit?.pinned ?? null, displayName: channel.displayName}),
			corrections,
			description: m.kit?.description ?? null,
			kitFailing: m.kit?.failing ?? [],
			kitNotApplicable: m.kit?.notApplicable ?? [],
			upload: [
				'Upload short.mp4 by hand in YouTube Studio (no tool uploads for you). Start it as Private.',
				`Title: the one above. Audience: "No, it's not made for kids". Altered content: ${channel.containsSyntheticMedia.value ? 'Yes' : 'No'}. Paid promotion: ${offers.length ? 'Yes' : 'No'}.`,
				'Paste the description, add the thumbnail if Studio offers it, then schedule or publish.',
				'Pin the comment above. Then reply "UPLOADED ' + m.slug + ' <video id>" so the announcer and the Threat Brief get the link.',
			],
		},
		post: {x: ann.x, telegram: ann.telegram, community: ann.community, email: {subject: email.subject, preview: email.preview, text: email.text}},
		versions: m.versions,
		reply: `APPROVE ${m.slug}`,
		splitter: m.splitter,
	};
};
